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
import { callLLMProvider } from './llmProvider.js';
import type { ComplexIntent } from './complexityDetector.js';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const VALID_COMPLEX_INTENTS: ReadonlySet<string> = new Set<ComplexIntent | 'team_analytics'>([
  'comparison', 'overlap', 'avoid', 'optimize', 'simulate',
  'meeting_plan', 'trend', 'multi_person_coordination',
  'clarify_needed', 'out_of_scope', 'explain_previous',
  'team_analytics',
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
/*  LLM Call                                                          */
/* ------------------------------------------------------------------ */

/**
 * Call the centralized LLM provider to extract structured data.
 * Delegates model selection and provider switching to llmProvider.
 */
async function callLLM(messages: Array<{ role: string; content: string }>): Promise<string> {
  return callLLMProvider({
    messages: messages as { role: 'system' | 'user' | 'assistant'; content: string }[],
    maxTokens: 1024,
    temperature: 0.1,
    timeoutMs: 15_000,
    jsonMode: true,
    logPrefix: 'Chat:Extractor',
  });
}

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
  "intent": "<comparison | overlap | avoid | optimize | simulate | meeting_plan | trend | multi_person_coordination | team_analytics | clarify_needed | out_of_scope | explain_previous>",
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
→ Compare attendance metrics between TWO SPECIFIC named people  
Examples: "compare me and Bala", "who came more — me or Rahul"  

overlap  
→ Measure shared office presence between named people  
Examples: "how many days did we work together", "overlap between me and Bala"  

avoid  
→ Minimize overlap with someone  
Examples: "avoid Bala", "least overlap with Priya"  

optimize  
→ Recommend SPECIFIC DAYS for a person based on a goal  
Examples: "best days to go", "maximize collaboration", "which 3-day combination maximizes overlap"  

simulate  
→ ANY hypothetical "what if" scenario that modifies attendance data  
Includes: adding/removing days, shifting attendance, removing people, team-wide hypotheticals  
Trigger words: "if", "what if", "suppose", "assuming", "hypothetically", "remove", "shift", "skip", "cancel", "redistribute"  
Examples:  
  • "if I go every Tuesday" → simulate  
  • "if Rahul skips Monday" → simulate  
  • "if everyone adds one extra day" → simulate  
  • "if we shift Tuesday to Wednesday" → simulate  
  • "if we remove the top 10% attendees" → simulate  
  • "if we remove all holidays" → simulate  
  • "if we cancel the lowest day" → simulate  
  • "if we redistribute evenly" → simulate  

meeting_plan  
→ Suggest days when people can meet in office  

trend  
→ Compare the SAME PERSON's attendance across TWO different time periods  
Examples: "my attendance this month vs last month", "am I going to office more or less than before"  
⚠ ONLY use trend when comparing the SAME person across DIFFERENT periods.  
⚠ Do NOT use trend for team-level aggregate questions — use team_analytics instead.  
⚠ Do NOT use trend for hypothetical modifications — use simulate instead.  

team_analytics  
→ Aggregate team-level questions about attendance patterns (no hypothetical changes)  
Includes: busiest day, highest/lowest attendance weekday, peak day, crowded week, average per day, threshold counting, period comparisons for the TEAM  
Examples:  
  • "which weekday has highest attendance" → team_analytics  
  • "busiest Friday next month" → team_analytics  
  • "most crowded week" → team_analytics  
  • "how many days qualify for 70% presence" → team_analytics  
  • "which day has peak attendance" → team_analytics  
  • "what is average attendance per day" → team_analytics  
  • "which 2 consecutive days have highest combined attendance" → team_analytics  
  • "compare first half vs second half" → team_analytics  
  • "earliest day where attendance exceeds X" → team_analytics  
  • "which week is most sensitive to absence" → team_analytics  

multi_person_coordination  
→ Coordination involving 2+ other people  

explain_previous  
→ Follow-up asking for explanation of earlier recommendation  

clarify_needed  
→ Missing CRITICAL information AND the question cannot be reasonably interpreted  
⚠ Do NOT use clarify_needed for well-formed hypothetical questions.  
⚠ "If X does Y" is NOT ambiguous — classify as simulate.  

out_of_scope  
→ Outside attendance domain  

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## DISAMBIGUATION RULES (CRITICAL)

When a question contains "if" + a modification → ALWAYS use simulate, never trend or team_analytics.  
When a question asks about aggregate team stats without modification → use team_analytics, never trend.  
When a question mentions "which weekday / busiest / peak / average attendance" for the team → team_analytics.  
trend is ONLY for comparing the same person's data across 2 periods (no modifications).  

Priority: simulate > team_analytics > trend  
(If the question has an "if" hypothetical AND asks about team stats, use simulate.)  

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## PEOPLE EXTRACTION RULES

• Include all referenced individuals
• Use lowercase as written unless proper name
• "me", "my", "I" → include "me"
• "my team" → include "my team"
• If no explicit person but required → assume ["me"]
• Handle multiple names
• Ignore titles (Mr., Dr., etc.)

### PRONOUN / COREFERENCE RESOLUTION (CRITICAL)

When the user uses pronouns like "him", "her", "them", "they", "that person",
"this person", "the same person", "same people", or repeats a reference from
an earlier turn, you MUST resolve these to the actual person name(s) from the
conversation history.

Examples:
 - Previous turn mentioned "Rahul", current question says "avoid him" → people: ["me", "Rahul"]
 - Previous turn about "Priya and Amit", current says "overlap with them" → people: ["me", "Priya", "Amit"]
 - Previous turn about "Bala", current says "what about that person next week" → people: ["me", "Bala"]

⚠ NEVER output pronouns (him, her, them, etc.) in the people array.
⚠ ALWAYS replace pronouns with the resolved name from conversation history.
⚠ If you cannot resolve a pronoun, set needsClarification=true with an ambiguity of type "person".

Examples:

"compare me and Bala" → ["me","Bala"]  
"avoid Rahul and Priya" → ["me","Rahul","Priya"]
"avoid him" (history mentions Rahul) → ["me","Rahul"]  
"overlap with them" (history mentions Priya and Amit) → ["me","Priya","Amit"]

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
• "if we..."
• "if everyone..."
• "if [name] skips/adds/shifts..."
• "suppose"
• "what if"
• "assuming"
• "remove" / "cancel" / "shift" / "redistribute" (implying modification)

Extract:

proposedDays → explicit dates  
proposedDayOfWeek → weekday patterns  

⚠ ANY question starting with "if" that modifies attendance → intent MUST be simulate.  

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

Q: "which weekday has the highest average attendance this month"

A:
{"intent":"team_analytics","people":[],"timeRange":"this month","constraints":[],"optimizationGoal":null,"simulationParams":{"proposedDays":[],"proposedDayOfWeek":[]},"needsClarification":false,"ambiguities":[],"outOfScopeReason":null}

Q: "if Rahul skips his Monday next week, does the peak attendance day change"

A:
{"intent":"simulate","people":["Rahul"],"timeRange":"next week","constraints":["skips Monday"],"optimizationGoal":null,"simulationParams":{"proposedDays":[],"proposedDayOfWeek":["monday"]},"needsClarification":false,"ambiguities":[],"outOfScopeReason":null}

Q: "if we remove all public holidays next month, what is the new average attendance per day"

A:
{"intent":"simulate","people":[],"timeRange":"next month","constraints":["remove public holidays"],"optimizationGoal":null,"simulationParams":{"proposedDays":[],"proposedDayOfWeek":[]},"needsClarification":false,"ambiguities":[],"outOfScopeReason":null}

Q: "if we remove the top 10% most frequent attendees next month, does the busiest day change"

A:
{"intent":"simulate","people":[],"timeRange":"next month","constraints":["remove top 10% most frequent attendees"],"optimizationGoal":null,"simulationParams":{"proposedDays":[],"proposedDayOfWeek":[]},"needsClarification":false,"ambiguities":[],"outOfScopeReason":null}

Q: "if we require at least 70% team presence next month, how many days qualify"

A:
{"intent":"team_analytics","people":[],"timeRange":"next month","constraints":["at least 70% team presence"],"optimizationGoal":null,"simulationParams":{"proposedDays":[],"proposedDayOfWeek":[]},"needsClarification":false,"ambiguities":[],"outOfScopeReason":null}
`;

/* ------------------------------------------------------------------ */
/*  Heuristic Fallback (safety net when LLM misclassifies)            */
/* ------------------------------------------------------------------ */

/**
 * If the LLM returns out_of_scope but the question clearly matches
 * a supported intent, override with a heuristic guess.
 */
function heuristicIntentFallback(question: string): ComplexIntent | null {
  const q = question.toLowerCase();

  // ── SIMULATE: any "if" + modification verb → simulate ──────────
  // This must come FIRST (highest priority per disambiguation rules).
  if (
    /\b(if\s+we|if\s+everyone|if\s+\w+\s+(skip|shift|add|remove|cancel|redistribute)|what\s+if|if\s+we\s+(remove|shift|cancel|require|avoid|redistribute))\b/.test(q) &&
    /\b(attendance|office|day|week|month|peak|busiest|crowded|average|holiday)\b/.test(q)
  ) {
    return 'simulate';
  }

  // "if I go" / "what if"
  if (/\b(if\s+i\s+go|what\s+if)\b/.test(q)) return 'simulate';

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

  // Team analytics: busiest/quietest/crowded + weekday/week, or weekday + highest/average,
  // or threshold questions, or "how many days qualify"
  if (
    (/\b(busiest|most\s+crowded|quietest|crowded|highest|lowest|peak)\b/.test(q) &&
     /\b(week|monday|tuesday|wednesday|thursday|friday|weekday|day|attendance)\b/.test(q)) ||
    (/\b(compare|vs\.?|versus)\b/.test(q) && /\b(first half|second half|half)\b/.test(q)) ||
    (/\b(which\s+weekday|which\s+day|average\s+attendance)\b/.test(q)) ||
    (/\b(how\s+many\s+days|qualify|exceed|threshold|percent\s+.*presence)\b/.test(q)) ||
    (/\b(earliest|latest|most\s+sensitive)\b/.test(q) && /\b(day|week|attendance)\b/.test(q)) ||
    (/\b(consecutive|combined)\b/.test(q) && /\b(day|attendance)\b/.test(q))
  ) {
    return 'team_analytics' as any;
  }

  // "trend" / "increasing" / "decreasing"
  if (/\b(trend|increasing|decreasing|over\s+time)\b/.test(q)) return 'trend';

  return null;
}

/**
 * Heuristic optimization goal extraction from the question text.
 */
/* ------------------------------------------------------------------ */
/*  Pronoun resolution from conversation history                      */
/* ------------------------------------------------------------------ */

/** Common pronouns that should be resolved from conversation history */
const PRONOUNS = new Set(['him', 'her', 'them', 'they', 'he', 'she', 'that person', 'this person', 'the same person', 'same people']);

/** Precompiled word-boundary regexes for each pronoun (built once at module load) */
const PRONOUN_REGEXES: RegExp[] = [...PRONOUNS].map(
  (p) => new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
);

/** Check if a question contains pronouns that need resolution */
function containsPronouns(question: string): boolean {
  const q = question.toLowerCase();
  for (const re of PRONOUN_REGEXES) {
    if (re.test(q)) return true;
  }
  return false;
}

/**
 * Extract person names mentioned in conversation history messages.
 * Scans assistant responses for patterns like "rahul is in office",
 * "overlap with Rahul", etc.
 */
function extractNamesFromHistory(history?: HistoryMessage[]): string[] {
  if (!history || history.length === 0) return [];

  const names = new Set<string>();
  // Common words to exclude
  const EXCLUDE = new Set([
    'the', 'a', 'an', 'is', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or',
    'not', 'no', 'yes', 'with', 'from', 'by', 'as', 'it', 'be', 'was', 'were',
    'are', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'i', 'me', 'my',
    'we', 'our', 'you', 'your', 'they', 'them', 'their', 'he', 'him', 'his',
    'she', 'her', 'office', 'wfh', 'leave', 'home', 'work', 'day', 'days',
    'week', 'month', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
    'saturday', 'sunday', 'overlap', 'attendance', 'schedule', 'team', 'best',
    'maximum', 'minimum', 'note', 'some', 'data', 'may', 'set', 'incomplete',
    // Common sentence-starting / interrogative words
    'what', 'which', 'when', 'where', 'who', 'whom', 'how', 'why',
    'next', 'last', 'same', 'also', 'just', 'only', 'even', 'any', 'all',
    'tell', 'show', 'give', 'find', 'list', 'get', 'check', 'compare',
    'does', 'want', 'need', 'like', 'please', 'thanks', 'sure', 'okay',
    // Month names (sentence-starting false positives)
    'january', 'february', 'march', 'april', 'june', 'july',
    'august', 'september', 'october', 'november', 'december',
  ]);

  for (const msg of history) {
    const text = msg.text;

    // Pattern: "<Name> is in office" / "<Name> is not coming" / "<Name>'s schedule"
    const namePatterns = text.match(/\b([A-Z][a-z]{2,})(?:'s|\s+is|\s+has|\s+was|\s+will|\s+attend|\s+coming|\s+present|\s+absent)\b/g);
    if (namePatterns) {
      for (const match of namePatterns) {
        const name = match.match(/^([A-Z][a-z]{2,})/)?.[1];
        if (name && !EXCLUDE.has(name.toLowerCase())) {
          names.add(name);
        }
      }
    }

    // Pattern: "with <Name>" / "avoid <Name>" / "overlap with <Name>"
    const withPatterns = text.match(/\b(?:with|avoid|from|and|between)\s+([A-Z][a-z]{2,})\b/gi);
    if (withPatterns) {
      for (const match of withPatterns) {
        const name = match.match(/\s([A-Z][a-z]{2,})$/i)?.[1];
        if (name && !EXCLUDE.has(name.toLowerCase())) {
          // Capitalize first letter
          names.add(name.charAt(0).toUpperCase() + name.slice(1).toLowerCase());
        }
      }
    }

    // Pattern: user questions mentioning names directly
    if (msg.role === 'user') {
      // Match capitalized words that look like names (not at start of sentence only)
      const userNameMatches = text.match(/\b([A-Z][a-z]{2,})\b/g);
      if (userNameMatches) {
        for (const name of userNameMatches) {
          if (!EXCLUDE.has(name.toLowerCase())) {
            names.add(name);
          }
        }
      }
    }
  }

  return Array.from(names);
}

/**
 * Resolve pronouns in a question using conversation history.
 * Returns resolved person names for any pronouns found.
 */
function resolvePronounsFromHistory(question: string, history?: HistoryMessage[]): string[] {
  if (!containsPronouns(question)) return [];
  return extractNamesFromHistory(history);
}

/**
 * Post-process the LLM's people array to resolve any remaining pronouns.
 * If the LLM returned pronouns (him, her, them, etc.) or if the question
 * contains pronouns but the people array is empty/only has "me",
 * resolve from conversation history.
 */
function resolvePronouns(people: string[], question: string, history?: HistoryMessage[]): string[] {
  const resolved = [...people];
  let needsResolution = false;

  // Check if any entry in people is a pronoun
  for (let i = 0; i < resolved.length; i++) {
    if (PRONOUNS.has(resolved[i].toLowerCase())) {
      needsResolution = true;
      resolved.splice(i, 1); // remove the pronoun
      i--;
    }
  }

  // Also check if the question has pronouns but LLM didn't extract any person beyond "me"
  if (!needsResolution && containsPronouns(question)) {
    const nonSelf = resolved.filter(p => !['me', 'my', 'i', 'myself'].includes(p.toLowerCase()));
    if (nonSelf.length === 0) {
      needsResolution = true;
    }
  }

  if (needsResolution) {
    const historyNames = extractNamesFromHistory(history);
    if (historyNames.length > 0) {
      for (const name of historyNames) {
        if (!resolved.some(p => p.toLowerCase() === name.toLowerCase())) {
          resolved.push(name);
          console.log(`[Chat:Extractor] Pronoun resolution: resolved pronoun → "${name}" from history`);
        }
      }
    }
  }

  return resolved;
}

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
function extractPeopleHeuristic(question: string, history?: HistoryMessage[]): string[] {
  const people: string[] = ['me'];
  const q = question.toLowerCase();

  // "with <name>"
  const withMatch = q.match(/\b(?:with|avoid|from)\s+([a-z]+)\b/);
  if (withMatch && !['the', 'a', 'my', 'this', 'that', 'it', 'them', 'him', 'her', 'office', 'leave'].includes(withMatch[1])) {
    const titleCased = withMatch[1].charAt(0).toUpperCase() + withMatch[1].slice(1);
    people.push(titleCased);
  }

  // Resolve pronouns from conversation history
  const resolvedFromHistory = resolvePronounsFromHistory(q, history);
  if (resolvedFromHistory.length > 0) {
    for (const name of resolvedFromHistory) {
      if (!people.some(p => p.toLowerCase() === name.toLowerCase())) {
        people.push(name);
      }
    }
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

    // ── Heuristic correction for common LLM misclassifications ────
    // The LLM sometimes misclassifies:
    //   - hypothetical "if" questions as trend (should be simulate)
    //   - team aggregate questions as trend (should be team_analytics)
    //   - well-formed hypotheticals as clarify_needed (should be simulate)
    //   - in-scope questions as out_of_scope
    const needsHeuristicCheck =
      intent === 'out_of_scope' ||
      intent === 'clarify_needed' ||
      (intent === 'trend' && /\b(if\s+we|if\s+everyone|if\s+\w+\s+skip|remove|shift|cancel)\b/i.test(question)) ||
      (intent === 'trend' && /\b(which\s+weekday|busiest|peak|highest|average\s+attendance|how\s+many)\b/i.test(question));

    if (needsHeuristicCheck) {
      const heuristicIntent = heuristicIntentFallback(question);
      if (heuristicIntent) {
        intent = heuristicIntent;
        console.log(`[Chat:Extractor] Heuristic override: LLM said ${llmIntent} → ${heuristicIntent}`);
      }
    }

    console.log(`[Chat:Extractor] Extracted: intent=${intent}${llmIntent !== intent ? ` (LLM: ${llmIntent})` : ''}, people=[${(parsed.people || []).join(', ')}], time="${parsed.timeRange || 'this month'}", goal=${parsed.optimizationGoal || 'none'}`);

    // ── Post-processing: resolve any pronouns the LLM didn't catch ──
    let people: string[] = Array.isArray(parsed.people) ? parsed.people : [];
    people = resolvePronouns(people, question, history);

    // Validate and normalize
    return {
      intent,
      people,
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
      const people = extractPeopleHeuristic(question, history);
      const timeRange = extractTimeRangeHeuristic(question);
      console.log(`[Chat:Extractor] Heuristic fallback: intent=${heuristicIntent}, people=[${people.join(', ')}], time="${timeRange}"`);
      return {
        ...DEFAULT_EXTRACTION,
        intent: heuristicIntent,
        people,
        timeRange,
        optimizationGoal: heuristicOptimizationGoal(question),
      };
    }
    console.log('[Chat:Extractor] No heuristic match — returning out_of_scope');
    return { ...DEFAULT_EXTRACTION };
  }
}
