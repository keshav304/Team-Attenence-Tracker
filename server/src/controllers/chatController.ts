import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { embedText } from '../utils/embeddings.js';
import config from '../config/index.js';
import { AuthRequest } from '../types/index.js';
import { Errors } from '../utils/AppError.js';
import { callLLMProvider } from '../utils/llmProvider.js';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const MAX_QUESTION_LENGTH = 500;
const NUM_CANDIDATES = 50;
const TOP_K = 5;
const VECTOR_INDEX_NAME = 'vector_index';
const EMBEDDING_PATH = 'embedding';
const DB_NAME = 'dhsync';
const COLLECTION_NAME = 'product_docs';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface DocChunk {
  text: string;
  metadata: { source: string; page: number };
  score: number;
}

interface ChatSource {
  page: number;
  source: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Sanitise user input to mitigate basic prompt-injection attempts.
 * Strips control characters and trims whitespace.
 */
function sanitise(input: string): string {
  return input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
}

/**
 * Build the system prompt that grounds the LLM on retrieved documentation.
 */
function buildPrompt(context: string, question: string): string {
  return `You are a helpful assistant for a web application.

Answer the user's question using ONLY the documentation provided below.
If the answer is not contained in the documentation, say you do not know.
Be concise and clear. Prefer step-by-step guidance when applicable.
Do NOT invent or assume any information beyond the documentation.

Documentation:
${context}

Question:
${question}`;
}

/**
 * Generate an answer using the centralized LLM provider.
 * Delegates model selection, fallback, and provider switching to llmProvider.
 */
async function generateAnswer(systemPrompt: string): Promise<string> {
  return callLLMProvider({
    messages: [{ role: 'system', content: systemPrompt }],
    maxTokens: 1024,
    temperature: 0.2,
    logPrefix: 'Chat:RAG',
  });
}

/* ------------------------------------------------------------------ */
/*  Data-aware analytics — V2 pipeline (Stages 0–7)                   */
/* ------------------------------------------------------------------ */

// Cache the dynamic import to avoid circular deps
let _processQuestion: typeof import('./chatPipeline.js')['processQuestion'] | null = null;

async function getProcessQuestion(): Promise<typeof import('./chatPipeline.js')['processQuestion']> {
  if (!_processQuestion) {
    const mod = await import('./chatPipeline.js');
    if (!mod.processQuestion) {
      throw new Error('processQuestion import missing from chatPipeline');
    }
    _processQuestion = mod.processQuestion;
  }
  return _processQuestion;
}

/**
 * Attempt to answer the user's question via the V2 chat pipeline.
 * The pipeline handles both simple (fast path) and complex (LLM path) queries.
 * Returns the answer string, or null if the query should fall through to RAG.
 */
async function tryAnalyticsQuery(
  question: string,
  user: { _id: any; name: string },
  history?: { role: 'user' | 'assistant'; text: string }[]
): Promise<string | null> {
  const processQuestion = await getProcessQuestion();
  const result = await processQuestion({ question, user, history });
  return result.answer;
}

/* ------------------------------------------------------------------ */
/*  Vector search                                                     */
/* ------------------------------------------------------------------ */

async function searchDocs(queryVector: number[]): Promise<DocChunk[]> {
  const db = mongoose.connection.getClient().db(DB_NAME);
  const collection = db.collection(COLLECTION_NAME);

  const results = await collection
    .aggregate([
      {
        $vectorSearch: {
          index: VECTOR_INDEX_NAME,
          path: EMBEDDING_PATH,
          queryVector,
          numCandidates: NUM_CANDIDATES,
          limit: TOP_K,
        },
      },
      {
        $project: {
          _id: 0,
          text: 1,
          metadata: 1,
          score: { $meta: 'vectorSearchScore' },
        },
      },
    ])
    .toArray();

  return results as unknown as DocChunk[];
}

/* ------------------------------------------------------------------ */
/*  Controller                                                        */
/* ------------------------------------------------------------------ */

export const chat = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    /* 1 ── Validate input ------------------------------------------- */
    const rawQuestion: unknown = req.body?.question;

