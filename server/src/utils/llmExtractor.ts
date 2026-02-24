/**
 * Stage 1 — LLM Structured Extraction
 *
 * Sends the user's question (+ optional conversation history) to an LLM
 * and receives back a structured JSON extraction with intent, people,
 * timeRange, constraints, goals, ambiguities, and capability checks.
 *
 * Only used for complex queries that escape the fast-path (Stage 0).
 */

import config from '../config/index.js';
import type { ComplexIntent } from './complexityDetector.js';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const LLM_FETCH_TIMEOUT_MS = 15_000;

const VALID_COMPLEX_INTENTS: ReadonlySet<string> = new Set<ComplexIntent>([
  'comparison', 'overlap', 'avoid', 'optimize', 'simulate',
  'meeting_plan', 'trend', 'multi_person_coordination',
  'clarify_needed', 'out_of_scope', 'explain_previous',
]);

const VALID_OPTIMIZATION_GOALS: ReadonlySet<string> = new Set([
  'minimize_overlap', 'maximize_overlap', 'minimize_commute',
  'least_crowded', 'maximize_team_presence',
]);

function isValidComplexIntent(v: unknown): v is ComplexIntent {
  return typeof v === 'string' && VALID_COMPLEX_INTENTS.has(v);
}

function isValidOptimizationGoal(v: unknown): v is LLMExtraction['optimizationGoal'] {
  return typeof v === 'string' && VALID_OPTIMIZATION_GOALS.has(v);
}

function validateSimulationParams(
  obj: unknown,
): LLMExtraction['simulationParams'] | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const raw = obj as Record<string, unknown>;
  const result: LLMExtraction['simulationParams'] = {};
  if (Array.isArray(raw.proposedDays)) {
    result.proposedDays = raw.proposedDays.filter(
      (d): d is string => typeof d === 'string',
    );
  }
  if (Array.isArray(raw.proposedDayOfWeek)) {
    result.proposedDayOfWeek = raw.proposedDayOfWeek.filter(
      (d): d is string => typeof d === 'string',
    );
  }
  // Return undefined if both arrays are empty/missing
  if (!result.proposedDays?.length && !result.proposedDayOfWeek?.length) {
    return undefined;
  }
  return result;
}

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface Ambiguity {
  type: 'goal' | 'time' | 'group' | 'person';
  question: string;
  options?: string[];
}

export interface LLMExtraction {
  intent: ComplexIntent;
  people: string[];
  timeRange: string;
  constraints: string[];
  optimizationGoal?: 'minimize_overlap' | 'maximize_overlap' | 'minimize_commute' | 'least_crowded' | 'maximize_team_presence';
  simulationParams?: {
    proposedDays?: string[];       // e.g. ["every Tuesday"]
    proposedDayOfWeek?: string[];  // e.g. ["tuesday"]
  };
  needsClarification: boolean;
  ambiguities: Ambiguity[];
  outOfScopeReason?: string;
}

export interface HistoryMessage {
  role: 'user' | 'assistant';
  text: string;
}

/* ------------------------------------------------------------------ */
/*  LLM Models (matching chatController's pattern)                    */
/* ------------------------------------------------------------------ */

const LLM_MODELS = [
  'nvidia/nemotron-nano-9b-v2:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemma-3-12b-it:free',
  'deepseek/deepseek-r1-0528:free',
];

/* ------------------------------------------------------------------ */
/*  Extraction Prompt                                                 */
/* ------------------------------------------------------------------ */

