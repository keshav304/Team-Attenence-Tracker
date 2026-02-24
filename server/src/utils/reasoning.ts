/**
 * Stage 4 — Deterministic Reasoning & Computation
 *
 * All computation is deterministic — no LLM calls.
 * Includes: comparison, overlap, optimization, simulation, trend analysis.
 */

import type { UserScheduleData, TeamPresenceDay, EntryData } from './dataRetrieval.js';
import { getDayOfWeek, formatDateNice } from './workingDays.js';
import type { ComplexIntent } from './complexityDetector.js';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface ComparisonResult {
  answersIntent: 'comparison';
  userA: { name: string; stats: UserScheduleData['stats'] };
  userB: { name: string; stats: UserScheduleData['stats'] };
  diff: number;
  whoHasMore: string;
  percentageDiff: number;
}

export interface TeamAvgComparisonResult {
  answersIntent: 'team_avg_comparison';
  user: { name: string; stats: UserScheduleData['stats'] };
  teamAvgOfficePercent: number;
  teamAvgOfficeDays: number;
  diff: number;
  aboveOrBelow: 'above' | 'below' | 'at';
}

export interface OverlapResult {
  answersIntent: 'overlap';
  userA: string;
  userB: string;
  totalOverlap: number;
  fullOverlapDays: string[];
  partialOverlapDays: string[];
  zeroOverlapDays: string[];
  workingDaysCount: number;
}

export interface MultiPersonOverlapResult {
  answersIntent: 'multi_person_coordination';
  people: string[];
  allInOfficeDays: string[];
  workingDaysCount: number;
}

export interface OptimizationRecommendation {
  date: string;
  day: string;
  score: number;
  reasons: string[];
}

export interface OptimizationResult {
  answersIntent: 'optimize' | 'avoid' | 'meeting_plan';
  goal: string;
  recommendations: OptimizationRecommendation[];
  constraints: string[];
}

export interface SimulationResult {
  answersIntent: 'simulate';
  proposedDays: string[];
  targetName: string;
  overlapDays: string[];
  overlapCount: number;
  totalProposed: number;
  overlapPercent: number;
}

export interface TrendResult {
  answersIntent: 'trend';
  userName: string;
  current: UserScheduleData['stats'];
  previous: UserScheduleData['stats'];
  currentLabel: string;
  previousLabel: string;
  diff: number;
  direction: 'more' | 'fewer' | 'same';
}

export type ReasoningResult =
  | ComparisonResult
  | TeamAvgComparisonResult
  | OverlapResult
  | MultiPersonOverlapResult
  | OptimizationResult
  | SimulationResult
  | TrendResult;

/* ------------------------------------------------------------------ */
/*  Presence scoring (handles half-day logic)                         */
/* ------------------------------------------------------------------ */

function getPresenceScore(entry: EntryData | undefined): number {
  if (!entry) return 0;
  if (entry.status === 'office') return 1.0;
  if (entry.status === 'leave') {
    if (entry.leaveDuration === 'half' && entry.workingPortion === 'office') return 0.5;
    return 0;
  }
  return 0; // WFH / no entry
}

/* ------------------------------------------------------------------ */
/*  Comparison Engine                                                 */
/* ------------------------------------------------------------------ */

export function computeComparison(
  scheduleA: UserScheduleData,
  scheduleB: UserScheduleData,
): ComparisonResult {
  const diff = scheduleA.stats.officeDays - scheduleB.stats.officeDays;
  const whoHasMore =
    diff > 0 ? scheduleA.name : diff < 0 ? scheduleB.name : 'tied';
  const percentageDiff =
    Math.abs(scheduleA.stats.officePercent - scheduleB.stats.officePercent);

  return {
    answersIntent: 'comparison',
    userA: { name: scheduleA.name, stats: scheduleA.stats },
    userB: { name: scheduleB.name, stats: scheduleB.stats },
    diff: Math.abs(diff),
    whoHasMore,
    percentageDiff,
  };
}

/**
 * Compare a user's schedule against the team average.
 * Automatically excludes userSchedule from allSchedules to avoid self-bias.
 */
export function computeTeamAvgComparison(
  userSchedule: UserScheduleData,
  allSchedules: UserScheduleData[],
): TeamAvgComparisonResult {
  // Exclude the user being compared so team average isn't self-biased
  const others = allSchedules.filter(
    (u) => u.userId !== userSchedule.userId,
  );

  const totalPercent = others.reduce((s, u) => s + u.stats.officePercent, 0);
  const totalDays = others.reduce((s, u) => s + u.stats.officeDays, 0);
  const teamAvgOfficePercent = others.length > 0
    ? Math.round(totalPercent / others.length)
    : 0;
  const teamAvgOfficeDays = others.length > 0
    ? Math.round((totalDays / others.length) * 10) / 10
    : 0;

  const diff = userSchedule.stats.officePercent - teamAvgOfficePercent;
  const aboveOrBelow = diff > 0 ? 'above' : diff < 0 ? 'below' : 'at';

  return {
    answersIntent: 'team_avg_comparison',
    user: { name: userSchedule.name, stats: userSchedule.stats },
    teamAvgOfficePercent,
    teamAvgOfficeDays,
    diff: Math.abs(diff),
    aboveOrBelow,
  };
}

