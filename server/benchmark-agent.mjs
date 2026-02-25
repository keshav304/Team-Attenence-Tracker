/**
 * Benchmark script — tests Workbot AGENT tool-calling flow across 30 scheduling queries.
 *
 * Tests whether the LLM correctly produces structured JSON with:
 *   - A valid "toolCall" field (tool name + params) instead of legacy "dateExpressions"
 *   - Correct action type (set/clear)
 *   - Correct status (office/leave)
 *   - Correct tool selection from the 13 available date tools
 *   - Correct tool parameters
 *   - Correct referenceUser / referenceCondition usage
 *   - No false targetUser (which would block the command)
 *   - Correct half-day leave fields
 *   - Correct filterByCurrentStatus usage
 *   - Valid summary
 *
 * Covers all 13 date tools + edge cases + combined features.
 *
 * Usage:  node benchmark-agent.mjs
 */

import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Do NOT set process.env.NODE_TLS_REJECT_UNAUTHORIZED globally.
// If you need to trust a corporate/self-signed CA, set the
// NODE_EXTRA_CA_CERTS environment variable when running this script:
//   NODE_EXTRA_CA_CERTS=/path/to/ca-cert.pem node benchmark-agent.mjs

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/* ------------------------------------------------------------------ */
/*  Config                                                            */
/* ------------------------------------------------------------------ */

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

const NVIDIA_BASE = 'https://integrate.api.nvidia.com/v1/chat/completions';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';

const NVIDIA_MODEL = 'meta/llama-3.3-70b-instruct';
const OPENROUTER_MODEL = 'arcee-ai/trinity-large-preview:free';

/** Request timeout in milliseconds */
const TIMEOUT_MS = 60_000;

const TODAY = '2026-02-25';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TODAY_DAY = DAY_NAMES[new Date(TODAY + 'T00:00:00').getDay()];
const USER_NAME = 'Test User';

/* ------------------------------------------------------------------ */
/*  Load system prompt from compiled workbotController                 */
/* ------------------------------------------------------------------ */

async function buildSystemPrompt() {
  // Import the exported prompt builder from the compiled server output.
  // Run `npm run build` first to ensure dist/ is up to date.
  try {
    const { buildParsePrompt } = await import('./dist/controllers/workbotController.js');
    const prompt = buildParsePrompt(TODAY, USER_NAME);
    console.log(`System prompt loaded via exported buildParsePrompt: ${prompt.length} chars\n`);
    return prompt;
  } catch (err) {
    console.error(
      'Could not import buildParsePrompt from dist/controllers/workbotController.js.',
      'Run "npm run build" first to compile the TypeScript source.',
      err.message,
    );
    process.exit(1);
  }
}

/* ------------------------------------------------------------------ */
/*  30 Test Cases                                                     */
/* ------------------------------------------------------------------ */