const EXTRACTION_SYSTEM_PROMPT = `You are a structured-data extractor for a workplace attendance chatbot.

## Your Capabilities
You can ONLY help with:
- Report historical and planned attendance data
- Compare attendance between employees
- Compute overlap / avoid days
- Suggest optimal office days based on constraints
- Simulate hypothetical scenarios against existing data
- Report team-level aggregates
- Answer questions about holidays and events

You CANNOT:
- Predict future attendance patterns that aren't in the schedule
- Access HR records, salaries, performance reviews, or private data
- Modify anyone's schedule (that's handled by the Workbot feature)
- Answer questions unrelated to workplace attendance

## Output Format
Respond with ONLY a valid JSON object — no markdown, no explanation:

{
  "intent": "<one of: comparison | overlap | avoid | optimize | simulate | meeting_plan | trend | multi_person_coordination | clarify_needed | out_of_scope | explain_previous>",
  "people": ["<names or pronouns like 'me', 'my team'>"],
  "timeRange": "<e.g. 'this month', 'next month', 'February', 'March 10', 'last week'>",
  "constraints": ["<e.g. 'avoid Mondays', 'only Tuesdays and Thursdays'>"],
  "optimizationGoal": "<one of: minimize_overlap | maximize_overlap | minimize_commute | least_crowded | maximize_team_presence | null>",
  "simulationParams": {
    "proposedDays": ["<specific dates if mentioned>"],
    "proposedDayOfWeek": ["<day names if mentioned, e.g. 'tuesday'>"]
  },
  "needsClarification": false,
  "ambiguities": [],
  "outOfScopeReason": null
}

## Ambiguity Detection
If the query is ambiguous, set needsClarification to true and populate ambiguities:
{
  "type": "<goal | time | group | person>",
  "question": "<clarification question>",
  "options": ["<option 1>", "<option 2>"]
}

## Rules
- "me"/"my"/"I" → add "me" to people array
- If someone says "compare me or mine and Bala" → people: ["me or mine", "Bala"], intent: "comparison"
- "avoid Bala" → intent: "avoid", people: ["me", "Bala"]
- "good day" without context → needsClarification: true
- Unrelated questions → intent: "out_of_scope"
- "why did you recommend" → intent: "explain_previous"
- Always include a timeRange even if implicit (default: "this month")`;

/* ------------------------------------------------------------------ */
/*  LLM Call                                                          */
/* ------------------------------------------------------------------ */

/**
 * Call OpenRouter to extract structured data from the question.
 * Tries models in order until one succeeds.
 */
async function callLLM(messages: Array<{ role: string; content: string }>): Promise<string> {
  const apiKey = config.openRouterApiKey;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }

  let lastError = '';

  for (const model of LLM_MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_FETCH_TIMEOUT_MS);
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
          messages,
          max_tokens: 1024,
          temperature: 0.1,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status === 429) {
        await res.text(); // consume body to release socket
        lastError = `Rate limited (${model})`;
        continue;
      }

      if (!res.ok) {
        const body = await res.text();
        lastError = `${model} error ${res.status}: ${body.substring(0, 200)}`;
        continue;
      }

      const data = (await res.json()) as {
        choices: { message: { content?: string; reasoning?: string; reasoning_content?: string } }[];
      };

      const msg = data.choices?.[0]?.message;
      const answer = msg?.content?.trim() || msg?.reasoning_content?.trim() || msg?.reasoning?.trim() || '';

      if (answer) return answer;
      lastError = `Empty answer (${model})`;
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof DOMException && err.name === 'AbortError') {
        lastError = `Timeout (${model})`;
      } else {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  throw new Error(`LLM extraction failed. Last error: ${lastError}`);
}

/* ------------------------------------------------------------------ */
/*  Main extraction function                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_EXTRACTION: LLMExtraction = {
  intent: 'out_of_scope',
  people: [],
  timeRange: 'this month',
  constraints: [],
  needsClarification: false,
  ambiguities: [],
};

/**
 * Extract structured intent + entities from a complex user question.
 */
export async function extractStructured(
  question: string,
  history?: HistoryMessage[],
): Promise<LLMExtraction> {
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
  ];

  // Include conversation history for reference resolution
  if (history && history.length > 0) {
    const recentHistory = history.slice(-6); // Last 3 pairs
    for (const h of recentHistory) {
      messages.push({ role: h.role, content: h.text });
    }
  }

  messages.push({ role: 'user', content: question });

  try {
    const raw = await callLLM(messages);

    // Parse JSON — handle potential markdown wrapping
    let jsonStr = raw;
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    // Validate and normalize
    return {
      intent: isValidComplexIntent(parsed.intent) ? parsed.intent : 'out_of_scope',
      people: Array.isArray(parsed.people) ? parsed.people : [],
      timeRange: parsed.timeRange || 'this month',
      constraints: Array.isArray(parsed.constraints) ? parsed.constraints : [],
      optimizationGoal: isValidOptimizationGoal(parsed.optimizationGoal)
        ? parsed.optimizationGoal
        : undefined,
      simulationParams: validateSimulationParams(parsed.simulationParams),
      needsClarification: !!parsed.needsClarification,
      ambiguities: Array.isArray(parsed.ambiguities) ? parsed.ambiguities : [],
      outOfScopeReason: parsed.outOfScopeReason || undefined,
    };
  } catch (err) {
    console.error('LLM extraction parse error:', err);
    // Fallback: return a safe default
    return { ...DEFAULT_EXTRACTION };
  }
}