/* ------------------------------------------------------------------ */
/*  Pairwise Overlap Calculator                                       */
/* ------------------------------------------------------------------ */

export function computeOverlap(
  scheduleA: UserScheduleData,
  scheduleB: UserScheduleData,
): OverlapResult {
  // Use the intersection of both schedules' working days
  const workingDaysSetB = new Set(scheduleB.workingDays);
  const workingDays = scheduleA.workingDays.filter((d) => workingDaysSetB.has(d));
  let totalOverlap = 0;
  const fullOverlapDays: string[] = [];
  const partialOverlapDays: string[] = [];
  const zeroOverlapDays: string[] = [];

  for (const day of workingDays) {
    const scoreA = getPresenceScore(scheduleA.entryMap[day]);
    const scoreB = getPresenceScore(scheduleB.entryMap[day]);
    const overlapScore = Math.min(scoreA, scoreB);

    if (overlapScore >= 1) {
      fullOverlapDays.push(day);
      totalOverlap += 1;
    } else if (overlapScore > 0) {
      partialOverlapDays.push(day);
      totalOverlap += overlapScore;
    } else {
      zeroOverlapDays.push(day);
    }
  }

  return {
    answersIntent: 'overlap',
    userA: scheduleA.name,
    userB: scheduleB.name,
    totalOverlap,
    fullOverlapDays,
    partialOverlapDays,
    zeroOverlapDays,
    workingDaysCount: workingDays.length,
  };
}

/* ------------------------------------------------------------------ */
/*  Multi-Person Coordination                                         */
/* ------------------------------------------------------------------ */

export function computeMultiPersonOverlap(
  schedules: UserScheduleData[],
): MultiPersonOverlapResult {
  if (schedules.length === 0) {
    return {
      answersIntent: 'multi_person_coordination',
      people: [],
      allInOfficeDays: [],
      workingDaysCount: 0,
    };
  }

  const workingDays = schedules[0].workingDays;
  const allInOfficeDays: string[] = [];

  for (const day of workingDays) {
    const allInOffice = schedules.every(
      (s) => getPresenceScore(s.entryMap[day]) >= 1,
    );
    if (allInOffice) {
      allInOfficeDays.push(day);
    }
  }

  return {
    answersIntent: 'multi_person_coordination',
    people: schedules.map((s) => s.name),
    allInOfficeDays,
    workingDaysCount: workingDays.length,
  };
}

/* ------------------------------------------------------------------ */
/*  Optimization Solver (with scoring transparency)                   */
/* ------------------------------------------------------------------ */

