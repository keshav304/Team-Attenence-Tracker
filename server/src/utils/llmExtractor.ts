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
  'deepseek/deepseek-r1-0528:free',
  'meta-llama/llama-4-maverick:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen3-235b-a22b:free',
  'google/gemma-3-27b-it:free',
  'nvidia/llama-3.1-nemotron-70b-instruct:free',
  'microsoft/phi-4-reasoning-plus:free',
  'google/gemma-3-12b-it:free',
  'nvidia/nemotron-nano-9b-v2:free',
  'qwen/qwen3-32b:free',
];

/* ------------------------------------------------------------------ */
/*  Extraction Prompt                                                 */
/* ------------------------------------------------------------------ */

const EXTRACTION_SYSTEM_PROMPT = `You are a STRICT structured-data extractor for a workplace attendance analytics chatbot.

Your ONLY task is to convert a user's natural-language query into a structured JSON object describing their intent and parameters.

You DO NOT answer the question.
You DO NOT explain anything.
You DO NOT add extra text.
You MUST output valid JSON only.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## DOMAIN

This system analyzes workplace attendance and office presence.

Attendance statuses include:
- Office
- Work From Home (WFH)
- Leave (full or half-day)
- Planned future schedules

All analysis is day-level (not time-of-day).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## IN-SCOPE CAPABILITIES

You can extract requests related to:

• Personal attendance insights  
• Comparisons between employees  
• Office overlap or avoidance  
• Schedule coordination  
• Optimal office-day recommendations  
• Team presence or crowd analysis  
• Hypothetical simulations based on existing schedules  
• Trends across time periods  
• Multi-person coordination  
• Future planning using planned schedules  
• Holidays and workplace events  

Future-oriented questions ARE valid if based on planned data.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## OUT-OF-SCOPE TOPICS

Mark as out_of_scope if the query asks about:

• HR data (salary, performance, promotions, etc.)
• Private personal information
• Editing or modifying schedules
• Non-attendance topics (weather, sports, coding, etc.)
• Time-of-day meeting scheduling
• Calendar availability or booking
• Predictions without existing data

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## OUTPUT FORMAT (MANDATORY)

Return ONLY this JSON structure:

{
  "intent": "<comparison | overlap | avoid | optimize | simulate | meeting_plan | trend | multi_person_coordination | clarify_needed | out_of_scope | explain_previous>",
  "people": ["<names or references>"],
  "timeRange": "<normalized phrase from query>",
  "constraints": ["<constraints if any>"],
  "optimizationGoal": "<minimize_overlap | maximize_overlap | minimize_commute | least_crowded | maximize_team_presence | null>",
  "simulationParams": {
    "proposedDays": ["<specific dates if mentioned>"],
    "proposedDayOfWeek": ["<day names if mentioned>"]
  },
  "needsClarification": false,
  "ambiguities": [],
  "outOfScopeReason": null
}

Never omit required fields.
Use empty arrays or null when not applicable.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## INTENT DEFINITIONS

comparison  
→ Compare attendance metrics between people  
Examples: "compare me and Bala", "who came more"

overlap  
→ Measure shared office presence  
Examples: "how many days did we work together"

avoid  
→ Minimize overlap with someone  
Examples: "avoid Bala", "least overlap"

optimize  
→ Recommend days based on a goal  
Examples: "best days to go", "maximize collaboration"

simulate  
→ Hypothetical scenario ("if I go every Tuesday")  

meeting_plan  
→ Suggest days when people can meet in office  

trend  
→ Compare across time periods for the same person  

multi_person_coordination  
→ Coordination involving 2+ other people  

explain_previous  
→ Follow-up asking for explanation of earlier recommendation  

clarify_needed  
→ Missing key information or ambiguous intent  

out_of_scope  
→ Outside attendance domain  

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## PEOPLE EXTRACTION RULES

• Include all referenced individuals
• Use lowercase as written unless proper name
• "me", "my", "I" → include "me"
• "my team" → include "my team"
• If no explicit person but required → assume ["me"]
• Handle multiple names
• Ignore titles (Mr., Dr., etc.)

Examples:

"compare me and Bala" → ["me","Bala"]  
"avoid Rahul and Priya" → ["me","Rahul","Priya"]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## TIME RANGE RULES

Extract the time period exactly as expressed.

If none provided → default to "this month".

Examples:

"next month" → "next month"  
"March 10" → "March 10"  
"last week" → "last week"  

Do NOT convert to dates.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## CONSTRAINT EXTRACTION

Capture restrictions such as:

• Specific weekdays  
• Avoiding certain days  
• Only certain days  
• Excluding people  
• Limits on office visits  

Examples:

"avoid Mondays"  
"only Tuesdays and Thursdays"  
"not Fridays"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## OPTIMIZATION GOALS

Infer from wording:

minimize_overlap  
→ avoid, least overlap, stay away  

maximize_overlap  
→ meet, collaborate, most overlap  

minimize_commute  
→ fewest trips, cluster days  

least_crowded  
→ least busy, low attendance  

maximize_team_presence  
→ most people present  

Otherwise → null

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SIMULATION DETECTION

Triggered by hypothetical phrasing:

• "if I go..."
• "suppose"
• "what if"
• "assuming"

Extract:

proposedDays → explicit dates  
proposedDayOfWeek → weekday patterns  

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## AMBIGUITY HANDLING

Set needsClarification = true when critical info is missing.

Ambiguity types:

goal — "good day" without context  
time — unclear period  
person — multiple matches implied  
group — undefined group  

Provide a clarification question with options.

Example:

"Is next week a good time to go to office?"

→ clarify_needed

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SPECIAL CASE RULES

• "avoid X" → intent: avoid, people: ["me","X"], optimizationGoal: minimize_overlap
• "minimum overlap with X" → same as above
• "maximum overlap with X" → optimize + maximize_overlap
• "when can I meet X" → meeting_plan
• "why did you recommend" → explain_previous
• Multiple people coordination → multi_person_coordination
• Questions unrelated to attendance → out_of_scope

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## STRICT OUTPUT RULES

• Output ONLY JSON
• No markdown
• No comments
• No trailing commas
• No explanation
• Do not hallucinate fields
• Preserve casing of names
• Use lowercase for intent and goal values

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## EXAMPLES

Q: "on which days next month should i go to office to have minimum overlap with rahul"

A:
{"intent":"avoid","people":["me","rahul"],"timeRange":"next month","constraints":[],"optimizationGoal":"minimize_overlap","simulationParams":{"proposedDays":[],"proposedDayOfWeek":[]},"needsClarification":false,"ambiguities":[],"outOfScopeReason":null}

Q: "if I go every Tuesday next month, how much overlap will I have with Bala"

A:
{"intent":"simulate","people":["me","Bala"],"timeRange":"next month","constraints":[],"optimizationGoal":null,"simulationParams":{"proposedDays":[],"proposedDayOfWeek":["tuesday"]},"needsClarification":false,"ambiguities":[],"outOfScopeReason":null}
`;

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
  const overallStart = Date.now();

  for (const model of LLM_MODELS) {
    const modelStart = Date.now();
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
        console.log(`[Chat:Extractor] ⚠ ${model} → 429 rate-limited (${Date.now() - modelStart}ms)`);
        continue;
      }

      if (!res.ok) {
        const body = await res.text();
        lastError = `${model} error ${res.status}: ${body.substring(0, 200)}`;
        console.log(`[Chat:Extractor] ✗ ${model} → HTTP ${res.status} (${Date.now() - modelStart}ms)`);
        continue;
      }

      const data = (await res.json()) as {
        choices: { message: { content?: string; reasoning?: string; reasoning_content?: string } }[];
      };

      const msg = data.choices?.[0]?.message;
      const answer = msg?.content?.trim() || msg?.reasoning_content?.trim() || msg?.reasoning?.trim() || '';

      if (answer) {
        console.log(`[Chat:Extractor] ✓ ${model} → success (${Date.now() - modelStart}ms, total ${Date.now() - overallStart}ms, ${answer.length} chars)`);
        return answer;
      }
      lastError = `Empty answer (${model})`;
      console.log(`[Chat:Extractor] ✗ ${model} → empty response (${Date.now() - modelStart}ms)`);
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof DOMException && err.name === 'AbortError') {
        lastError = `Timeout (${model})`;
        console.log(`[Chat:Extractor] ✗ ${model} → timeout after ${LLM_FETCH_TIMEOUT_MS}ms`);
      } else {
        lastError = err instanceof Error ? err.message : String(err);
        console.log(`[Chat:Extractor] ✗ ${model} → error: ${lastError} (${Date.now() - modelStart}ms)`);
      }
    }
  }

  console.log(`[Chat:Extractor] ✗ All models failed after ${Date.now() - overallStart}ms. Last: ${lastError}`);
  throw new Error(`LLM extraction failed. Last error: ${lastError}`);
}

