/**
 * Chat Pipeline Orchestrator
 *
 * Ties together all stages:
 *   Stage 0 — Complexity Detector & Heuristic Router
 *   Stage 1 — LLM Structured Extraction
 *   Stage 2 — Entity + Time Resolution
 *   Stage 3 — Data Retrieval
 *   Stage 4 — Deterministic Reasoning
 *   Stage 5 — Relevance Guard
 *   Stage 6 — Response Generation
 *   Stage 7 — Confidence & Explanation Layer
 *
 * The fast path (simple queries) delegates to existing deterministic handlers.
 * The slow path (complex queries) goes through the full pipeline.
 */

import { routeQuestion, type Intent } from '../utils/complexityDetector.js';
import { extractStructured, type HistoryMessage } from '../utils/llmExtractor.js';
import { resolveTimePeriod, resolveTimeFromExtracted, type DateRange } from '../utils/timeResolver.js';
import { resolvePeople, type ResolvedPerson } from '../utils/personResolver.js';
import {
  getUserScheduleData,
  getMultipleUserSchedules,
  getTeamPresenceByDay,
  type UserScheduleData,
  type DataCoverage,
} from '../utils/dataRetrieval.js';
import {
  computeComparison,
  computeTeamAvgComparison,
  computeOverlap,
  computeMultiPersonOverlap,
  findOptimalDays,
  simulateSchedule,
  expandDayOfWeekToDateList,
  computeTrend,
  type ReasoningResult,
} from '../utils/reasoning.js';
import { validateRelevance } from '../utils/relevanceGuard.js';
import {
  generateResponse,
  buildOutOfScopeResponse,
  buildClarificationResponse,
} from '../utils/responseGenerator.js';
import { getMonthRange } from '../utils/workingDays.js';
import User from '../models/User.js';
import { getTodayString } from '../utils/date.js';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const TEAM_USER_LIMIT = 200;

/**
 * Fetch all active users' schedules and compute a team-average comparison
 * against the given target schedule.
 */
async function computeTeamAvgFor(
  targetSchedule: UserScheduleData,
  startDate: string,
  endDate: string,
): Promise<ReasoningResult> {
  const allUsers = await User.find({ isActive: true }).select('name').limit(TEAM_USER_LIMIT);
  const allPeople: ResolvedPerson[] = allUsers.map((u) => ({
    userId: u._id.toString(),
    name: u.name,
  }));
  const allSchedules = await getMultipleUserSchedules(
    allPeople,
    startDate,
    endDate,
  );
  return computeTeamAvgComparison(targetSchedule, allSchedules);
}

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface PipelineInput {
  question: string;
  user: { _id: any; name: string };
  history?: HistoryMessage[];
}

export interface PipelineOutput {
  answer: string;
  intent: Intent;
  /** Whether the slow (LLM) path was used */
  usedLlm: boolean;
}

/* ------------------------------------------------------------------ */
/*  Fast path — existing deterministic handlers re-export             */
/* ------------------------------------------------------------------ */

// We import classifyAndAnswer dynamically to avoid circular deps
type ClassifyAndAnswerFn = typeof import('../controllers/analyticsController.js')['classifyAndAnswer'];
let _classifyAndAnswer: ClassifyAndAnswerFn | null = null;

async function getFastPathHandler() {
  if (!_classifyAndAnswer) {
    const mod = await import('../controllers/analyticsController.js');
    _classifyAndAnswer = mod.classifyAndAnswer;
  }
  return _classifyAndAnswer;
}

/* ------------------------------------------------------------------ */
/*  Slow path — complex query pipeline                                */
/* ------------------------------------------------------------------ */

