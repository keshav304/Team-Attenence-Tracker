/**
 * Benchmark script — tests Workbot LLM parsing quality across 10 scheduling queries.
 *
 * Tests whether the LLM correctly produces structured JSON with:
 *   - Correct action type (set/clear)
 *   - Correct status (office/leave)
 *   - Correct date expressions (next month, next week, this month)
 *   - Correct referenceUser / referenceCondition usage
 *   - No false targetUser (which would block the command)
 *   - Valid summary
 *
 * Usage:  node benchmark-workbot.mjs
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

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

const TODAY = '2026-02-25';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TODAY_DAY = DAY_NAMES[new Date(TODAY + 'T00:00:00').getDay()];
const USER_NAME = 'Test User';

/* ------------------------------------------------------------------ */
/*  Load system prompt from workbotController.ts source                */
/* ------------------------------------------------------------------ */

function buildSystemPrompt() {
  // Read the system prompt template from source to stay in sync
  const srcPath = join(__dirname, 'src', 'controllers', 'workbotController.ts');
  const src = readFileSync(srcPath, 'utf-8');

  // Extract the buildParsePrompt function body
  const match = src.match(/function buildParsePrompt\(.*?\).*?\{[\s\S]*?return `([\s\S]*?)`;[\s\n]*\}/);
  if (!match) {
    console.error('Could not extract system prompt from workbotController.ts — using inline fallback');
    return buildFallbackPrompt();
  }

  // Replace template literals with actual values
  let prompt = match[1];
  prompt = prompt.replace(/\$\{todayStr\}/g, TODAY);
  prompt = prompt.replace(/\$\{DAY_NAMES\[new Date\(todayStr \+ 'T00:00:00'\)\.getDay\(\)\]\}/g, TODAY_DAY);
  prompt = prompt.replace(/\$\{userName\}/g, USER_NAME);

  console.log(`System prompt loaded from source: ${prompt.length} chars`);
  return prompt;
}

function buildFallbackPrompt() {
  return `You are a scheduling assistant parser. Today's date is ${TODAY} (${TODAY_DAY}).
The current user's name is "${USER_NAME}".

Parse the user's scheduling command into a structured JSON plan. You must ONLY output valid JSON, no other text.

Rules:
- "office" and "leave" are the only valid statuses
- "clear" means remove any existing entry (revert to WFH default)
- Date expressions should be descriptive strings that can be programmatically resolved
- Use expressions like: "2026-03-02", "next Monday", "every Monday next month", "next week"

Third-party detection rules:
- This tool is ONLY for updating the current user's OWN schedule
- IMPORTANT: Distinguish between MODIFYING someone else's schedule vs REFERENCING someone else's schedule as a filter:
  a) MODIFY another person's schedule → set "targetUser"
  b) REFERENCE another person's schedule as a filter for YOUR days → add "referenceUser" and "referenceCondition" inside the action

Output format (JSON only):
{
  "actions": [
    {
      "type": "set" or "clear",
      "status": "office" or "leave",
      "dateExpressions": ["expression1"],
      "referenceUser": "name (optional)",
      "referenceCondition": "present" or "absent" (optional)"
    }
  ],
  "summary": "Brief summary"
}

Respond ONLY with valid JSON.`;
}

/* ------------------------------------------------------------------ */
/*  Test cases                                                        */
/* ------------------------------------------------------------------ */