/* ------------------------------------------------------------------ */
/*  Heuristic Fallback (safety net when LLM misclassifies)            */
/* ------------------------------------------------------------------ */

/**
 * If the LLM returns out_of_scope but the question clearly matches
 * a supported intent, override with a heuristic guess.
 */
function heuristicIntentFallback(question: string): ComplexIntent | null {
  const q = question.toLowerCase();

  // "minimum overlap" / "avoid overlap" / "least overlap"
  if (/\b(minim|least|avoid|without)\b/.test(q) && /\b(overlap)\b/.test(q)) return 'avoid';
  if (/\b(avoid|stay away|not.*(same|overlap))\b/.test(q) && /\b(with|from)\b/.test(q) && /\b(office|day|go)\b/.test(q)) return 'avoid';

  // "maximum overlap" / "most overlap" / "best overlap"
  if (/\b(maxim|most|best)\b/.test(q) && /\b(overlap)\b/.test(q)) return 'optimize';

  // "should I go" + person name hints at optimization
  if (/\bshould\s+i\s+go\b/.test(q) && /\b(with|to avoid|overlap)\b/.test(q)) return 'avoid';

  // "meet with" / "meeting with"
  if (/\b(meet|meeting)\s+(with)\b/.test(q)) return 'meeting_plan';

  // "compare" / "vs"
  if (/\b(compare|vs\.?|versus)\b/.test(q) && /\b(office|attendance|days)\b/.test(q)) return 'comparison';

  // "overlap between/with"
  if (/\b(overlap)\b/.test(q) && /\b(between|with)\b/.test(q)) return 'overlap';

  // "if I go" / "what if"
  if (/\b(if\s+i\s+go|what\s+if)\b/.test(q)) return 'simulate';

  // "trend" / "increasing" / "decreasing"
  if (/\b(trend|increasing|decreasing|over\s+time)\b/.test(q)) return 'trend';

  return null;
}

