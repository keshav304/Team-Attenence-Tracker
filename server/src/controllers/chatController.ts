import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { embedText } from '../utils/embeddings.js';
import config from '../config/index.js';
import { AuthRequest } from '../types/index.js';
import { Errors } from '../utils/AppError.js';

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
 * Ordered list of free models to try. If the first returns a rate-limit or
 * empty response, subsequent models are attempted.
 */
const LLM_MODELS = [
  'nvidia/nemotron-nano-9b-v2:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemma-3-12b-it:free',
  'deepseek/deepseek-r1-0528:free',
];

/**
 * Call OpenRouter (free-tier compatible) to generate the answer.
 * Tries models in order until one succeeds with a non-empty response.
 */
async function generateAnswer(
  systemPrompt: string
): Promise<string> {
  const apiKey = config.openRouterApiKey;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }

  let lastError = '';

  for (const model of LLM_MODELS) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': config.clientUrl,
          'X-Title': 'A-Team-Tracker Assistant',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
          ],
          max_tokens: 1024,
          temperature: 0.2,
        }),
      });

      if (res.status === 429) {
        console.warn(`Chat: model ${model} rate-limited, trying next…`);
        lastError = `Rate limited (${model})`;
        continue;
      }

      if (!res.ok) {
        const body = await res.text();
        console.warn(`Chat: model ${model} returned ${res.status}: ${body.substring(0, 200)}`);
        lastError = `${model} error ${res.status}`;
        continue;
      }

      const data = (await res.json()) as {
        choices: {
          message: {
            content?: string;
            reasoning?: string;
            reasoning_content?: string;
          };
        }[];
      };

      // Some reasoning models (e.g. DeepSeek R1) put the answer in
      // message.content, but may leave it empty while spending tokens on
      // the reasoning field.  Fall back to reasoning if content is blank.
      const msg = data.choices?.[0]?.message;
      const answer =
        msg?.content?.trim() ||
        msg?.reasoning_content?.trim() ||
        msg?.reasoning?.trim() ||
        '';

      if (answer) {
        return answer;
      }

      console.warn(`Chat: model ${model} returned empty content, trying next…`);
      lastError = `Empty answer (${model})`;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`Chat: model ${model} threw: ${errMsg}`);
      lastError = errMsg;
    }
  }

  throw new Error(`All LLM models failed. Last error: ${lastError}`);
}

/* ------------------------------------------------------------------ */
/*  Data-aware analytics (inline helper)                              */
/* ------------------------------------------------------------------ */

// Cache the dynamic import so classifyAndAnswer is loaded once
let _classifyAndAnswer: typeof import('./analyticsController.js')['classifyAndAnswer'] | null = null;

async function getClassifyAndAnswer() {
  if (!_classifyAndAnswer) {
    const mod = await import('./analyticsController.js');
    _classifyAndAnswer = mod.classifyAndAnswer;
  }
  return _classifyAndAnswer;
}

/**
 * Attempt to answer the user's question via the analytics handler.
 * Returns the answer string, or null if the query is not data-related
 * (i.e. should fall through to RAG).
 */
async function tryAnalyticsQuery(
  question: string,
  user: { _id: any; name: string }
): Promise<string | null> {
  const classifyAndAnswer = await getClassifyAndAnswer();
  return classifyAndAnswer(question, user);
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

    /* 1b ── Try data-aware analytics handler first ------------------ */
    const authReq = req as AuthRequest;
    if (authReq.user) {
      try {
        const analyticsResult = await tryAnalyticsQuery(question, {
          _id: authReq.user._id,
          name: authReq.user.name,
        });
        if (analyticsResult) {
          res.json({ answer: analyticsResult, sources: [] });
          return;
        }
      } catch (err) {
        console.warn('Chat: analytics handler failed, falling through to RAG:', err);
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