const TEST_CASES = [
  // ─── Tool 1: resolve_dates (individual dates) ────────────────────
  {
    id: 1,
    category: 'resolve_dates',
    title: 'Single date — tomorrow',
    command: 'Set tomorrow as office',
    expected: {
      type: 'set',
      status: 'office',
      tool: 'resolve_dates',
      paramChecks: (p) => Array.isArray(p.dates) && p.dates.length >= 1,
      noTargetUser: true,
    },
  },
  {
    id: 2,
    category: 'resolve_dates',
    title: 'Multiple named days',
    command: 'Mark next Monday and next Wednesday as leave',
    expected: {
      type: 'set',
      status: 'leave',
      tool: 'resolve_dates',
      paramChecks: (p) => Array.isArray(p.dates) && p.dates.length >= 2,
      noTargetUser: true,
    },
  },

  // ─── Tool 2: expand_month ────────────────────────────────────────
  {
    id: 3,
    category: 'expand_month',
    title: 'All days next month',
    command: 'Mark every day next month as office',
    expected: {
      type: 'set',
      status: 'office',
      tool: 'expand_month',
      paramChecks: (p) => p.period === 'next_month',
      noTargetUser: true,
    },
  },
  {
    id: 4,
    category: 'expand_month',
    title: 'All days this month',
    command: 'Set all days this month as office',
    expected: {
      type: 'set',
      status: 'office',
      tool: 'expand_month',
      paramChecks: (p) => p.period === 'this_month',
      noTargetUser: true,
    },
  },

  // ─── Tool 3: expand_weeks ────────────────────────────────────────
  {
    id: 5,
    category: 'expand_weeks',
    title: 'First 2 weeks of next month',
    command: 'Mark first 2 weeks of next month as office',
    expected: {
      type: 'set',
      status: 'office',
      tool: 'expand_weeks',
      paramChecks: (p) => p.period === 'next_month' && p.count === 2 && p.position === 'first',
      noTargetUser: true,
    },
  },
  {
    id: 6,
    category: 'expand_weeks',
    title: 'Last week of next month',
    command: 'Mark last week of next month as leave',
    expected: {
      type: 'set',
      status: 'leave',
      tool: 'expand_weeks',
      paramChecks: (p) => p.period === 'next_month' && p.count === 1 && p.position === 'last',
      noTargetUser: true,
    },
  },
  {
    id: 7,
    category: 'expand_weeks',
    title: 'Last 3 weeks of this month',
    command: 'Set last 3 weeks of this month as office',
    expected: {
      type: 'set',
      status: 'office',
      tool: 'expand_weeks',
      paramChecks: (p) => p.period === 'this_month' && p.count === 3 && p.position === 'last',
      noTargetUser: true,
    },
  },

  // ─── Tool 4: expand_working_days ─────────────────────────────────
  {
    id: 8,
    category: 'expand_working_days',
    title: 'First 10 working days of next month',
    command: 'Mark first 10 working days of next month as office',
    expected: {
      type: 'set',
      status: 'office',
      tool: 'expand_working_days',
      paramChecks: (p) => p.period === 'next_month' && p.count === 10 && p.position === 'first',
      noTargetUser: true,
    },
  },
  {
    id: 9,
    category: 'expand_working_days',
    title: 'Last 5 business days of this month',
    command: 'Set the last 5 business days of this month as leave',
    expected: {
      type: 'set',
      status: 'leave',
      tool: 'expand_working_days',
      paramChecks: (p) => p.period === 'this_month' && p.count === 5 && p.position === 'last',
      noTargetUser: true,
    },
  },

  // ─── Tool 5: expand_day_of_week ──────────────────────────────────
  {
    id: 10,
    category: 'expand_day_of_week',
    title: 'Every Monday next month',
    command: 'Mark every Monday next month as office',
    expected: {
      type: 'set',
      status: 'office',
      tool: 'expand_day_of_week',
      paramChecks: (p) => p.period === 'next_month' && p.day === 'monday',
      noTargetUser: true,
    },
  },
  {
    id: 11,
    category: 'expand_day_of_week',
    title: 'Every Friday this month',
    command: 'Set every Friday this month as leave',
    expected: {
      type: 'set',
      status: 'leave',
      tool: 'expand_day_of_week',
      paramChecks: (p) => p.period === 'this_month' && p.day === 'friday',
      noTargetUser: true,
    },
  },

  // ─── Tool 6: expand_multiple_days_of_week ────────────────────────
  {
    id: 12,
    category: 'expand_multiple_days_of_week',
    title: 'Mon, Wed, Fri next month',
    command: 'Mark every Monday, Wednesday and Friday next month as office',
    expected: {
      type: 'set',
      status: 'office',
      tool: 'expand_multiple_days_of_week',
      paramChecks: (p) => p.period === 'next_month' && Array.isArray(p.days) && p.days.length === 3,
      noTargetUser: true,
    },
  },

  // ─── Tool 7: expand_range ────────────────────────────────────────
  {
    id: 13,
    category: 'expand_range',
    title: '5th to 20th of next month',
    command: 'Mark days 5th to 20th of next month as office',
    expected: {
      type: 'set',
      status: 'office',
      tool: 'expand_range',
      paramChecks: (p) => p.period === 'next_month' && p.start_day === 5 && p.end_day === 20,
      noTargetUser: true,
    },
  },
  {
    id: 14,
    category: 'expand_range',
    title: '1st to 10th of this month',
    command: 'Set 1st to 10th of this month as leave',
    expected: {
      type: 'set',
      status: 'leave',
      tool: 'expand_range',
      paramChecks: (p) => p.period === 'this_month' && p.start_day === 1 && p.end_day === 10,
      noTargetUser: true,
    },
  },

  // ─── Tool 8: expand_alternate ────────────────────────────────────
  {
    id: 15,
    category: 'expand_alternate',
    title: 'Every alternate day next month',
    command: 'Mark every alternate day next month as office',
    expected: {
      type: 'set',
      status: 'office',
      tool: 'expand_alternate',
      paramChecks: (p) => p.period === 'next_month' && p.type === 'calendar',
      noTargetUser: true,
    },
  },
  {
    id: 16,
    category: 'expand_alternate',
    title: 'Every other working day this month',
    command: 'Mark every other working day this month as office',
    expected: {
      type: 'set',
      status: 'office',
      tool: 'expand_alternate',
      paramChecks: (p) => p.period === 'this_month' && p.type === 'working',
      noTargetUser: true,
    },
  },

  // ─── Tool 9: expand_half_month ───────────────────────────────────
  {
    id: 17,
    category: 'expand_half_month',
    title: 'First half of next month',
    command: 'Mark first half of next month as office',
    expected: {
      type: 'set',
      status: 'office',
      tool: 'expand_half_month',
      paramChecks: (p) => p.period === 'next_month' && p.half === 'first',
      noTargetUser: true,
    },
  },
  {
    id: 18,
    category: 'expand_half_month',
    title: 'Second half of this month',
    command: 'Set second half of this month as leave',
    expected: {
      type: 'set',
      status: 'leave',
      tool: 'expand_half_month',
      paramChecks: (p) => p.period === 'this_month' && p.half === 'second',
      noTargetUser: true,
    },
  },

  // ─── Tool 10: expand_except ──────────────────────────────────────
  {
    id: 19,
    category: 'expand_except',
    title: 'All days except Fridays next month',
    command: 'Mark all days except Fridays next month as office',
    expected: {
      type: 'set',
      status: 'office',
      tool: 'expand_except',
      paramChecks: (p) => p.period === 'next_month' && p.exclude_day === 'friday',
      noTargetUser: true,
    },
  },
  {
    id: 20,
    category: 'expand_except',
    title: 'Every day this month except Mondays',
    command: 'Set every day this month except Mondays as office',
    expected: {
      type: 'set',
      status: 'office',
      tool: 'expand_except',
      paramChecks: (p) => p.period === 'this_month' && p.exclude_day === 'monday',
      noTargetUser: true,
    },
  },

  // ─── Tool 11: expand_first_weekday_per_week ──────────────────────
  {
    id: 21,
    category: 'expand_first_weekday_per_week',
    title: 'First weekday of each week next month',
    command: 'Mark the first weekday of each week next month as office',
    expected: {
      type: 'set',
      status: 'office',
      tool: 'expand_first_weekday_per_week',
      paramChecks: (p) => p.period === 'next_month',
      noTargetUser: true,
    },
  },

  // ─── Tool 12: expand_week_period ─────────────────────────────────
  {
    id: 22,
    category: 'expand_week_period',
    title: 'Entire next week',
    command: 'Mark entire next week as office',
    expected: {
      type: 'set',
      status: 'office',
      tool: 'expand_week_period',
      paramChecks: (p) => p.week === 'next_week',
      noTargetUser: true,
    },
  },
  {
    id: 23,
    category: 'expand_week_period',
    title: 'This week as leave',
    command: 'Set this week as leave',
    expected: {
      type: 'set',
      status: 'leave',
      tool: 'expand_week_period',
      paramChecks: (p) => p.week === 'this_week',
      noTargetUser: true,
    },
  },

  // ─── Tool 13: expand_rest_of_month ───────────────────────────────
  {
    id: 24,
    category: 'expand_rest_of_month',
    title: 'Rest of this month',
    command: 'Mark the rest of this month as office',
    expected: {
      type: 'set',
      status: 'office',
      tool: 'expand_rest_of_month',
      paramChecks: () => true, // no params needed
      noTargetUser: true,
    },
  },

  // ─── Clear action ────────────────────────────────────────────────
  {
    id: 25,
    category: 'clear',
    title: 'Clear next week (WFH revert)',
    command: 'Clear next week',
    expected: {
      type: 'clear',
      status: null,
      tool: 'expand_week_period',
      paramChecks: (p) => p.week === 'next_week',
      noTargetUser: true,
    },
  },

  // ─── Half-day leave ──────────────────────────────────────────────
  {
    id: 26,
    category: 'half-day',
    title: 'Half day leave tomorrow',
    command: 'Take half day leave tomorrow',
    expected: {
      type: 'set',
      status: 'leave',
      tool: 'resolve_dates',
      paramChecks: (p) => Array.isArray(p.dates) && p.dates.length >= 1,
      leaveDuration: 'half',
      noTargetUser: true,
    },
  },

  // ─── filterByCurrentStatus ───────────────────────────────────────
  {
    id: 27,
    category: 'filter-status',
    title: 'Clear all office days next month',
    command: 'Clear every office day next month',
    expected: {
      type: 'clear',
      status: null,
      tool: 'expand_month',
      paramChecks: (p) => p.period === 'next_month',
      filterByCurrentStatus: 'office',
      noTargetUser: true,
    },
  },

  // ─── referenceUser filtering ─────────────────────────────────────
  {
    id: 28,
    category: 'reference-user',
    title: 'Office on days Rahul is present',
    command: 'Mark every day next month as office where Rahul is coming to the office',
    expected: {
      type: 'set',
      status: 'office',
      tool: 'expand_month',
      paramChecks: (p) => p.period === 'next_month',
      referenceUser: 'rahul',
      referenceCondition: 'present',
      noTargetUser: true,
    },
  },
  {
    id: 29,
    category: 'reference-user',
    title: 'Office on days Priya is absent',
    command: 'Set office on days where Priya is not coming next month',
    expected: {
      type: 'set',
      status: 'office',
      tool: 'expand_month',
      paramChecks: (p) => p.period === 'next_month',
      referenceUser: 'priya',
      referenceCondition: 'absent',
      noTargetUser: true,
    },
  },

  // ─── WFH = clear ────────────────────────────────────────────────
  {
    id: 30,
    category: 'wfh-clear',
    title: 'WFH next week (should be clear)',
    command: 'Work from home next week',
    expected: {
      type: 'clear',
      status: null,
      tool: 'expand_week_period',
      paramChecks: (p) => p.week === 'next_week',
      noTargetUser: true,
    },
  },
];