/**
 * Heuristic optimization goal extraction from the question text.
 */
function heuristicOptimizationGoal(question: string): LLMExtraction['optimizationGoal'] | undefined {
  const q = question.toLowerCase();
  if (/\b(minim|least|avoid|without)\b/.test(q) && /\b(overlap)\b/.test(q)) return 'minimize_overlap';
  if (/\b(maxim|most|best)\b/.test(q) && /\b(overlap)\b/.test(q)) return 'maximize_overlap';
  if (/\b(least\s+crowded|empty|quiet)\b/.test(q)) return 'least_crowded';
  return undefined;
}

/**
 * Simple heuristic to extract people names from the question.
 * Looks for "with <name>" or "avoid <name>" patterns.
 */
function extractPeopleHeuristic(question: string): string[] {
  const people: string[] = ['me'];
  const q = question.toLowerCase();

  // "with <name>"
  const withMatch = q.match(/\b(?:with|avoid|from)\s+([a-z]+)\b/);
  if (withMatch && !['the', 'a', 'my', 'this', 'that', 'it', 'them', 'office', 'leave'].includes(withMatch[1])) {
    people.push(withMatch[1]);
  }

  return people;
}

/**
 * Simple heuristic to extract time range from the question.
 */
function extractTimeRangeHeuristic(question: string): string {
  const q = question.toLowerCase();
  if (/\bnext\s+month\b/.test(q)) return 'next month';
  if (/\bthis\s+month\b/.test(q)) return 'this month';
  if (/\bnext\s+week\b/.test(q)) return 'next week';
  if (/\bthis\s+week\b/.test(q)) return 'this week';
  if (/\btomorrow\b/.test(q)) return 'tomorrow';
  if (/\blast\s+month\b/.test(q)) return 'last month';
  if (/\blast\s+week\b/.test(q)) return 'last week';
  return 'this month';
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

    let intent: ComplexIntent = isValidComplexIntent(parsed.intent) ? parsed.intent : 'out_of_scope';
    const llmIntent = intent;

    // If the LLM classified as out_of_scope, double-check with heuristic.
    // The LLM sometimes over-rejects future-period scheduling questions.
    if (intent === 'out_of_scope') {
      const heuristicIntent = heuristicIntentFallback(question);
      if (heuristicIntent) {
        intent = heuristicIntent;
        console.log(`[Chat:Extractor] Heuristic override: LLM said out_of_scope → ${heuristicIntent}`);
      }
    }

    console.log(`[Chat:Extractor] Extracted: intent=${intent}${llmIntent !== intent ? ` (LLM: ${llmIntent})` : ''}, people=[${(parsed.people || []).join(', ')}], time="${parsed.timeRange || 'this month'}", goal=${parsed.optimizationGoal || 'none'}`);

    // Validate and normalize
    return {
      intent,
      people: Array.isArray(parsed.people) ? parsed.people : [],
      timeRange: parsed.timeRange || 'this month',
      constraints: Array.isArray(parsed.constraints) ? parsed.constraints : [],
      optimizationGoal: isValidOptimizationGoal(parsed.optimizationGoal)
        ? parsed.optimizationGoal
        : heuristicOptimizationGoal(question),
      simulationParams: validateSimulationParams(parsed.simulationParams),
      needsClarification: !!parsed.needsClarification,
      ambiguities: Array.isArray(parsed.ambiguities) ? parsed.ambiguities : [],
      outOfScopeReason: intent === 'out_of_scope' ? (parsed.outOfScopeReason || undefined) : undefined,
    };
  } catch (err) {
    console.error('[Chat:Extractor] LLM parse error:', err instanceof Error ? err.message : err);
    // Fallback: try heuristic before giving up
    const heuristicIntent = heuristicIntentFallback(question);
    if (heuristicIntent) {
      console.log(`[Chat:Extractor] Heuristic fallback: intent=${heuristicIntent}, people=[${extractPeopleHeuristic(question).join(', ')}], time="${extractTimeRangeHeuristic(question)}"`);
      return {
        ...DEFAULT_EXTRACTION,
        intent: heuristicIntent,
        people: extractPeopleHeuristic(question),
        timeRange: extractTimeRangeHeuristic(question),
        optimizationGoal: heuristicOptimizationGoal(question),
      };
    }
    console.log('[Chat:Extractor] No heuristic match — returning out_of_scope');
    return { ...DEFAULT_EXTRACTION };
  }
}
