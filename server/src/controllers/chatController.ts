import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { embedText } from '../utils/embeddings';
import config from '../config';

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
 * Call OpenRouter (free-tier compatible) to generate the answer.
 */
async function generateAnswer(
  systemPrompt: string
): Promise<string> {
  const apiKey = config.openRouterApiKey;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': config.clientUrl,
      'X-Title': 'A-Team-Tracker Assistant',
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b:free',
      messages: [
        { role: 'system', content: systemPrompt },
      ],
      max_tokens: 1024,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter API error (${res.status}): ${body}`);
  }

  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };

  return data.choices?.[0]?.message?.content?.trim() ?? '';
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

export const chat = async (req: Request, res: Response): Promise<void> => {
  try {
    /* 1 ── Validate input ------------------------------------------- */
    const rawQuestion: unknown = req.body?.question;

    if (!rawQuestion || typeof rawQuestion !== 'string') {
      res.status(400).json({
        success: false,
        message: 'A non-empty "question" string is required.',
      });
      return;
    }

    const question = sanitise(rawQuestion);

    if (question.length === 0) {
      res.status(400).json({
        success: false,
        message: 'Question must not be empty after trimming.',
      });
      return;
    }

    if (question.length > MAX_QUESTION_LENGTH) {
      res.status(400).json({
        success: false,
        message: `Question exceeds the maximum length of ${MAX_QUESTION_LENGTH} characters.`,
      });
      return;
    }

    /* 2 ── Embed the query ------------------------------------------ */
    const queryVector = await embedText(question);

    /* 3 ── MongoDB Atlas Vector Search ------------------------------ */
    const chunks = await searchDocs(queryVector);

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
    const answer = await generateAnswer(prompt);

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
    console.error('Chat endpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'An internal error occurred while processing your question.',
    });
  }
};