async function handleComplexQuery(
  input: PipelineInput,
): Promise<PipelineOutput> {
  const { question, user, history } = input;

  // ── Stage 1: LLM Structured Extraction ──────────────────────────
  const extraction = await extractStructured(question, history);

  // Handle out-of-scope immediately
  if (extraction.intent === 'out_of_scope') {
    return {
      answer: buildOutOfScopeResponse(extraction.outOfScopeReason || undefined),
      intent: 'out_of_scope',
      usedLlm: true,
    };
  }

  // Handle clarification needed
  if (extraction.needsClarification && extraction.ambiguities.length > 0) {
    return {
      answer: buildClarificationResponse(extraction.ambiguities),
      intent: 'clarify_needed',
      usedLlm: true,
    };
  }

  // Handle explain_previous (needs conversation history)
  if (extraction.intent === 'explain_previous') {
    if (history && history.length > 0) {
      const lastAssistant = [...history].reverse().find((h) => h.role === 'assistant');
      if (lastAssistant) {
        return {
          answer: `Here's what I previously said:\n\n${lastAssistant.text}`,
          intent: 'explain_previous',
          usedLlm: false,
        };
      }
    }
    return {
      answer: "I don't have a previous response to explain. Could you ask a new question?",
      intent: 'explain_previous',
      usedLlm: false,
    };
  }

  // ── Stage 2: Entity + Time Resolution ───────────────────────────

  // Resolve people
  const peopleRefs = extraction.people.length > 0
    ? extraction.people
    : ['me']; // Default to current user

  const personResult = await resolvePeople(peopleRefs, user);

  // Return clarification if there's person ambiguity
  if (personResult.clarification && personResult.resolved.length === 0) {
    return {
      answer: personResult.clarification,
      intent: 'clarify_needed',
      usedLlm: true,
    };
  }

  // Resolve time
  const dateRange = resolveTimeFromExtracted(extraction, question);

  // ── Stage 3: Data Retrieval ─────────────────────────────────────

  const schedules = await getMultipleUserSchedules(
    personResult.resolved,
    dateRange.startDate,
    dateRange.endDate,
  );

  const coverages: DataCoverage[] = schedules.map((s) => s.coverage);

  // ── Stage 4: Deterministic Reasoning ────────────────────────────

  let result: ReasoningResult | null = null;

  try {
    switch (extraction.intent) {
      case 'comparison': {
        if (schedules.length >= 2) {
          // Check if it's a "team average" comparison
          const q = question.toLowerCase();
          if (/\b(team average|average|below|above)\b/.test(q)) {
            const mySchedule = schedules.find(
              (s) => s.userId === user._id.toString(),
            ) || schedules[0];
            result = await computeTeamAvgFor(mySchedule, dateRange.startDate, dateRange.endDate);
          } else {
            result = computeComparison(schedules[0], schedules[1]);
          }
        } else if (schedules.length === 1) {
          // Comparison against team average
          result = await computeTeamAvgFor(schedules[0], dateRange.startDate, dateRange.endDate);
        }
        break;
      }

      case 'overlap': {
        if (schedules.length >= 2) {
          result = computeOverlap(schedules[0], schedules[1]);
        }
        break;
      }

      case 'multi_person_coordination': {
        if (schedules.length >= 2) {
          result = computeMultiPersonOverlap(schedules);
        }
        break;
      }

      case 'avoid': {
        const mySchedule = schedules.find(
          (s) => s.userId === user._id.toString(),
        ) || schedules[0];
        const targets = schedules.filter(
          (s) => s.userId !== user._id.toString(),
        );
        if (targets.length === 0 && schedules.length >= 2) {
          // If the user isn't one of the resolved people, use first as "me"
          const tp = await getTeamPresenceByDay(dateRange.startDate, dateRange.endDate);
          result = findOptimalDays({
            userSchedule: schedules[0],
            targetSchedules: schedules.slice(1),
            teamPresence: tp,
            goal: 'minimize_overlap',
            constraints: extraction.constraints,
          });
        } else {
          const tp = await getTeamPresenceByDay(dateRange.startDate, dateRange.endDate);
          result = findOptimalDays({
            userSchedule: mySchedule,
            targetSchedules: targets,
            teamPresence: tp,
            goal: 'minimize_overlap',
            constraints: extraction.constraints,
          });
        }
        break;
      }

      case 'optimize': {
        const mySchedule = schedules.find(
          (s) => s.userId === user._id.toString(),
        ) || schedules[0];
        const targets = schedules.filter(
          (s) => s.userId !== user._id.toString(),
        );
        const tp = await getTeamPresenceByDay(dateRange.startDate, dateRange.endDate);
        const goal = extraction.optimizationGoal || 'maximize_overlap';

        result = findOptimalDays({
          userSchedule: mySchedule,
          targetSchedules: targets,
          teamPresence: tp,
          goal,
          constraints: extraction.constraints,
        });
        break;
      }

      case 'meeting_plan': {
        const mySchedule = schedules.find(
          (s) => s.userId === user._id.toString(),
        ) || schedules[0];
        const targets = schedules.filter(
          (s) => s.userId !== user._id.toString(),
        );
        const tp = await getTeamPresenceByDay(dateRange.startDate, dateRange.endDate);

        result = findOptimalDays({
          userSchedule: mySchedule,
          targetSchedules: targets,
          teamPresence: tp,
          goal: 'meeting_plan',
          constraints: extraction.constraints,
        });
        break;
      }

      case 'simulate': {
        const mySchedule = schedules.find(
          (s) => s.userId === user._id.toString(),
        ) || schedules[0];
        const target = schedules.find(
          (s) => s.userId !== user._id.toString(),
        );

        if (target) {
          let proposedDays: string[] = [];

          // Expand "every Tuesday" to actual dates
          if (extraction.simulationParams?.proposedDayOfWeek?.length) {
            proposedDays = expandDayOfWeekToDateList(
              extraction.simulationParams.proposedDayOfWeek,
              mySchedule.workingDays,
            );
          } else if (extraction.simulationParams?.proposedDays?.length) {
            proposedDays = extraction.simulationParams.proposedDays;
          }

          if (proposedDays.length > 0) {
            result = simulateSchedule({
              proposedDays,
              targetSchedule: target,
            });
          }
        }
        break;
      }

      case 'trend': {
        // Current vs previous period
        const todayStr = getTodayString();
        const today = new Date(todayStr + 'T00:00:00');
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth();

        const currentRange = getMonthRange(currentYear, currentMonth + 1);
        const prevMonth = new Date(currentYear, currentMonth - 1, 1);
        const previousRange = getMonthRange(prevMonth.getFullYear(), prevMonth.getMonth() + 1);

        const me = personResult.resolved.find(
          (p) => p.userId === user._id.toString(),
        ) || personResult.resolved[0];

        if (me) {
          const [currentSchedule, previousSchedule] = await Promise.all([
            getUserScheduleData(me, currentRange.startDate, currentRange.endDate),
            getUserScheduleData(me, previousRange.startDate, previousRange.endDate),
          ]);

          result = computeTrend(
            currentSchedule,
            previousSchedule,
            'this month',
            'last month',
          );
          // Use trend-specific coverages so Stage 3 coverages are not mixed in
          const trendCoverages: DataCoverage[] = [currentSchedule.coverage, previousSchedule.coverage];
          coverages.length = 0;
          coverages.push(...trendCoverages);
        }
        break;
      }
    }
  } catch (err) {
    console.error('Pipeline Stage 4 error:', {
      question,
      intent: extraction.intent,
      error: err instanceof Error ? { message: err.message, stack: err.stack } : err,
    });
    throw err;
  }

  // ── Stage 5: Relevance Guard ────────────────────────────────────

  const guardResult = validateRelevance(extraction.intent, result);
  if (!guardResult.passed) {
    return {
      answer: guardResult.fallbackMessage || "I couldn't process that query. Please try rephrasing.",
      intent: extraction.intent,
      usedLlm: true,
    };
  }

  // ── Stage 6 + 7: Response Generation + Confidence Layer ─────────

  if (!result) {
    return {
      answer: "I couldn't process that query. Please try rephrasing.",
      intent: extraction.intent,
      usedLlm: true,
    };
  }

  const answer = await generateResponse(
    result,
    coverages,
    question,
    false, // Use templates by default; set true for LLM paraphrase
  );

  // Prepend person clarification if we proceeded despite ambiguity
  let finalAnswer = answer;
  if (personResult.clarification && personResult.resolved.length > 0) {
    finalAnswer = `Note: ${personResult.clarification}\n\n${answer}`;
  }

  return {
    answer: finalAnswer,
    intent: extraction.intent,
    usedLlm: true,
  };
}