const TEST_CASES = [
  {
    id: 1,
    emoji: '🟢',
    category: 'NEXT MONTH',
    title: 'Days Rahul IS Present',
    command: 'Mark every office day next month where Rahul is coming to the office. List all such dates clearly.',
    expected: {
      type: 'set',
      status: 'office',
      dateExpContains: ['next month'],
      referenceUser: 'rahul',
      referenceCondition: 'present',
      noTargetUser: true,
      description: 'Should set office on days Rahul IS present, using referenceUser filter',
    },
  },
  {
    id: 2,
    emoji: '🔵',
    category: 'NEXT MONTH',
    title: 'Days Rahul Is Absent',
    command: 'Mark every office day next month where Rahul is not coming to the office. List all such dates clearly.',
    expected: {
      type: 'set',
      status: 'office',
      dateExpContains: ['next month'],
      referenceUser: 'rahul',
      referenceCondition: 'absent',
      noTargetUser: true,
      description: 'Should set office on days Rahul IS NOT present, using referenceUser filter',
    },
  },
  {
    id: 3,
    emoji: '🟣',
    category: 'NEXT MONTH',
    title: 'Days With Highest Attendance',
    command: 'Mark all office days next month that have the highest attendance.',
    expected: {
      type: 'set',
      status: 'office',
      dateExpContains: ['next month'],
      referenceUser: null,         // No specific person referenced
      referenceCondition: null,
      noTargetUser: true,
      description: 'Should set office for next month — LLM cannot compute attendance, but must parse correctly',
    },
  },
  {
    id: 4,
    emoji: '🟡',
    category: 'NEXT WEEK',
    title: 'Days Rahul Attends Consecutively',
    command: 'Mark all office days next week where Rahul is attending on consecutive days.',
    expected: {
      type: 'set',
      status: 'office',
      dateExpContains: ['next week'],
      referenceUser: 'rahul',
      referenceCondition: 'present',
      noTargetUser: true,
      description: 'Should reference Rahul present, next week — consecutive logic is post-processing',
    },
  },
  {
    id: 5,
    emoji: '🟠',
    category: 'THIS MONTH',
    title: 'Days Above Monthly Average',
    command: 'Mark every office day this month where attendance is above this month\'s daily average.',
    expected: {
      type: 'set',
      status: 'office',
      dateExpContains: ['this month'],
      referenceUser: null,
      referenceCondition: null,
      noTargetUser: true,
      description: 'Should set office for this month — average computation is post-processing',
    },
  },
  {
    id: 6,
    emoji: '🔴',
    category: 'NEXT MONTH',
    title: 'Days With Exactly 3 Employees',
    command: 'Mark every office day next month where exactly 3 employees are attending.',
    expected: {
      type: 'set',
      status: 'office',
      dateExpContains: ['next month'],
      referenceUser: null,
      referenceCondition: null,
      noTargetUser: true,
      description: 'Should set office for next month — count filter is post-processing',
    },
  },
  {
    id: 7,
    emoji: '🟤',
    category: 'NEXT MONTH',
    title: 'Days Rahul Attends After Absence',
    command: 'Mark every office day next month where Rahul attends after being absent the previous working day.',
    expected: {
      type: 'set',
      status: 'office',
      dateExpContains: ['next month'],
      referenceUser: 'rahul',
      referenceCondition: 'present',
      noTargetUser: true,
      description: 'Should reference Rahul present, next month — absent→present pattern is post-processing',
    },
  },
  {
    id: 8,
    emoji: '⚫',
    category: 'NEXT MONTH',
    title: 'Least Attended Days',
    command: 'Mark all office days next month that have the lowest attendance.',
    expected: {
      type: 'set',
      status: 'office',
      dateExpContains: ['next month'],
      referenceUser: null,
      referenceCondition: null,
      noTargetUser: true,
      description: 'Should set office for next month — min attendance is post-processing',
    },
  },
  {
    id: 9,
    emoji: '⚪',
    category: 'NEXT WEEK',
    title: 'Attendance Above 70%',
    command: 'Mark every office day next week where at least 70% of employees are attending.',
    expected: {
      type: 'set',
      status: 'office',
      dateExpContains: ['next week'],
      referenceUser: null,
      referenceCondition: null,
      noTargetUser: true,
      description: 'Should set office for next week — 70% threshold is post-processing',
    },
  },
  {
    id: 10,
    emoji: '🟢',
    category: 'NEXT MONTH',
    title: 'Longest Attendance Streak',
    command: 'Mark all office days next month that are part of the longest consecutive attendance streak for Rahul.',
    expected: {
      type: 'set',
      status: 'office',
      dateExpContains: ['next month'],
      referenceUser: 'rahul',
      referenceCondition: 'present',
      noTargetUser: true,
      description: 'Should reference Rahul present, next month — streak detection is post-processing',
    },
  },
];

/* ------------------------------------------------------------------ */
/*  API callers                                                       */
/* ------------------------------------------------------------------ */