    if (!rawQuestion || typeof rawQuestion !== 'string') {
      throw Errors.validation('A non-empty "question" string is required.');
    }

    const question = sanitise(rawQuestion);

    if (question.length === 0) {
      throw Errors.validation('Question must not be empty after trimming.');
    }

    if (question.length > MAX_QUESTION_LENGTH) {
      throw Errors.validation(`Question exceeds the maximum length of ${MAX_QUESTION_LENGTH} characters.`);
    }

    /* 1b ── Try data-aware analytics pipeline (V2) ------------------- */
    const authReq = req as AuthRequest;
    if (authReq.user) {
      try {
        // Accept optional conversation history from the client
        const rawHistory: unknown = req.body?.history;
        const history = Array.isArray(rawHistory)
          ? rawHistory
              .filter(
                (h: any) =>
                  h &&
                  typeof h.role === 'string' &&
                  typeof h.text === 'string' &&
                  (h.role === 'user' || h.role === 'assistant'),
              )
              .slice(-6) // Cap at 3 turns (6 messages)
              .map((h: any) => ({
                role: h.role as 'user' | 'assistant',
                text: sanitise(h.text).slice(0, MAX_QUESTION_LENGTH),
              }))
          : undefined;

        const analyticsResult = await tryAnalyticsQuery(
          question,
          { _id: authReq.user._id, name: authReq.user.name },
          history,
        );
        if (analyticsResult) {
          res.json({ answer: analyticsResult, sources: [] });
          return;
        }
      } catch (err) {
        console.warn('Chat: pipeline handler failed, falling through to RAG:', err);
      }
    }

    /* 2 ── Embed the query ------------------------------------------ */
    let queryVector: number[];
    try {
      queryVector = await embedText(question);
    } catch (embErr) {
      console.error('Chat: embedText failed:', embErr);
      throw Errors.serviceUnavailable('Failed to process the question (embedding error).');
    }

    /* 3 ── MongoDB Atlas Vector Search ------------------------------ */
    let chunks: DocChunk[];
    try {
      chunks = await searchDocs(queryVector);
    } catch (searchErr) {
      console.error('Chat: searchDocs failed:', searchErr);
      throw Errors.serviceUnavailable('Failed to search the documentation.');
    }

    /* 4 ── Handle no results ---------------------------------------- */
    if (!chunks || chunks.length === 0) {
      res.json({
        answer:
          "I couldn't find relevant information in the documentation.",
        sources: [],
      });
      return;
    }

    /* 5 ── Build context from retrieved chunks ---------------------- */
    const context = chunks
      .map((c, i) => `[${i + 1}] ${c.text}`)
      .join('\n\n');

    /* 6 ── Generate natural language answer via LLM ----------------- */
    const prompt = buildPrompt(context, question);
    let answer: string;
    try {
      answer = await generateAnswer(prompt);
    } catch (llmErr) {
      const errMsg = llmErr instanceof Error ? llmErr.message : String(llmErr);

      // Help users fix the most common cause: missing API key
      if (errMsg.includes('OPENROUTER_API_KEY') && errMsg.includes('not configured')) {
        throw Errors.serviceUnavailable('Chat is not configured. Set OPENROUTER_API_KEY in server/.env (get a key at https://openrouter.ai/keys).');
      }

      throw Errors.aiUnavailable('Failed to generate an answer. Please try again.');
    }

    if (!answer) {
      answer = "I found some relevant documentation but couldn't formulate an answer. Please try rephrasing your question.";
    }

    /* 7 ── Deduplicate sources -------------------------------------- */
    const seenSources = new Set<string>();
    const sources: ChatSource[] = [];

    for (const chunk of chunks) {
      const key = `${chunk.metadata?.source}::${chunk.metadata?.page}`;
      if (!seenSources.has(key) && chunk.metadata) {
        seenSources.add(key);
        sources.push({
          page: chunk.metadata.page,
          source: chunk.metadata.source,
        });
      }
    }

    /* 8 ── Return structured response ------------------------------- */
    res.json({ answer, sources });
  } catch (error) {
    next(error);
  }
};
