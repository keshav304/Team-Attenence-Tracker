/**
 * Stage 5 — Relevance Guard
 *
 * Validates that the computed result actually answers the user's intent.
 * Prevents the "always return a generic summary" failure mode.
 */

import type { ComplexIntent } from './complexityDetector.js';
import type { ReasoningResult } from './reasoning.js';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface GuardResult {
  passed: boolean;
  /** If not passed, a fallback message to return to the user */
  fallbackMessage?: string;
}

/* ------------------------------------------------------------------ */
/*  Guard implementation                                              */
/* ------------------------------------------------------------------ */

/**
 * Validate that the computed result matches the user's intent.
 */
export function validateRelevance(
  intent: ComplexIntent,
  result: ReasoningResult | null,
): GuardResult {
  // No result at all
  if (!result) {
    return {
      passed: false,
      fallbackMessage: "I don't have enough data to answer that question. Could you rephrase or provide more details?",
    };
  }

  // Check that the result's answersIntent matches the requested intent
  const resultIntent = result.answersIntent;

  // Comparison intent but result is neither a two-person nor team-avg comparison
  if (
    intent === 'comparison' &&
    resultIntent !== 'comparison' &&
    resultIntent !== 'team_avg_comparison'
  ) {
    return {
      passed: false,
      fallbackMessage: "I couldn't retrieve data for both people to make a comparison.",
    };
  }

  // Overlap intent but no overlap computation
  if (intent === 'overlap' && resultIntent !== 'overlap') {
    return {
      passed: false,
      fallbackMessage: "I couldn't compute the overlap. Please make sure both people have schedule data.",
    };
  }

  // Optimization intent but no scored recommendations
  if (
    (intent === 'optimize' || intent === 'avoid' || intent === 'meeting_plan') &&
    resultIntent !== 'optimize' &&
    resultIntent !== 'avoid' &&
    resultIntent !== 'meeting_plan'
  ) {
    return {
      passed: false,
      fallbackMessage: 'Not enough schedule data to make recommendations.',
    };
  }

  // Check for empty optimization recommendations
  if (
    (resultIntent === 'optimize' || resultIntent === 'avoid' || resultIntent === 'meeting_plan') &&
    'recommendations' in result
  ) {
    const opt = result as any;
    if (!opt.recommendations || opt.recommendations.length === 0) {
      return {
        passed: false,
        fallbackMessage: 'No suitable days found matching your criteria. Try relaxing your constraints.',
      };
    }
  }

  // Simulation with empty results
  if (intent === 'simulate' && resultIntent !== 'simulate') {
    return {
      passed: false,
      fallbackMessage: "I couldn't run the simulation. Please make sure you specified valid days and a target person.",
    };
  }

  if (intent === 'simulate' && resultIntent === 'simulate') {
    const sim = result as any;
    if (!sim.totalProposed || (sim.totalProposed ?? 0) === 0) {
      return {
        passed: false,
        fallbackMessage: 'No proposed days fell within the working days of the given period.',
      };
    }
  }

  return { passed: true };
}
