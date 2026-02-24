/**
 * Stage 0 — Complexity Detector & Heuristic Router
 *
 * Determines whether a chat query should use the FAST PATH (deterministic
 * handlers, ~100-200ms) or the SLOW PATH (LLM extraction pipeline, ~3-8s).
 *
 * The existing classifyIntent() regex classification stays as the first
 * check; this module adds complexity signal detection.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export type SimpleIntent =
  | 'personal_attendance'
  | 'team_presence'
  | 'team_analytics'
  | 'event_query'
  | 'unknown';

export type ComplexIntent =
  | 'comparison'
  | 'overlap'
  | 'avoid'
  | 'optimize'
  | 'simulate'
  | 'meeting_plan'
  | 'trend'
  | 'multi_person_coordination'
  | 'clarify_needed'
  | 'out_of_scope'
  | 'explain_previous';

export type Intent = SimpleIntent | ComplexIntent;

export interface RoutingDecision {
  /** Whether to use the fast (deterministic) or slow (LLM) path */
  path: 'fast' | 'slow';
  /** The regex-detected intent (may be 'unknown' for complex queries) */
  simpleIntent: SimpleIntent;
  /** Whether complexity signals were detected */
  isComplex: boolean;
  /** Which complexity signals fired */
  signals: string[];
}

/* ------------------------------------------------------------------ */
/*  Regex Intent Classification (existing logic, unchanged)           */
/* ------------------------------------------------------------------ */

/** Classify the user query intent using regex. Fast path (~0ms). */
export function classifyIntent(question: string): SimpleIntent {
  const q = question;

  // Event queries
  if (
    /\b(event|party|town hall|offsite|mandatory office|highlighted|company event|deadline|office closed)\b/i.test(q)
  ) {
    return 'event_query';
  }

  // Personal attendance
  if (
    /\b(my|i(?=\s|$)|i'm|am i|do i)\b/i.test(q) &&
    /\b(office|leave|wfh|work from home|attendance|percentage|percent|days|schedule|coming|in office|mostly)\b/i.test(q)
  ) {
    return 'personal_attendance';
  }

  // Team analytics (aggregated)
  if (
    /\b(most|least|highest|lowest|busiest|peak|which day|how many people|how many employees|maximum|minimum|everyone|all)\b/i.test(q) &&
    /\b(office|attendance|presence|in office|coming)\b/i.test(q)
  ) {
    return 'team_analytics';
  }

  // Team presence (specific person or "who is")
  if (
    /\b(who is|who's|is \w+(?=\s|$)|when is|when's|when will|where is|\w+ coming|list .* office|list .* leave)\b/i.test(q) &&
    /\b(office|leave|wfh|tomorrow|today|monday|tuesday|wednesday|thursday|friday|next week|next month|this week|this month)\b/i.test(q)
  ) {
    return 'team_presence';
  }

  // Broader team presence catch
  if (/\b(who|is \w+)\b/i.test(q) && /\b(in office|on leave|wfh|working from home|on vacation)\b/i.test(q)) {
    return 'team_presence';
  }

  // Broader personal catch
  if (/\b(my|i(?=\s|$))\b/i.test(q) && /\b(calendar|schedule|office days|leave days)\b/i.test(q)) {
    return 'personal_attendance';
  }

  return 'unknown';
}

/* ------------------------------------------------------------------ */
/*  Complexity Signal Detection                                       */
/* ------------------------------------------------------------------ */

interface ComplexitySignal {
  name: string;
  pattern: RegExp;
}

const COMPLEXITY_SIGNALS: ComplexitySignal[] = [
  // Multi-person reference — second branch requires nearby attendance context
  // to avoid false positives on generic "X and Y" phrases like "pros and cons".
  {
    name: 'multi_person',
    pattern: /\b(compare|vs\.?|versus|and\s+\w+(?:'s)?)\b.*\b(office|attendance|days|schedule|overlap)\b|\b(me\s+and\s+\w+|I\s+and\s+\w+|\w+\s+and\s+\w+(?:'s)?)\b.*\b(office|attendance|days|schedule|overlap|leave|in today|coming in)\b/i,
  },
  // Optimization keywords
  {
    name: 'optimization',
    pattern: /\b(avoid|minimize|maximize|overlap|best day|optimal|suggest\s+(?:a\s+)?(?:day|office)|recommend|cluster|good day for)\b/i,
  },
  // Simulation keywords
  {
    name: 'simulation',
    pattern: /\b(if I\s+go|what if|suppose|assuming|hypothetically|if I\s+went|would I|will I have)\b/i,
  },
  // Comparative keywords
  {
    name: 'comparative',
    pattern: /\b(more than|less than|better|worse|beat|higher|lower|trend|increasing|decreasing|compared to|comparison)\b/i,
  },
  // Constraint keywords
  {
    name: 'constraint',
    pattern: /\b(but avoid|except|not on|only on|without|but not)\b/i,
  },
  // Ambiguous goal
  {
    name: 'ambiguous_goal',
    pattern: /\b(good day|good time|should I|best time|right time)\b/i,
  },
  // Meeting planning
  {
    name: 'meeting_plan',
    pattern: /\b(meeting with|meet with|in-person meeting|face to face|work together in office)\b/i,
  },
  // Team average comparison
  {
    name: 'team_avg_comparison',
    pattern: /\b(team average|average|below|above|ahead|behind)\b.*\b(attendance|office|days)\b/i,
  },
  // "Why did you" (explain previous)
  {
    name: 'explain_previous',
    pattern: /\b(why did you|why that|explain|reason for)\b.*\b(recommend|suggest|choose|pick)\b/i,
  },
  // "When will X and Y both..." (multi-person coordination)
  {
    name: 'multi_coordination',
    pattern: /\b(when will|when are)\b.*\b(both|all)\b.*\b(office|in)\b/i,
  },
];

/** Check for complexity signals in the question. Returns list of signal names. */
export function checkComplexitySignals(question: string): string[] {
  const signals: string[] = [];
  for (const signal of COMPLEXITY_SIGNALS) {
    if (signal.pattern.test(question)) {
      signals.push(signal.name);
    }
  }
  return signals;
}

/* ------------------------------------------------------------------ */
/*  Router                                                            */
/* ------------------------------------------------------------------ */

/**
 * Route the question to either the fast deterministic path or the
 * slow LLM extraction path.
 *
 * Decision logic:
 *   - If regex intent is known AND no complexity signals → FAST PATH
 *   - If regex intent is unknown OR complexity signals detected → SLOW PATH
 *
 * Bias toward escalation: a false-positive LLM call costs ~3s,
 * but a false-negative deterministic answer for a complex query is wrong.
 */
export function routeQuestion(question: string): RoutingDecision {
  const simpleIntent = classifyIntent(question);
  const signals = checkComplexitySignals(question);
  const isComplex = signals.length > 0;

  if (simpleIntent !== 'unknown' && !isComplex) {
    return { path: 'fast', simpleIntent, isComplex, signals };
  }

  return { path: 'slow', simpleIntent, isComplex, signals };
}