/* ------------------------------------------------------------------ */
/*  API caller (shared)                                               */
/* ------------------------------------------------------------------ */

/**
 * Shared provider caller — removes duplication between NVIDIA / OpenRouter.
 * @param {{ baseUrl: string; model: string; headers: Record<string,string> }} config
 * @param {string} systemPrompt
 * @param {string} userMessage
 */
async function callProvider(config, systemPrompt, userMessage) {
  const start = Date.now();
  const signal = AbortSignal.timeout(TIMEOUT_MS);

  try {
    const res = await fetch(config.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 2048,
        temperature: 0.1,
        top_p: 1.0,
      }),
      signal,
    });

    const ms = Date.now() - start;
    if (!res.ok) {
      const err = await res.text();
      return { error: `HTTP ${res.status}: ${err.substring(0, 200)}`, ms, model: config.model };
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim() || '';
    return { content, ms, model: config.model };
  } catch (err) {
    const ms = Date.now() - start;
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return { error: `Request timed out after ${TIMEOUT_MS}ms`, ms, model: config.model };
    }
    throw err;
  }
}

async function callNvidia(systemPrompt, userMessage) {
  return callProvider(
    {
      baseUrl: NVIDIA_BASE,
      model: NVIDIA_MODEL,
      headers: { Authorization: `Bearer ${NVIDIA_API_KEY}` },
    },
    systemPrompt,
    userMessage,
  );
}