export function findOptimalDays(params: {
  userSchedule: UserScheduleData;
  targetSchedules: UserScheduleData[];
  teamPresence: TeamPresenceDay[];
  goal: string;
  constraints: string[];
  requiredDays?: number;
}): OptimizationResult {
  const { userSchedule, targetSchedules, teamPresence, goal, constraints, requiredDays } = params;
  const workingDays = userSchedule.workingDays;

  // Build team presence lookup
  const teamPresenceMap = new Map(teamPresence.map((tp) => [tp.date, tp]));

  // Parse day-of-week constraints
  const avoidDaysOfWeek = new Set<string>();
  const onlyDaysOfWeek = new Set<string>();
  for (const c of constraints) {
    const cl = c.toLowerCase();
    const avoidMatch = cl.match(/avoid\s+(monday|tuesday|wednesday|thursday|friday)s?/);
    if (avoidMatch) avoidDaysOfWeek.add(avoidMatch[1].charAt(0).toUpperCase() + avoidMatch[1].slice(1));
    
    const onlyMatch = cl.match(/only\s+(?:on\s+)?((?:(?:monday|tuesday|wednesday|thursday|friday)s?(?:\s+and\s+|\s*,\s*)?)+)/i);
    if (onlyMatch) {
      const dayNames = onlyMatch[1].match(/(monday|tuesday|wednesday|thursday|friday)/gi) || [];
      for (const dn of dayNames) {
        onlyDaysOfWeek.add(dn.charAt(0).toUpperCase() + dn.slice(1).toLowerCase());
      }
    }
  }

  const scored: OptimizationRecommendation[] = [];
  const answersIntent = goal.includes('avoid') ? 'avoid' as const
    : goal.includes('meeting') ? 'meeting_plan' as const
    : 'optimize' as const;

  for (const day of workingDays) {
    const dayOfWeek = getDayOfWeek(day);

    // Apply constraints
    if (avoidDaysOfWeek.has(dayOfWeek)) continue;
    if (onlyDaysOfWeek.size > 0 && !onlyDaysOfWeek.has(dayOfWeek)) continue;

    // Skip days where the user already has a leave entry
    const userEntry = userSchedule.entryMap[day];
    if (userEntry?.status === 'leave' && userEntry.leaveDuration !== 'half') continue;

    let score = 0;
    const reasons: string[] = [];
    const tp = teamPresenceMap.get(day);

    switch (goal) {
      case 'minimize_overlap': {
        for (const target of targetSchedules) {
          const targetScore = getPresenceScore(target.entryMap[day]);
          score += 1 - targetScore;
          if (targetScore === 0) {
            reasons.push(`${target.name} is NOT in office`);
          } else if (targetScore === 0.5) {
            reasons.push(`${target.name} is only half-day in office`);
          }
        }
        break;
      }
      case 'maximize_overlap':
      case 'meeting_plan': {
        for (const target of targetSchedules) {
          const targetScore = getPresenceScore(target.entryMap[day]);
          score += targetScore;
          if (targetScore >= 1) {
            reasons.push(`${target.name} is in office`);
          } else if (targetScore === 0.5) {
            reasons.push(`${target.name} is half-day in office`);
          }
        }
        break;
      }
      case 'minimize_commute': {
        // Base commute preference score — no consecutive-day logic implemented yet
        score += 0.5;
        reasons.push('Base commute preference score');
        break;
      }
      case 'least_crowded': {
        if (tp) {
          const ratio = tp.totalTeam > 0 ? tp.count / tp.totalTeam : 0;
          score += 1 - ratio;
          reasons.push(`${tp.count} of ${tp.totalTeam} people in office`);
        } else {
          score += 0.5;
          reasons.push('No attendance data for this day');
        }
        break;
      }
      case 'maximize_team_presence': {
        if (tp) {
          const ratio = tp.totalTeam > 0 ? tp.count / tp.totalTeam : 0;
          score += ratio;
          reasons.push(`${tp.count} of ${tp.totalTeam} people in office`);
        }
        break;
      }
      default: {
        // Default: maximize overlap with targets if any, else team presence
        if (targetSchedules.length > 0) {
          for (const target of targetSchedules) {
            score += getPresenceScore(target.entryMap[day]);
          }
        } else if (tp) {
          score += tp.totalTeam > 0 ? tp.count / tp.totalTeam : 0;
        }
      }
    }

    // Add day-of-week context
    reasons.push(dayOfWeek);

    scored.push({
      date: day,
      day: dayOfWeek,
      score: Math.round(score * 100) / 100,
      reasons,
    });
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Pick top N
  const count = requiredDays ?? Math.min(5, scored.length);
  const recommendations = scored.slice(0, count);

  return {
    answersIntent,
    goal,
    recommendations,
    constraints,
  };
}

/* ------------------------------------------------------------------ */
/*  Simulation Engine                                                 */
/* ------------------------------------------------------------------ */

export function simulateSchedule(params: {
  proposedDays: string[];
  targetSchedule: UserScheduleData;
}): SimulationResult {
  const { proposedDays, targetSchedule } = params;
  const overlapDays: string[] = [];

  for (const day of proposedDays) {
    const targetScore = getPresenceScore(targetSchedule.entryMap[day]);
    if (targetScore > 0) {
      overlapDays.push(day);
    }
  }

  return {
    answersIntent: 'simulate',
    proposedDays,
    targetName: targetSchedule.name,
    overlapDays,
    overlapCount: overlapDays.length,
    totalProposed: proposedDays.length,
    overlapPercent:
      proposedDays.length > 0
        ? Math.round((overlapDays.length / proposedDays.length) * 100)
        : 0,
  };
}

/**
 * Expand "every Tuesday" or ["tuesday"] into actual dates within working days.
 */
export function expandDayOfWeekToDateList(
  dayOfWeekNames: string[],
  workingDays: string[],
): string[] {
  const targetDays = new Set(dayOfWeekNames.map((d) => d.toLowerCase()));
  return workingDays.filter((wd) => {
    const dow = getDayOfWeek(wd).toLowerCase();
    return targetDays.has(dow);
  });
}

/* ------------------------------------------------------------------ */
/*  Trend Analyzer                                                    */
/* ------------------------------------------------------------------ */

export function computeTrend(
  currentSchedule: UserScheduleData,
  previousSchedule: UserScheduleData,
  currentLabel: string,
  previousLabel: string,
): TrendResult {
  const diff = currentSchedule.stats.officeDays - previousSchedule.stats.officeDays;
  const direction = diff > 0 ? 'more' : diff < 0 ? 'fewer' : 'same';

  return {
    answersIntent: 'trend',
    userName: currentSchedule.name,
    current: currentSchedule.stats,
    previous: previousSchedule.stats,
    currentLabel,
    previousLabel,
    diff: Math.abs(diff),
    direction,
  };
}
