/**
 * Stage 6 + 7 — Response Generator (Natural Language + Confidence Layer)
 *
 * Converts structured computation results into natural language responses.
 * Appends data-coverage warnings and explanation annotations.
 *
 * Two tiers:
 *   - Simple: template strings (no LLM)
 *   - Complex: LLM paraphrase with structured data injected
 */

import config from '../config/index.js';
import type { ReasoningResult, ComparisonResult, TeamAvgComparisonResult, OverlapResult, MultiPersonOverlapResult, OptimizationResult, SimulationResult, TrendResult } from './reasoning.js';
import type { DataCoverage } from './dataRetrieval.js';
import { formatDateNice } from './workingDays.js';

/* ------------------------------------------------------------------ */
/*  Coverage warnings (Stage 7 — Gap #5)                              */
/* ------------------------------------------------------------------ */

function buildCoverageWarnings(coverages: DataCoverage[]): string {
  const warnings: string[] = [];
  for (const c of coverages) {
    if (c.level === 'none') {
      warnings.push(
        `⚠️ ${c.name} hasn't set their schedule for this period yet.`,
      );
    } else if (c.level === 'low') {
      warnings.push(
        `⚠️ ${c.name}'s schedule is only ${c.coverage}% set (${c.daysWithEntries} of ${c.totalWorkingDays} days). Results may change.`,
      );
    } else if (c.level === 'medium') {
      warnings.push(
        `Note: ${c.name}'s schedule is ${c.coverage}% set (${c.daysWithEntries} of ${c.totalWorkingDays} days). Some data may be incomplete.`,
      );
    }
    // high — no warning
  }
  return warnings.join('\n');
}

/* ------------------------------------------------------------------ */
/*  Template formatters (simple, no LLM)                              */
/* ------------------------------------------------------------------ */

function formatComparison(result: ComparisonResult): string {
  const { userA, userB, diff, whoHasMore, percentageDiff } = result;
  if (whoHasMore === 'tied') {
    return `${userA.name} and ${userB.name} both have ${userA.stats.officeDays} office days (${userA.stats.officePercent}%).`;
  }
  const more = whoHasMore;
  const less = more === userA.name ? userB.name : userA.name;
  const moreStats = more === userA.name ? userA.stats : userB.stats;
  const lessStats = more === userA.name ? userB.stats : userA.stats;
  return `${more} has ${diff} more office day${diff !== 1 ? 's' : ''} than ${less}.\n\n` +
    `• ${more}: ${moreStats.officeDays} office days (${moreStats.officePercent}%)\n` +
    `• ${less}: ${lessStats.officeDays} office days (${lessStats.officePercent}%)\n` +
    `• Difference: ${Math.abs(percentageDiff)} percentage points`;
}

function formatTeamAvgComparison(result: TeamAvgComparisonResult): string {
  const { user, teamAvgOfficePercent, diff, aboveOrBelow } = result;
  if (aboveOrBelow === 'at') {
    return `You are right at the team average for office attendance: ${user.stats.officePercent}%.`;
  }
  return `You are ${aboveOrBelow} the team average by ${diff} percentage points.\n\n` +
    `• Your office attendance: ${user.stats.officePercent}% (${user.stats.officeDays} days)\n` +
    `• Team average: ${teamAvgOfficePercent}%`;
}

function formatOverlap(result: OverlapResult): string {
  const { userA, userB, totalOverlap, fullOverlapDays, partialOverlapDays, workingDaysCount } = result;
  let text = `${userA} and ${userB} have ${totalOverlap} overlapping office day${totalOverlap !== 1 ? 's' : ''} out of ${workingDaysCount} working days.`;

  if (fullOverlapDays.length > 0) {
    const days = fullOverlapDays.map((d) => `• ${formatDateNice(d)}`).join('\n');
    text += `\n\nFull overlap days:\n${days}`;
  }

  if (partialOverlapDays.length > 0) {
    const days = partialOverlapDays.map((d) => `• ${formatDateNice(d)} (partial — half-day)`).join('\n');
    text += `\n\nPartial overlap days:\n${days}`;
  }

  return text;
}