async function callOpenRouter(systemPrompt, userMessage) {
  return callProvider(
    {
      baseUrl: OPENROUTER_BASE,
      model: OPENROUTER_MODEL,
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': CLIENT_URL,
        'X-Title': 'A-Team-Tracker-Benchmark',
      },
    },
    systemPrompt,
    userMessage,
  );
}

/**
 * Race mode — fire NVIDIA + OpenRouter in parallel via Promise.any().
 * Returns whichever responds first with a valid answer.
 * Aborts the slower provider once a winner is found.
 */
async function callRace(systemPrompt, userMessage) {
  const raceStart = Date.now();
  const raceAbort = new AbortController();

  const makeCall = async (label, baseUrl, model, headers) => {
    const signal = AbortSignal.any
      ? AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), raceAbort.signal])
      : raceAbort.signal;
    const start = Date.now();
    try {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          max_tokens: 2048,
          temperature: 0.1,
          top_p: 1.0,
        }),
        signal,
      });
      const ms = Date.now() - start;
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`[${label}] HTTP ${res.status}: ${err.substring(0, 200)}`);
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content?.trim() || '';
      if (!content) throw new Error(`[${label}] Empty response`);
      return { content, ms, model, winner: label };
    } catch (err) {
      const ms = Date.now() - start;
      if (err.name === 'AbortError' && raceAbort.signal.aborted) {
        throw new Error(`[${label}] Lost race (aborted)`);
      }
      throw new Error(`[${label}] ${err.message} (${ms}ms)`);
    }
  };

  try {
    const result = await Promise.any([
      makeCall('NVIDIA', NVIDIA_BASE, NVIDIA_MODEL, {
        Authorization: `Bearer ${NVIDIA_API_KEY}`,
      }),
      makeCall('OPENROUTER', OPENROUTER_BASE, OPENROUTER_MODEL, {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': CLIENT_URL,
        'X-Title': 'A-Team-Tracker-Benchmark',
      }),
    ]);
    raceAbort.abort(); // cancel the loser
    const totalMs = Date.now() - raceStart;
    console.log(`    🏆 Race winner: ${result.winner} (${result.ms}ms, total race: ${totalMs}ms)`);
    return { ...result, ms: totalMs };
  } catch (aggErr) {
    const totalMs = Date.now() - raceStart;
    const errors = aggErr.errors?.map(e => e.message).join(' | ') || aggErr.message;
    return { error: `All providers failed: ${errors}`, ms: totalMs, model: 'race' };
  }
}

/* ------------------------------------------------------------------ */
/*  JSON parser                                                       */
/* ------------------------------------------------------------------ */