/* ------------------------------------------------------------------ */
/*  Main pipeline entry point                                         */
/* ------------------------------------------------------------------ */

/**
 * Process a chat question through the full pipeline.
 *
 * Returns the answer string and metadata about how it was generated.
 */
export async function processQuestion(
  input: PipelineInput,
): Promise<PipelineOutput> {
  const { question, user, history } = input;
  const q = question.trim();

  // ── Stage 0: Heuristic Router ───────────────────────────────────

  const routing = routeQuestion(q);

  if (routing.path === 'fast') {
    // Use existing deterministic handlers
    try {
      const handler = await getFastPathHandler();
      if (handler) {
        const answer = await handler(q, user);
        if (answer) {
          return {
            answer,
            intent: routing.simpleIntent,
            usedLlm: false,
          };
        }
      }
    } catch (err) {
      console.warn('Pipeline: fast path handler failed, falling through to slow path:', err);
    }
    // If fast path returns null, fall through to slow path
  }

  // ── Slow path: full LLM pipeline ───────────────────────────────

  try {
    return await handleComplexQuery(input);
  } catch (err) {
    console.error('Pipeline: slow path failed:', err);
    return {
      answer: 'Sorry, I encountered an error processing your question. Please try again or rephrase your query.',
      intent: 'unknown' as Intent,
      usedLlm: true,
    };
  }
}