function formatMultiPersonOverlap(result: MultiPersonOverlapResult): string {
  const { people, allInOfficeDays, workingDaysCount } = result;
  const names = people.join(', ');

  if (allInOfficeDays.length === 0) {
    return `There are no days where ${names} are all in the office out of ${workingDaysCount} working days.`;
  }

  const days = allInOfficeDays.map((d) => `• ${formatDateNice(d)}`).join('\n');
  return `Days where ${names} are all in the office (${allInOfficeDays.length} day${allInOfficeDays.length !== 1 ? 's' : ''}):\n${days}`;
}

function formatOptimization(result: OptimizationResult): string {
  const { goal, recommendations, constraints } = result;
  if (recommendations.length === 0) {
    return 'No suitable days found matching your criteria.';
  }

  let header = 'Recommended days';
  if (goal === 'minimize_overlap') header = 'Best days to avoid overlap';
  else if (goal === 'maximize_overlap' || goal === 'meeting_plan') header = 'Best days for maximum overlap';
  else if (goal === 'least_crowded') header = 'Least crowded days';
  else if (goal === 'maximize_team_presence') header = 'Days with highest team presence';

  if (constraints.length > 0) {
    header += ` (constraints: ${constraints.join(', ')})`;
  }

  const lines = recommendations.map((r, i) => {
    const reasonsStr = r.reasons.length > 0 ? `\n  ${r.reasons.map(rr => `• ${rr}`).join('\n  ')}` : '';
    return `${i + 1}. ${formatDateNice(r.date)} (${r.day})${reasonsStr}`;
  });

  return `${header}:\n\n${lines.join('\n\n')}`;
}

function formatSimulation(result: SimulationResult): string {
  const { proposedDays, targetName, overlapDays, overlapCount, totalProposed, overlapPercent } = result;

  let text = `If you go on those ${totalProposed} day${totalProposed !== 1 ? 's' : ''}, you'll overlap with ${targetName} on ${overlapCount} day${overlapCount !== 1 ? 's' : ''} (${overlapPercent}%).`;

  if (overlapDays.length > 0) {
    const days = overlapDays.map((d) => `• ${formatDateNice(d)}`).join('\n');
    text += `\n\nOverlap days:\n${days}`;
  }

  if (overlapCount === 0) {
    text += `\n\n${targetName} is not scheduled to be in the office on any of those days.`;
  }

  return text;
}

function formatTrend(result: TrendResult): string {
  const { userName, current, previous, currentLabel, previousLabel, diff, direction } = result;

  if (direction === 'same') {
    return `${userName}'s office attendance is the same: ${current.officeDays} days in both ${currentLabel} and ${previousLabel}.`;
  }

  return `${userName} is going to the office ${direction} ${currentLabel} compared to ${previousLabel}.\n\n` +
    `• ${currentLabel}: ${current.officeDays} office days (${current.officePercent}%)\n` +
    `• ${previousLabel}: ${previous.officeDays} office days (${previous.officePercent}%)\n` +
    `• Change: ${direction === 'more' ? '+' : '-'}${diff} day${diff !== 1 ? 's' : ''}`;
}

/* ------------------------------------------------------------------ */
/*  LLM Paraphrase (for complex multi-entity responses)               */
/* ------------------------------------------------------------------ */

const LLM_MODELS = [
  'nvidia/nemotron-nano-9b-v2:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemma-3-12b-it:free',
  'deepseek/deepseek-r1-0528:free',
];

const LLM_FETCH_TIMEOUT_MS = 12_000;

/** Sanitize user-controlled text before injecting into LLM messages. */
function sanitizeForPrompt(s: string): string {
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').replace(/`/g, "'").trim();
}