function extractJSON(raw) {
  if (!raw) return null;

  let str = raw;
  const fenceMatch = str.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) str = fenceMatch[1];

  const braceStart = str.indexOf('{');
  const braceEnd = str.lastIndexOf('}');
  if (braceStart === -1 || braceEnd === -1) return null;

  try {
    return JSON.parse(str.substring(braceStart, braceEnd + 1));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Evaluator                                                         */
/* ------------------------------------------------------------------ */

function evaluate(testCase, parsed) {
  const checks = [];
  const failures = [];
  let status = 'PASS';

  if (!parsed) {
    return { status: 'FAIL', checks: ['✗ Could not parse JSON'], failures: ['No valid JSON'] };
  }

  if (!parsed.actions || !Array.isArray(parsed.actions) || parsed.actions.length === 0) {
    return { status: 'FAIL', checks: ['✗ No actions array'], failures: ['Missing actions'] };
  }

  const action = parsed.actions[0];
  const exp = testCase.expected;

  // 1. Action type
  if (action.type === exp.type) {
    checks.push(`✓ type="${action.type}"`);
  } else {
    checks.push(`✗ type="${action.type}" (expected "${exp.type}")`);
    failures.push('Wrong action type');
    status = 'FAIL';
  }

  // 2. Status
  if (exp.status) {
    if (action.status === exp.status) {
      checks.push(`✓ status="${action.status}"`);
    } else {
      checks.push(`✗ status="${action.status}" (expected "${exp.status}")`);
      failures.push('Wrong status');
      if (status !== 'FAIL') status = 'PARTIAL';
    }
  }

  // 3. toolCall present?
  if (action.toolCall && typeof action.toolCall === 'object') {
    checks.push(`✓ toolCall present`);
  } else {
    // Check if it fell back to dateExpressions (legacy path)
    if (action.dateExpressions && Array.isArray(action.dateExpressions) && action.dateExpressions.length > 0) {
      checks.push(`○ LEGACY dateExpressions used (toolCall missing)`);
      failures.push('Used legacy dateExpressions instead of toolCall');
      if (status !== 'FAIL') status = 'PARTIAL';
    } else {
      checks.push(`✗ No toolCall and no dateExpressions`);
      failures.push('No date resolution method');
      status = 'FAIL';
    }
    // Can't check tool-specific things, skip remaining tool checks
    return finishEval(testCase, parsed, action, checks, failures, status);
  }

  // 4. Correct tool selected?
  if (action.toolCall.tool === exp.tool) {
    checks.push(`✓ tool="${action.toolCall.tool}"`);
  } else {
    checks.push(`✗ tool="${action.toolCall.tool}" (expected "${exp.tool}")`);
    failures.push(`Wrong tool (got ${action.toolCall.tool}, want ${exp.tool})`);
    if (status !== 'FAIL') status = 'PARTIAL';
  }

  // 5. Tool parameters correct?
  const params = action.toolCall.params || {};
  try {
    if (exp.paramChecks(params)) {
      checks.push(`✓ params valid: ${JSON.stringify(params)}`);
    } else {
      checks.push(`✗ params incorrect: ${JSON.stringify(params)}`);
      failures.push('Wrong tool parameters');
      if (status !== 'FAIL') status = 'PARTIAL';
    }
  } catch (e) {
    checks.push(`✗ param check threw: ${e.message}`);
    failures.push('Param validation error');
    if (status !== 'FAIL') status = 'PARTIAL';
  }

  return finishEval(testCase, parsed, action, checks, failures, status);
}

function finishEval(testCase, parsed, action, checks, failures, status) {
  const exp = testCase.expected;

  // 6. referenceUser
  if (exp.referenceUser) {
    const refUser = (action.referenceUser || '').toLowerCase();
    if (refUser.includes(exp.referenceUser)) {
      checks.push(`✓ referenceUser="${action.referenceUser}"`);
    } else {
      checks.push(`✗ referenceUser="${action.referenceUser || '(none)'}" (expected "${exp.referenceUser}")`);
      failures.push('Missing/wrong referenceUser');
      if (status !== 'FAIL') status = 'PARTIAL';
    }
  }

  // 7. referenceCondition
  if (exp.referenceCondition) {
    if (action.referenceCondition === exp.referenceCondition) {
      checks.push(`✓ referenceCondition="${action.referenceCondition}"`);
    } else {
      checks.push(`✗ referenceCondition="${action.referenceCondition || '(none)'}" (expected "${exp.referenceCondition}")`);
      failures.push('Wrong referenceCondition');
      if (status !== 'FAIL') status = 'PARTIAL';
    }
  }

  // 8. targetUser MUST NOT be set
  if (exp.noTargetUser) {
    if (parsed.targetUser) {
      checks.push(`✗ targetUser="${parsed.targetUser}" — WILL BLOCK (403)`);
      failures.push('False targetUser (403 block)');
      status = 'FAIL';
    } else {
      checks.push(`✓ no targetUser`);
    }
  }

  // 9. leaveDuration (half-day)
  if (exp.leaveDuration) {
    if (action.leaveDuration === exp.leaveDuration) {
      checks.push(`✓ leaveDuration="${action.leaveDuration}"`);
    } else {
      checks.push(`✗ leaveDuration="${action.leaveDuration || '(none)'}" (expected "${exp.leaveDuration}")`);
      failures.push('Wrong leaveDuration');
      if (status !== 'FAIL') status = 'PARTIAL';
    }
  }

  // 10. filterByCurrentStatus
  if (exp.filterByCurrentStatus) {
    if (action.filterByCurrentStatus === exp.filterByCurrentStatus) {
      checks.push(`✓ filterByCurrentStatus="${action.filterByCurrentStatus}"`);
    } else {
      checks.push(`✗ filterByCurrentStatus="${action.filterByCurrentStatus || '(none)'}" (expected "${exp.filterByCurrentStatus}")`);
      failures.push('Wrong filterByCurrentStatus');
      if (status !== 'FAIL') status = 'PARTIAL';
    }
  }

  // 11. Summary
  if (parsed.summary && parsed.summary.length > 5) {
    checks.push(`✓ summary="${parsed.summary.substring(0, 60)}${parsed.summary.length > 60 ? '...' : ''}"`);
  } else {
    checks.push(`○ summary missing or too short`);
  }

  return { status, checks, failures };
}

/* ------------------------------------------------------------------ */
/*  Main runner                                                       */
/* ------------------------------------------------------------------ */

async function runAllTests() {
  const systemPrompt = await buildSystemPrompt();

  console.log(`Starting Agent Tool-Calling Benchmark at ${new Date().toISOString()}\n`);
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  WORKBOT AGENT BENCHMARK — 30 Queries (Tool-Call Flow + Race)   ║');
  console.log('║  Tests all 13 date tools + clear/half-day/filter/referenceUser  ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');

  const nvidiaResults = [];
  const openRouterResults = [];
  const raceResults = [];

  for (const tc of TEST_CASES) {
    console.log('══════════════════════════════════════════════════════════════════════');
    console.log(`Q${String(tc.id).padStart(2, '0')} [${tc.category}]: ${tc.title}`);
    console.log(`Command: "${tc.command}"`);
    console.log(`Expected: type=${tc.expected.type}, status=${tc.expected.status || '(none)'}, tool=${tc.expected.tool}`);
    if (tc.expected.referenceUser) {
      console.log(`  referenceUser=${tc.expected.referenceUser}, referenceCondition=${tc.expected.referenceCondition}`);
    }
    if (tc.expected.filterByCurrentStatus) {
      console.log(`  filterByCurrentStatus=${tc.expected.filterByCurrentStatus}`);
    }
    if (tc.expected.leaveDuration) {
      console.log(`  leaveDuration=${tc.expected.leaveDuration}`);
    }
    console.log('──────────────────────────────────────────────────────────────────────');

    // NVIDIA
    console.log('\n  🟢 NVIDIA:');
    try {
      const nvResult = await callNvidia(systemPrompt, tc.command);
      if (nvResult.error) {
        console.log(`  ERROR: ${nvResult.error} (${nvResult.ms}ms)`);
        nvidiaResults.push({ id: tc.id, status: 'FAIL', failures: ['API error'], ms: nvResult.ms, checks: [] });
      } else {
        const parsed = extractJSON(nvResult.content);
        console.log(`  Model: ${nvResult.model} (${nvResult.ms}ms)`);

        if (parsed) {
          const action = parsed.actions?.[0];
          console.log(`  JSON: type="${action?.type}", status="${action?.status}"`);
          if (action?.toolCall) {
            console.log(`  ToolCall: ${JSON.stringify(action.toolCall)}`);
          } else if (action?.dateExpressions) {
            console.log(`  LEGACY DateExpressions: ${JSON.stringify(action.dateExpressions)}`);
          }
          if (action?.referenceUser) console.log(`  ReferenceUser: ${action.referenceUser}, Condition: ${action.referenceCondition}`);
          if (action?.filterByCurrentStatus) console.log(`  FilterByStatus: ${action.filterByCurrentStatus}`);
          if (action?.leaveDuration) console.log(`  LeaveDuration: ${action.leaveDuration}, Portion: ${action.halfDayPortion}`);
          if (parsed.targetUser) console.log(`  ⚠ targetUser: "${parsed.targetUser}" (WILL BLOCK!)`);
        } else {
          console.log(`  ⚠ Could not parse JSON from: ${nvResult.content.substring(0, 200)}`);
        }

        const evalResult = evaluate(tc, parsed);
        console.log(`  Result: ${evalResult.status}`);
        evalResult.checks.forEach(c => console.log(`    ${c}`));
        nvidiaResults.push({ id: tc.id, ...evalResult, ms: nvResult.ms });
      }
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
      nvidiaResults.push({ id: tc.id, status: 'FAIL', failures: ['Exception'], ms: 0, checks: [] });
    }

    // OpenRouter
    console.log('\n  🔵 OPENROUTER:');
    try {
      const orResult = await callOpenRouter(systemPrompt, tc.command);
      if (orResult.error) {
        console.log(`  ERROR: ${orResult.error} (${orResult.ms}ms)`);
        openRouterResults.push({ id: tc.id, status: 'FAIL', failures: ['API error'], ms: orResult.ms, checks: [] });
      } else {
        const parsed = extractJSON(orResult.content);
        console.log(`  Model: ${orResult.model} (${orResult.ms}ms)`);

        if (parsed) {
          const action = parsed.actions?.[0];
          console.log(`  JSON: type="${action?.type}", status="${action?.status}"`);
          if (action?.toolCall) {
            console.log(`  ToolCall: ${JSON.stringify(action.toolCall)}`);
          } else if (action?.dateExpressions) {
            console.log(`  LEGACY DateExpressions: ${JSON.stringify(action.dateExpressions)}`);
          }
          if (action?.referenceUser) console.log(`  ReferenceUser: ${action.referenceUser}, Condition: ${action.referenceCondition}`);
          if (action?.filterByCurrentStatus) console.log(`  FilterByStatus: ${action.filterByCurrentStatus}`);
          if (action?.leaveDuration) console.log(`  LeaveDuration: ${action.leaveDuration}, Portion: ${action.halfDayPortion}`);
          if (parsed.targetUser) console.log(`  ⚠ targetUser: "${parsed.targetUser}" (WILL BLOCK!)`);
        } else {
          console.log(`  ⚠ Could not parse JSON from: ${orResult.content.substring(0, 200)}`);
        }

        const evalResult = evaluate(tc, parsed);
        console.log(`  Result: ${evalResult.status}`);
        evalResult.checks.forEach(c => console.log(`    ${c}`));
        openRouterResults.push({ id: tc.id, ...evalResult, ms: orResult.ms });
      }
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
      openRouterResults.push({ id: tc.id, status: 'FAIL', failures: ['Exception'], ms: 0, checks: [] });
    }

    // Race (NVIDIA + OpenRouter in parallel)
    console.log('\n  🏁 RACE (NVIDIA vs OpenRouter):');
    try {
      const raceResult = await callRace(systemPrompt, tc.command);
      if (raceResult.error) {
        console.log(`  ERROR: ${raceResult.error} (${raceResult.ms}ms)`);
        raceResults.push({ id: tc.id, status: 'FAIL', failures: ['Race failed'], ms: raceResult.ms, checks: [] });
      } else {
        const parsed = extractJSON(raceResult.content);
        console.log(`  Winner: ${raceResult.winner}, Model: ${raceResult.model} (${raceResult.ms}ms)`);

        if (parsed) {
          const action = parsed.actions?.[0];
          console.log(`  JSON: type="${action?.type}", status="${action?.status}"`);
          if (action?.toolCall) {
            console.log(`  ToolCall: ${JSON.stringify(action.toolCall)}`);
          } else if (action?.dateExpressions) {
            console.log(`  LEGACY DateExpressions: ${JSON.stringify(action.dateExpressions)}`);
          }
          if (action?.referenceUser) console.log(`  ReferenceUser: ${action.referenceUser}, Condition: ${action.referenceCondition}`);
          if (action?.filterByCurrentStatus) console.log(`  FilterByStatus: ${action.filterByCurrentStatus}`);
          if (action?.leaveDuration) console.log(`  LeaveDuration: ${action.leaveDuration}, Portion: ${action.halfDayPortion}`);
          if (parsed.targetUser) console.log(`  ⚠ targetUser: "${parsed.targetUser}" (WILL BLOCK!)`);
        } else {
          console.log(`  ⚠ Could not parse JSON from: ${raceResult.content.substring(0, 200)}`);
        }

        const evalResult = evaluate(tc, parsed);
        console.log(`  Result: ${evalResult.status}`);
        evalResult.checks.forEach(c => console.log(`    ${c}`));
        raceResults.push({ id: tc.id, ...evalResult, ms: raceResult.ms, winner: raceResult.winner });
      }
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
      raceResults.push({ id: tc.id, status: 'FAIL', failures: ['Exception'], ms: 0, checks: [] });
    }

    console.log('');
  }

  printSummary(nvidiaResults, openRouterResults, raceResults);
}

/* ------------------------------------------------------------------ */
/*  Summary                                                           */
/* ------------------------------------------------------------------ */

function printSummary(nvidiaResults, openRouterResults, raceResults) {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                   FINAL EVALUATION SUMMARY                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  for (const [label, results, model] of [
    ['NVIDIA', nvidiaResults, NVIDIA_MODEL],
    ['OPENROUTER', openRouterResults, OPENROUTER_MODEL],
    ['RACE', raceResults, 'fastest-wins'],
  ]) {
    const pass = results.filter(r => r.status === 'PASS').length;
    const partial = results.filter(r => r.status === 'PARTIAL').length;
    const fail = results.filter(r => r.status === 'FAIL').length;
    const avgMs = Math.round(results.reduce((s, r) => s + (r.ms || 0), 0) / results.length);

    console.log(`\n────────────────────────────────────────────────────────────────`);
    console.log(`  ${label} RESULTS (${model})`);
    console.log(`────────────────────────────────────────────────────────────────`);
    console.log(`  Total:   ${results.length}`);
    console.log(`  PASS:    ${pass} (${Math.round(pass / results.length * 100)}%)`);
    console.log(`  PARTIAL: ${partial} (${Math.round(partial / results.length * 100)}%)`);
    console.log(`  FAIL:    ${fail} (${Math.round(fail / results.length * 100)}%)`);
    console.log(`  Avg Latency: ${avgMs}ms`);

    // Tool coverage
    const toolCategories = [...new Set(TEST_CASES.map(tc => tc.expected.tool))];
    console.log(`\n  Tool Coverage:`);
    for (const tool of toolCategories) {
      const relevant = TEST_CASES.filter(tc => tc.expected.tool === tool);
      const passed = relevant.filter(tc => {
        const r = results.find(rr => rr.id === tc.id);
        return r && r.status === 'PASS';
      });
      const icon = passed.length === relevant.length ? '✅' : passed.length > 0 ? '⚠️' : '❌';
      console.log(`    ${icon} ${tool}: ${passed.length}/${relevant.length}`);
    }

    // Failure breakdown
    const allFailures = {};
    results.forEach(r => {
      (r.failures || []).forEach(f => {
        allFailures[f] = (allFailures[f] || 0) + 1;
      });
    });
    if (Object.keys(allFailures).length > 0) {
      console.log(`\n  Failure Breakdown:`);
      Object.entries(allFailures)
        .sort((a, b) => b[1] - a[1])
        .forEach(([f, count]) => {
          console.log(`    • ${f}: ${count}x`);
        });
    }

    // Per-question results
    console.log(`\n  Per-Question Results:`);
    results.forEach(r => {
      const tc = TEST_CASES.find(t => t.id === r.id);
      const icon = r.status === 'PASS' ? '✅' : r.status === 'PARTIAL' ? '⚠️' : '❌';
      console.log(`    ${icon} Q${String(r.id).padStart(2, '0')} [${tc.category}] ${tc.title} → ${r.status} (${r.ms}ms)`);
      if (r.failures?.length) {
        r.failures.forEach(f => console.log(`       ↳ ${f}`));
      }
    });
  }

  // Adoption metrics
  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('  TOOL-CALL ADOPTION METRICS');
  console.log('════════════════════════════════════════════════════════════════');

  for (const [label, results] of [['NVIDIA', nvidiaResults], ['OPENROUTER', openRouterResults], ['RACE', raceResults]]) {
    const usedToolCall = results.filter(r => !(r.failures || []).includes('Used legacy dateExpressions instead of toolCall') && !(r.failures || []).includes('No date resolution method'));
    const usedLegacy = results.filter(r => (r.failures || []).includes('Used legacy dateExpressions instead of toolCall'));
    const noMethod = results.filter(r => (r.failures || []).includes('No date resolution method'));
    console.log(`  ${label}: ${usedToolCall.length}/${results.length} used toolCall, ${usedLegacy.length} used legacy, ${noMethod.length} had no date method`);
  }

  // Race winner distribution
  const raceWinners = raceResults.reduce((acc, r) => {
    if (r.winner) acc[r.winner] = (acc[r.winner] || 0) + 1;
    return acc;
  }, {});
  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('  RACE MODE STATS');
  console.log('════════════════════════════════════════════════════════════════');
  const racePass = raceResults.filter(r => r.status === 'PASS').length;
  const raceAvg = Math.round(raceResults.reduce((s, r) => s + (r.ms || 0), 0) / (raceResults.length || 1));
  console.log(`  Race Results:  ${racePass}/${raceResults.length} PASS (${Math.round(racePass / (raceResults.length || 1) * 100)}%)`);
  console.log(`  Race Avg Latency: ${raceAvg}ms`);
  console.log(`  Race Winners:  ${Object.entries(raceWinners).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'}`);

  // Head-to-head
  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('  HEAD-TO-HEAD COMPARISON (incl. Race)');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('  Q#    NVIDIA       OPENROUTER   RACE         Best');
  console.log('  ─────────────────────────────────────────────────────────');

  let nvWins = 0, orWins = 0, rcWins = 0, ties = 0;
  const statusRank = { PASS: 3, PARTIAL: 2, FAIL: 1 };

  for (const tc of TEST_CASES) {
    const nv = nvidiaResults.find(r => r.id === tc.id);
    const or = openRouterResults.find(r => r.id === tc.id);
    const rc = raceResults.find(r => r.id === tc.id);
    const nvR = statusRank[nv?.status] || 0;
    const orR = statusRank[or?.status] || 0;
    const rcR = statusRank[rc?.status] || 0;

    const maxR = Math.max(nvR, orR, rcR);
    let best = 'TIE';
    if (maxR === nvR && maxR > orR && maxR > rcR) { best = 'NVIDIA'; nvWins++; }
    else if (maxR === orR && maxR > nvR && maxR > rcR) { best = 'OPENROUTER'; orWins++; }
    else if (maxR === rcR && maxR > nvR && maxR > orR) { best = 'RACE'; rcWins++; }
    else { ties++; }

    console.log(`  Q${String(tc.id).padStart(2, '0')}  ${(nv?.status || '?').padEnd(12)} ${(or?.status || '?').padEnd(12)} ${(rc?.status || '?').padEnd(12)} ${best}`);
  }

  console.log(`\n  NVIDIA Wins:     ${nvWins}`);
  console.log(`  OpenRouter Wins: ${orWins}`);
  console.log(`  Race Wins:       ${rcWins}`);
  console.log(`  Ties:            ${ties}`);

  // Critical: targetUser false positives
  const nvTargetFails = nvidiaResults.filter(r => (r.failures || []).includes('False targetUser (403 block)'));
  const orTargetFails = openRouterResults.filter(r => (r.failures || []).includes('False targetUser (403 block)'));

  if (nvTargetFails.length || orTargetFails.length) {
    console.log('\n  ⚠ CRITICAL — False targetUser Detections (would cause 403):');
    if (nvTargetFails.length) console.log(`    NVIDIA: Q${nvTargetFails.map(r => r.id).join(', Q')}`);
    if (orTargetFails.length) console.log(`    OpenRouter: Q${orTargetFails.map(r => r.id).join(', Q')}`);
  }

  // Overall
  const nvPass = nvidiaResults.filter(r => r.status === 'PASS').length;
  const orPass = openRouterResults.filter(r => r.status === 'PASS').length;
  const rcPass = raceResults.filter(r => r.status === 'PASS').length;
  const totalTests = nvidiaResults.length;
  const nvAvg = Math.round(nvidiaResults.reduce((s, r) => s + (r.ms || 0), 0) / (totalTests || 1));
  const orAvg = Math.round(openRouterResults.reduce((s, r) => s + (r.ms || 0), 0) / (totalTests || 1));
  const rcAvg = Math.round(raceResults.reduce((s, r) => s + (r.ms || 0), 0) / (totalTests || 1));
  console.log(`\n  Overall Accuracy:`);
  console.log(`    NVIDIA:     ${nvPass}/${totalTests} (${Math.round(nvPass / totalTests * 100)}%) — avg ${nvAvg}ms`);
  console.log(`    OpenRouter: ${orPass}/${totalTests} (${Math.round(orPass / totalTests * 100)}%) — avg ${orAvg}ms`);
  console.log(`    Race:       ${rcPass}/${totalTests} (${Math.round(rcPass / totalTests * 100)}%) — avg ${rcAvg}ms`);
  const scores = [['NVIDIA', nvPass, nvAvg], ['OpenRouter', orPass, orAvg], ['Race', rcPass, rcAvg]];
  scores.sort((a, b) => b[1] - a[1] || a[2] - b[2]);
  console.log(`  Best: ${scores[0][0]} (${scores[0][1]} PASS, ${scores[0][2]}ms avg)\n`);

  console.log(`Benchmark completed at ${new Date().toISOString()}\n`);
}

/* ------------------------------------------------------------------ */
/*  Entry point                                                       */
/* ------------------------------------------------------------------ */

if (!NVIDIA_API_KEY) console.warn('⚠ NVIDIA_API_KEY not set — NVIDIA tests will fail');
if (!OPENROUTER_API_KEY) console.warn('⚠ OPENROUTER_API_KEY not set — OpenRouter tests will fail');

runAllTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