async function callNvidia(systemPrompt, userMessage) {
  const start = Date.now();
  const res = await fetch(NVIDIA_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${NVIDIA_API_KEY}`,
    },
    body: JSON.stringify({
      model: NVIDIA_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 2048,
      temperature: 0.1,
      top_p: 1.0,
    }),
  });

  const ms = Date.now() - start;
  if (!res.ok) {
    const err = await res.text();
    return { error: `HTTP ${res.status}: ${err.substring(0, 200)}`, ms, model: NVIDIA_MODEL };
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content?.trim() || '';
  return { content, ms, model: NVIDIA_MODEL };
}

async function callOpenRouter(systemPrompt, userMessage) {
  const start = Date.now();
  const res = await fetch(OPENROUTER_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': CLIENT_URL,
      'X-Title': 'A-Team-Tracker-Benchmark',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 2048,
      temperature: 0.1,
      top_p: 1.0,
    }),
  });

  const ms = Date.now() - start;
  if (!res.ok) {
    const err = await res.text();
    return { error: `HTTP ${res.status}: ${err.substring(0, 200)}`, ms, model: OPENROUTER_MODEL };
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content?.trim() || '';
  return { content, ms, model: OPENROUTER_MODEL };
}

/* ------------------------------------------------------------------ */
/*  JSON parser                                                       */
/* ------------------------------------------------------------------ */

function extractJSON(raw) {
  if (!raw) return null;

  let str = raw;
  // Strip markdown fences
  const fenceMatch = str.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) str = fenceMatch[1];

  // Find JSON object
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

  const action = parsed.actions[0]; // Primary action
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
      status = status === 'FAIL' ? 'FAIL' : 'PARTIAL';
    }
  }

  // 3. Date expressions contain expected time range
  const dateExps = (action.dateExpressions || []).join(' ').toLowerCase();
  let dateOk = false;
  for (const expected of exp.dateExpContains) {
    if (dateExps.includes(expected)) {
      dateOk = true;
      break;
    }
  }

  // Also check for month/year patterns that represent the same thing
  if (!dateOk) {
    // "next month" could be resolved as "March 2026", "every weekday of March 2026", etc.
    if (exp.dateExpContains.includes('next month')) {
      dateOk = dateExps.includes('march') || dateExps.includes('2026-03');
    }
    if (exp.dateExpContains.includes('next week')) {
      dateOk = dateExps.includes('2026-03-0') || dateExps.includes('march');
    }
    if (exp.dateExpContains.includes('this month')) {
      dateOk = dateExps.includes('february') || dateExps.includes('2026-02');
    }
  }

  if (dateOk) {
    checks.push(`✓ dateExpressions cover "${exp.dateExpContains.join('/')}"`);
  } else {
    checks.push(`✗ dateExpressions="${dateExps}" (expected to contain "${exp.dateExpContains.join('/')}")`);
    failures.push('Wrong time range');
    status = status === 'FAIL' ? 'FAIL' : 'PARTIAL';
  }

  // 4. referenceUser check
  const refUser = (action.referenceUser || '').toLowerCase();
  if (exp.referenceUser) {
    if (refUser.includes(exp.referenceUser)) {
      checks.push(`✓ referenceUser="${action.referenceUser}"`);
    } else {
      checks.push(`✗ referenceUser="${action.referenceUser || '(none)'}" (expected "${exp.referenceUser}")`);
      failures.push('Missing referenceUser');
      status = status === 'FAIL' ? 'FAIL' : 'PARTIAL';
    }
  } else {
    if (refUser) {
      checks.push(`○ referenceUser="${action.referenceUser}" (not required but present)`);
    } else {
      checks.push(`✓ no referenceUser (correct — not needed)`);
    }
  }

  // 5. referenceCondition check
  if (exp.referenceCondition) {
    if (action.referenceCondition === exp.referenceCondition) {
      checks.push(`✓ referenceCondition="${action.referenceCondition}"`);
    } else {
      checks.push(`✗ referenceCondition="${action.referenceCondition || '(none)'}" (expected "${exp.referenceCondition}")`);
      failures.push('Wrong referenceCondition');
      status = status === 'FAIL' ? 'FAIL' : 'PARTIAL';
    }
  }

  // 6. targetUser must NOT be set (critical — triggers block)
  if (exp.noTargetUser) {
    if (parsed.targetUser) {
      checks.push(`✗ targetUser="${parsed.targetUser}" — THIS WILL BLOCK THE COMMAND (403)`);
      failures.push('False targetUser (would cause 403 block)');
      status = 'FAIL';
    } else {
      checks.push(`✓ no targetUser (correct — won't be blocked)`);
    }
  }

  // 7. Summary present
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
  const systemPrompt = buildSystemPrompt();

  console.log(`\nStarting Workbot LLM Benchmark at ${new Date().toISOString()}\n`);
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║       WORKBOT LLM PARSING BENCHMARK — 10 Queries          ║');
  console.log('║    Testing NVIDIA & OpenRouter Structured JSON Output     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const nvidiaResults = [];
  const openRouterResults = [];

  for (const tc of TEST_CASES) {
    console.log('══════════════════════════════════════════════════════════════════════');
    console.log(`Q${tc.id} ${tc.emoji} [${tc.category}]: ${tc.title}`);
    console.log(`Command: "${tc.command}"`);
    console.log(`Expected: type=${tc.expected.type}, status=${tc.expected.status}, time=${tc.expected.dateExpContains.join('/')}`);
    if (tc.expected.referenceUser) {
      console.log(`  referenceUser=${tc.expected.referenceUser}, referenceCondition=${tc.expected.referenceCondition}`);
    }
    console.log('──────────────────────────────────────────────────────────────────────');

    // NVIDIA
    console.log('\n  🟢 NVIDIA:');
    try {
      const nvResult = await callNvidia(systemPrompt, tc.command);
      if (nvResult.error) {
        console.log(`  ERROR: ${nvResult.error} (${nvResult.ms}ms)`);
        nvidiaResults.push({ id: tc.id, status: 'FAIL', failures: ['API error'], ms: nvResult.ms });
      } else {
        const parsed = extractJSON(nvResult.content);
        console.log(`  Model: ${nvResult.model} (${nvResult.ms}ms)`);

        if (parsed) {
          const action = parsed.actions?.[0];
          console.log(`  JSON: type="${action?.type}", status="${action?.status}"`);
          console.log(`  DateExps: ${JSON.stringify(action?.dateExpressions || [])}`);
          if (action?.referenceUser) console.log(`  ReferenceUser: ${action.referenceUser}, Condition: ${action.referenceCondition}`);
          if (parsed.targetUser) console.log(`  ⚠ targetUser: "${parsed.targetUser}" (WILL BLOCK!)`);
          console.log(`  Summary: "${(parsed.summary || '').substring(0, 80)}"`);
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
        openRouterResults.push({ id: tc.id, status: 'FAIL', failures: ['API error'], ms: orResult.ms });
      } else {
        const parsed = extractJSON(orResult.content);
        console.log(`  Model: ${orResult.model} (${orResult.ms}ms)`);

        if (parsed) {
          const action = parsed.actions?.[0];
          console.log(`  JSON: type="${action?.type}", status="${action?.status}"`);
          console.log(`  DateExps: ${JSON.stringify(action?.dateExpressions || [])}`);
          if (action?.referenceUser) console.log(`  ReferenceUser: ${action.referenceUser}, Condition: ${action.referenceCondition}`);
          if (parsed.targetUser) console.log(`  ⚠ targetUser: "${parsed.targetUser}" (WILL BLOCK!)`);
          console.log(`  Summary: "${(parsed.summary || '').substring(0, 80)}"`);
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

    console.log('');
  }

  printSummary(nvidiaResults, openRouterResults);
}

/* ------------------------------------------------------------------ */
/*  Summary                                                           */
/* ------------------------------------------------------------------ */

function printSummary(nvidiaResults, openRouterResults) {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                   FINAL EVALUATION SUMMARY                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  for (const [label, results, model] of [
    ['NVIDIA', nvidiaResults, NVIDIA_MODEL],
    ['OPENROUTER', openRouterResults, OPENROUTER_MODEL],
  ]) {
    const pass = results.filter(r => r.status === 'PASS').length;
    const partial = results.filter(r => r.status === 'PARTIAL').length;
    const fail = results.filter(r => r.status === 'FAIL').length;
    const avgMs = Math.round(results.reduce((s, r) => s + (r.ms || 0), 0) / results.length);

    console.log(`\n────────────────────────────────────────────────────────────`);
    console.log(`  ${label} RESULTS (${model})`);
    console.log(`────────────────────────────────────────────────────────────`);
    console.log(`  Total PASS:    ${pass} / ${results.length}`);
    console.log(`  Total PARTIAL: ${partial} / ${results.length}`);
    console.log(`  Total FAIL:    ${fail} / ${results.length}`);
    console.log(`  Avg Latency:   ${avgMs}ms`);

    // Failure breakdown
    const allFailures = {};
    results.forEach(r => {
      (r.failures || []).forEach(f => {
        allFailures[f] = (allFailures[f] || 0) + 1;
      });
    });
    if (Object.keys(allFailures).length > 0) {
      console.log(`\n  Failure Breakdown:`);
      Object.entries(allFailures).forEach(([f, count]) => {
        console.log(`    • ${f}: ${count} occurrences`);
      });
    }

    console.log(`\n  Per-Question Results:`);
    results.forEach(r => {
      const tc = TEST_CASES.find(t => t.id === r.id);
      const icon = r.status === 'PASS' ? '✅' : r.status === 'PARTIAL' ? '⚠️' : '❌';
      console.log(`    ${icon} Q${r.id} [${tc.category}] ${tc.title} → ${r.status} (${r.ms}ms)`);
      if (r.failures?.length) {
        r.failures.forEach(f => console.log(`       ↳ ${f}`));
      }
    });
  }

  // Head-to-head
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  HEAD-TO-HEAD COMPARISON');
  console.log('════════════════════════════════════════════════════════════');
  console.log('  Q#    NVIDIA       OPENROUTER   Winner');
  console.log('  ─────────────────────────────────────────────');

  let nvWins = 0, orWins = 0, ties = 0;
  const statusRank = { PASS: 3, PARTIAL: 2, FAIL: 1 };

  for (const tc of TEST_CASES) {
    const nv = nvidiaResults.find(r => r.id === tc.id);
    const or = openRouterResults.find(r => r.id === tc.id);
    const nvR = statusRank[nv?.status] || 0;
    const orR = statusRank[or?.status] || 0;

    let winner = 'TIE';
    if (nvR > orR) { winner = 'NVIDIA'; nvWins++; }
    else if (orR > nvR) { winner = 'OPENROUTER'; orWins++; }
    else { ties++; }

    console.log(`  Q${tc.id.toString().padEnd(4)} ${(nv?.status || '?').padEnd(12)} ${(or?.status || '?').padEnd(12)} ${winner}`);
  }

  console.log(`\n  NVIDIA Wins:     ${nvWins}`);
  console.log(`  OpenRouter Wins: ${orWins}`);
  console.log(`  Ties:            ${ties}`);

  // Critical check: targetUser false positives
  const nvTargetFails = nvidiaResults.filter(r => (r.failures || []).includes('False targetUser (would cause 403 block)'));
  const orTargetFails = openRouterResults.filter(r => (r.failures || []).includes('False targetUser (would cause 403 block)'));

  if (nvTargetFails.length || orTargetFails.length) {
    console.log('\n  ⚠ CRITICAL — False targetUser Detections (would cause 403):');
    if (nvTargetFails.length) console.log(`    NVIDIA: Q${nvTargetFails.map(r => r.id).join(', Q')}`);
    if (orTargetFails.length) console.log(`    OpenRouter: Q${orTargetFails.map(r => r.id).join(', Q')}`);
  }

  // Reference-user feature adoption
  const refUserQuestions = TEST_CASES.filter(tc => tc.expected.referenceUser);
  const nvRefOk = refUserQuestions.filter(tc => {
    const r = nvidiaResults.find(rr => rr.id === tc.id);
    return r && !(r.failures || []).includes('Missing referenceUser');
  });
  const orRefOk = refUserQuestions.filter(tc => {
    const r = openRouterResults.find(rr => rr.id === tc.id);
    return r && !(r.failures || []).includes('Missing referenceUser');
  });

  console.log(`\n  Reference-User Feature Adoption (${refUserQuestions.length} questions require it):`);
  console.log(`    NVIDIA:     ${nvRefOk.length}/${refUserQuestions.length} correctly used referenceUser`);
  console.log(`    OpenRouter: ${orRefOk.length}/${refUserQuestions.length} correctly used referenceUser`);

  const nvPass = nvidiaResults.filter(r => r.status === 'PASS').length;
  const orPass = openRouterResults.filter(r => r.status === 'PASS').length;
  console.log(`\n  Overall: NVIDIA ${nvPass}/10 (${nvPass * 10}%) | OpenRouter ${orPass}/10 (${orPass * 10}%)`);
  console.log(`  Winner: ${nvPass > orPass ? 'NVIDIA' : orPass > nvPass ? 'OpenRouter' : 'TIE'}\n`);

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