async function llmParaphrase(data: any, originalQuestion: string): Promise<string | null> {
  const apiKey = config.openRouterApiKey;
  if (!apiKey) return null;

  const systemContent = `You are formatting a workplace attendance answer. Convert the structured data below into a natural, concise response. Do NOT add information beyond what's provided. Preserve all numerical values and formatting. Keep the tone professional and helpful.

Computed data:
${JSON.stringify(data, null, 2)}`;

  const userContent = sanitizeForPrompt(originalQuestion);

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
          messages: [
            { role: 'system', content: systemContent },
            { role: 'user', content: userContent },
          ],
          max_tokens: 512,
          temperature: 0.3,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        console.warn(`llmParaphrase: model ${model} returned HTTP ${res.status} ${res.statusText}`);
        continue;
      }

      const resData = (await res.json()) as {
        choices: { message: { content?: string; reasoning_content?: string; reasoning?: string } }[];
      };
      const msg = resData.choices?.[0]?.message;
      const answer = msg?.content?.trim() || msg?.reasoning_content?.trim() || msg?.reasoning?.trim() || '';
      if (answer) return answer;
    } catch (err: any) {
      clearTimeout(timer);
      console.warn(`llmParaphrase: model ${model} threw error:`, err?.message || err, err?.stack);
      continue;
    }
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Main response generator                                           */
/* ------------------------------------------------------------------ */

/**
 * Generate a natural language response from the reasoning result.
 *
 * @param result      The computed result from Stage 4
 * @param coverages   Data coverage info for all involved people
 * @param question    Original user question (for LLM paraphrase fallback)
 * @param useLlm      Whether to attempt LLM paraphrase for complex results
 */
export async function generateResponse(
  result: ReasoningResult,
  coverages: DataCoverage[],
  question: string,
  useLlm: boolean = false,
): Promise<string> {
  let text: string;

  // Try template formatting first
  switch (result.answersIntent) {
    case 'comparison':
      text = formatComparison(result as ComparisonResult);
      break;
    case 'team_avg_comparison':
      text = formatTeamAvgComparison(result as TeamAvgComparisonResult);
      break;
    case 'overlap':
      text = formatOverlap(result as OverlapResult);
      break;
    case 'multi_person_coordination':
      text = formatMultiPersonOverlap(result as MultiPersonOverlapResult);
      break;
    case 'optimize':
    case 'avoid':
    case 'meeting_plan':
      text = formatOptimization(result as OptimizationResult);
      break;
    case 'simulate':
      text = formatSimulation(result as SimulationResult);
      break;
    case 'trend':
      text = formatTrend(result as TrendResult);
      break;
    default:
      text = 'Here are the results based on your query.';
  }

  // Optionally try LLM paraphrase for complex responses
  if (useLlm) {
    try {
      const paraphrased = await llmParaphrase(result, question);
      if (paraphrased) {
        text += '\n\n**Summary:** ' + paraphrased;
      }
    } catch {
      // Use template output if LLM fails
    }
  }

  // Append coverage warnings (Stage 7)
  const warnings = buildCoverageWarnings(coverages);
  if (warnings) {
    text += '\n\n' + warnings;
  }

  return text;
}

/* ------------------------------------------------------------------ */
/*  Capability boundary response (Gap #10)                            */
/* ------------------------------------------------------------------ */

export function buildOutOfScopeResponse(reason?: string): string {
  const base = "I can only analyze recorded and planned attendance data.";
  const capabilities = [
    'attendance comparisons between team members',
    'scheduling suggestions and optimal office days',
    'team presence and overlap analysis',
    'attendance trends over time',
    'simulating hypothetical schedule scenarios',
    'questions about holidays and events',
  ];

  let text = base;
  if (reason) {
    text += ` I can't ${reason}.`;
  }
  text += `\n\nHere's what I can help with:\n${capabilities.map((c) => `• ${c}`).join('\n')}`;
  return text;
}

/**
 * Build a clarification response when the query is ambiguous.
 */
export function buildClarificationResponse(
  ambiguities: Array<{ type: string; question: string; options?: string[] }>,
): string {
  const parts: string[] = [];
  for (const a of ambiguities) {
    let text = a.question;
    if (a.options && a.options.length > 0) {
      text += '\n' + a.options.map((o, i) => `  ${i + 1}. ${o}`).join('\n');
    }
    parts.push(text);
  }
  return parts.join('\n\n');
}
