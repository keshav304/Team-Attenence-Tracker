/**
 * LLM Extraction Quality Test — 20 Hypothesis Questions
 *
 * Tests whether NVIDIA and OpenRouter models can produce correct
 * structured JSON (intent, people, timeRange, constraints, simulationParams)
 * for complex analytical attendance questions.
 *
 * Usage:
 *   node test-llm-extraction.mjs
 */

import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

// Corporate proxy may use self-signed TLS certificates
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

/* ------------------------------------------------------------------ */
/*  Configuration                                                     */
/* ------------------------------------------------------------------ */

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

const NVIDIA_MODELS = [
  'meta/llama-3.3-70b-instruct',
  'google/gemma-3-27b-it',
  'mistralai/mistral-nemotron',
  'nvidia/llama-3.1-nemotron-ultra-253b-v1',
];

const OPENROUTER_MODELS = [
  'arcee-ai/trinity-large-preview:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'upstage/solar-pro-3:free',
  'nvidia/nemotron-nano-9b-v2:free',
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load system prompt from actual source file to stay in sync
function loadSystemPrompt() {
  const src = readFileSync(join(__dirname, 'src', 'utils', 'llmExtractor.ts'), 'utf8');
  const match = src.match(/const EXTRACTION_SYSTEM_PROMPT = \`([\s\S]*?)\`;/);
  if (match) return match[1];
  throw new Error('Could not extract EXTRACTION_SYSTEM_PROMPT from llmExtractor.ts');
}

const EXTRACTION_SYSTEM_PROMPT = loadSystemPrompt();
console.log(`System prompt loaded: ${EXTRACTION_SYSTEM_PROMPT.length} chars\n`);

/* ------------------------------------------------------------------ */
/*  Test Cases — 20 Questions with Expected JSON                      */
/* ------------------------------------------------------------------ */

const TEST_CASES = [
  // ── NEXT WEEK (1–5) ──
  {
    id: 1,
    category: 'NEXT WEEK',
    question: 'If everyone adds one extra office day next week, which day becomes the most crowded?',
    expected: {
      acceptableIntents: ['simulate', 'team_analytics'],
      timeRange: 'next week',
      requiresPeople: false,
      requiresSimulation: true,
      description: 'Simulate adding extra office day for everyone, find peak day',
      criticalChecks: ['time=next week', 'intent=simulate|team_analytics', 'hypothesis detected'],
    },
  },
  {
    id: 2,
    category: 'NEXT WEEK',
    question: 'If Rahul skips his Monday next week, does the peak attendance day change?',
    expected: {
      acceptableIntents: ['simulate', 'team_analytics'],
      timeRange: 'next week',
      requiresPeople: true,
      expectedPeople: ['Rahul'],
      requiresSimulation: true,
      description: 'Remove Rahul from Monday, check peak change',
      criticalChecks: ['time=next week', 'people includes Rahul', 'intent=simulate|team_analytics', 'monday constraint'],
    },
  },
  {
    id: 3,
    category: 'NEXT WEEK',
    question: 'Which 2 consecutive days next week have the highest combined attendance?',
    expected: {
      acceptableIntents: ['team_analytics', 'optimize'],
      timeRange: 'next week',
      requiresPeople: false,
      requiresSimulation: false,
      description: 'Sliding window calculation for consecutive day pairs',
      criticalChecks: ['time=next week', 'intent=team_analytics|optimize', 'consecutive days noted'],
    },
  },
  {
    id: 4,
    category: 'NEXT WEEK',
    question: 'If we avoid Friday next week, which day becomes the busiest?',
    expected: {
      acceptableIntents: ['simulate', 'team_analytics'],
      timeRange: 'next week',
      requiresPeople: false,
      requiresSimulation: true,
      description: 'Remove Friday, recompute peak',
      criticalChecks: ['time=next week', 'Friday constraint', 'intent=simulate|team_analytics'],
    },
  },
  {
    id: 5,
    category: 'NEXT WEEK',
    question: 'If the highest-attending employee is absent all next week, which day remains peak?',
    expected: {
      acceptableIntents: ['simulate', 'team_analytics'],
      timeRange: 'next week',
      requiresPeople: false,
      requiresSimulation: true,
      description: 'Identify top employee, remove, recompute peak',
      criticalChecks: ['time=next week', 'intent=simulate|team_analytics', 'hypothesis detected'],
    },
  },

  // ── NEXT MONTH (6–10) ──
  {
    id: 6,
    category: 'NEXT MONTH',
    question: 'If Team A shifts all Monday attendance to Thursday next month, which day becomes peak?',
    expected: {
      acceptableIntents: ['simulate', 'team_analytics'],
      timeRange: 'next month',
      requiresPeople: false,
      requiresSimulation: true,
      description: 'Shift Monday→Thursday for Team A, recompute peak',
      criticalChecks: ['time=next month', 'monday+thursday mentioned', 'hypothesis detected'],
    },
  },
  {
    id: 7,
    category: 'NEXT MONTH',
    question: 'If we remove all public holidays next month, what is the new average attendance per day?',
    expected: {
      acceptableIntents: ['simulate', 'team_analytics'],
      timeRange: 'next month',
      requiresPeople: false,
      requiresSimulation: true,
      description: 'Remove holidays, recompute average',
      criticalChecks: ['time=next month', 'holiday reference', 'intent=simulate|team_analytics'],
    },
  },
  {
    id: 8,
    category: 'NEXT MONTH',
    question: "What is the earliest day next month where attendance exceeds this month's peak?",
    expected: {
      acceptableIntents: ['team_analytics', 'trend', 'comparison'],
      timeRange: 'next month',
      requiresPeople: false,
      requiresSimulation: false,
      description: 'Cross-period threshold: this month peak vs next month',
      criticalChecks: ['time includes next month', 'this month reference for baseline', 'intent=team_analytics|trend'],
    },
  },
  {
    id: 9,
    category: 'NEXT MONTH',
    question: 'If we cancel the lowest-attendance day each week next month, what is the new weekly average?',
    expected: {
      acceptableIntents: ['simulate', 'team_analytics'],
      timeRange: 'next month',
      requiresPeople: false,
      requiresSimulation: true,
      description: 'Remove min day per week, recompute averages',
      criticalChecks: ['time=next month', 'hypothesis detected', 'weekly grouping'],
    },
  },
  {
    id: 10,
    category: 'NEXT MONTH',
    question: 'If we require at least 70% team presence next month, how many days qualify?',
    expected: {
      acceptableIntents: ['team_analytics', 'simulate'],
      timeRange: 'next month',
      requiresPeople: false,
      requiresSimulation: false,
      description: 'Threshold filtering at 70%',
      criticalChecks: ['time=next month', '70% threshold captured', 'intent=team_analytics'],
    },
  },

  // ── THIS MONTH (11–14) ──
  {
    id: 11,
    category: 'THIS MONTH',
    question: 'If everyone who attended fewer than 5 days adds one more day this month, which day benefits most?',
    expected: {
      acceptableIntents: ['simulate', 'team_analytics'],
      timeRange: 'this month',
      requiresPeople: false,
      requiresSimulation: true,
      description: 'Filter low-attendance employees, simulate addition, find max-gain day',
      criticalChecks: ['time=this month', 'hypothesis detected', '<5 days threshold'],
    },
  },
  {
    id: 12,
    category: 'THIS MONTH',
    question: 'If we redistribute attendance evenly across weekdays this month, what would the per-day average be?',
    expected: {
      acceptableIntents: ['simulate', 'team_analytics'],
      timeRange: 'this month',
      requiresPeople: false,
      requiresSimulation: true,
      description: 'Even redistribution, compute average',
      criticalChecks: ['time=this month', 'intent=simulate|team_analytics', 'redistribution noted'],
    },
  },
  {
    id: 13,
    category: 'THIS MONTH',
    question: 'If next week mirrors the busiest week of this month, which days would be peak?',
    expected: {
      acceptableIntents: ['simulate', 'team_analytics', 'trend'],
      timeRange: 'this month|next week',
      requiresPeople: false,
      requiresSimulation: true,
      description: 'Find busiest week this month, project to next week',
      criticalChecks: ['time includes this month or next week', 'hypothesis detected', 'busiest week reference'],
    },
  },
  {
    id: 14,
    category: 'THIS MONTH',
    question: 'Which weekday has the highest average attendance this month?',
    expected: {
      acceptableIntents: ['team_analytics'],
      timeRange: 'this month',
      requiresPeople: false,
      requiresSimulation: false,
      description: 'Average by weekday, find max',
      criticalChecks: ['time=this month', 'intent=team_analytics', 'weekday aggregation'],
    },
  },

  // ── HARD MULTI-STEP (15–20) ──
  {
    id: 15,
    category: 'HARD MULTI-STEP',
    question: 'Which 3-day combination next month maximizes overlap among employees who attended at least 8 days this month?',
    expected: {
      acceptableIntents: ['optimize', 'multi_person_coordination', 'team_analytics', 'simulate'],
      timeRange: 'next month',
      requiresPeople: false,
      requiresSimulation: false,
      optimizationGoal: 'maximize_overlap',
      description: 'Filter by attendance threshold, optimize 3-day combo',
      criticalChecks: ['time=next month', 'this month reference for filter', '8-day threshold', 'maximize_overlap goal'],
    },
  },
  {
    id: 16,
    category: 'HARD MULTI-STEP',
    question: 'If we shift all Tuesday attendance to Wednesday next month, what is the percentage increase in Wednesday attendance?',
    expected: {
      acceptableIntents: ['simulate', 'team_analytics'],
      timeRange: 'next month',
      requiresPeople: false,
      requiresSimulation: true,
      description: 'Shift Tuesday→Wednesday, compute % increase',
      criticalChecks: ['time=next month', 'tuesday+wednesday shift', 'hypothesis detected'],
    },
  },
  {
    id: 17,
    category: 'HARD MULTI-STEP',
    question: 'If we remove the top 10% most frequent attendees next month, does the busiest day change?',
    expected: {
      acceptableIntents: ['simulate', 'team_analytics'],
      timeRange: 'next month',
      requiresPeople: false,
      requiresSimulation: true,
      description: 'Remove top 10%, recompute peak, compare',
      criticalChecks: ['time=next month', 'top 10% threshold', 'hypothesis detected'],
    },
  },
  {
    id: 18,
    category: 'HARD MULTI-STEP',
    question: "Which week next month is most sensitive to a single employee's absence?",
    expected: {
      acceptableIntents: ['team_analytics', 'simulate'],
      timeRange: 'next month',
      requiresPeople: false,
      requiresSimulation: false,
      description: 'Sensitivity analysis: max variance per employee removal',
      criticalChecks: ['time=next month', 'intent=team_analytics|simulate', 'sensitivity/variance concept'],
    },
  },
  {
    id: 19,
    category: 'HARD MULTI-STEP',
    question: 'What is the smallest change needed next month to make Wednesday the peak day?',
    expected: {
      acceptableIntents: ['simulate', 'optimize', 'team_analytics'],
      timeRange: 'next month',
      requiresPeople: false,
      requiresSimulation: true,
      description: 'Find minimum shifts to make Wednesday peak',
      criticalChecks: ['time=next month', 'wednesday target', 'optimization/minimal change'],
    },
  },
  {
    id: 20,
    category: 'HARD MULTI-STEP',
    question: 'If employees who overlap with Rahul more than 3 times shift one of their days to Friday next month, what becomes the new peak day?',
    expected: {
      acceptableIntents: ['simulate', 'team_analytics', 'overlap'],
      timeRange: 'next month',
      requiresPeople: true,
      expectedPeople: ['Rahul'],
      requiresSimulation: true,
      description: 'Filter by Rahul overlap count, simulate shift to Friday, recompute peak',
      criticalChecks: ['time=next month', 'people includes Rahul', 'friday shift', 'hypothesis detected', '3-overlap threshold'],
    },
  },
];

/* ------------------------------------------------------------------ */
/*  LLM Call Functions                                                */
/* ------------------------------------------------------------------ */

async function callNvidia(model, question) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30000);

  try {
    const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${NVIDIA_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
          { role: 'user', content: question },
        ],
        max_tokens: 1024,
        temperature: 0.1,
        top_p: 1.0,
      }),
      signal: ac.signal,
    });
    clearTimeout(timer);

    if (res.status === 429) {
      await res.text();
      return { error: 'rate_limited', model };
    }
    if (!res.ok) {
      const errText = await res.text();
      return { error: `HTTP ${res.status}: ${errText.substring(0, 200)}`, model };
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim() || '';
    return { content, model, latencyMs: 0 };
  } catch (err) {
    clearTimeout(timer);
    return { error: err.message, model };
  }
}

async function callOpenRouter(model, question) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30000);

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': CLIENT_URL,
        'X-Title': 'A-Team-Tracker-Test',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
          { role: 'user', content: question },
        ],
        max_tokens: 1024,
        temperature: 0.1,
        top_p: 1.0,
        response_format: { type: 'json_object' },
      }),
      signal: ac.signal,
    });
    clearTimeout(timer);

    if (res.status === 429) {
      await res.text();
      return { error: 'rate_limited', model };
    }
    if (!res.ok) {
      const errText = await res.text();
      return { error: `HTTP ${res.status}: ${errText.substring(0, 200)}`, model };
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim() || '';
    return { content, model, latencyMs: 0 };
  } catch (err) {
    clearTimeout(timer);
    return { error: err.message, model };
  }
}

/**
 * Try models in fallback order until one succeeds.
 */
async function callWithFallback(provider, models, question) {
  const callFn = provider === 'nvidia' ? callNvidia : callOpenRouter;

  for (const model of models) {
    const start = Date.now();
    const result = await callFn(model, question);
    const latency = Date.now() - start;

    if (result.error) {
      console.log(`  ⚠ [${provider}] ${model} → ${result.error} (${latency}ms)`);
      continue;
    }
    if (!result.content) {
      console.log(`  ⚠ [${provider}] ${model} → empty response (${latency}ms)`);
      continue;
    }

    return { ...result, latencyMs: latency };
  }

  return { error: 'All models failed', model: 'none', content: '' };
}

/* ------------------------------------------------------------------ */
/*  Evaluation Logic                                                  */
/* ------------------------------------------------------------------ */

function parseJSON(raw) {
  try {
    let jsonStr = raw;
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();
    // Also handle case where there's extra text around JSON
    const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (braceMatch) jsonStr = braceMatch[0];
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

function evaluate(testCase, parsed) {
  const checks = [];
  let status = 'PASS';

  if (!parsed) {
    return { status: 'FAIL', checks: ['JSON parse failed'], failures: ['JSON parse failed'] };
  }

  const failures = [];

  // 1. Intent check
  const intent = (parsed.intent || '').toLowerCase();
  const intentOk = testCase.expected.acceptableIntents.some(
    (i) => i.toLowerCase() === intent
  );
  if (intentOk) {
    checks.push(`✓ intent="${intent}" (acceptable)`);
  } else {
    checks.push(`✗ intent="${intent}" (expected: ${testCase.expected.acceptableIntents.join('|')})`);
    failures.push('Wrong intent');
    status = 'FAIL';
  }

  // 2. Time range check
  const timeRange = (parsed.timeRange || '').toLowerCase();
  const expectedTime = testCase.expected.timeRange.toLowerCase();
  const timeOk = timeRange.includes(expectedTime) || expectedTime.includes(timeRange);
  if (timeOk) {
    checks.push(`✓ timeRange="${parsed.timeRange}"`);
  } else {
    checks.push(`✗ timeRange="${parsed.timeRange}" (expected: contains "${testCase.expected.timeRange}")`);
    failures.push('Time misinterpretation');
    status = status === 'FAIL' ? 'FAIL' : 'PARTIAL';
  }

  // 3. People check
  if (testCase.expected.requiresPeople && testCase.expected.expectedPeople) {
    const people = (parsed.people || []).map((p) => p.toLowerCase());
    const missing = testCase.expected.expectedPeople.filter(
      (ep) => !people.some((p) => p.includes(ep.toLowerCase()))
    );
    if (missing.length === 0) {
      checks.push(`✓ people=[${parsed.people.join(', ')}]`);
    } else {
      checks.push(`✗ people=[${(parsed.people || []).join(', ')}] (missing: ${missing.join(', ')})`);
      failures.push('Missing people');
      status = status === 'FAIL' ? 'FAIL' : 'PARTIAL';
    }
  } else {
    checks.push(`○ people=[${(parsed.people || []).join(', ')}] (not strictly required)`);
  }

  // 4. Simulation detection check
  if (testCase.expected.requiresSimulation) {
    const hasHypothesis =
      intent === 'simulate' ||
      (parsed.simulationParams &&
        ((parsed.simulationParams.proposedDays?.length > 0) ||
         (parsed.simulationParams.proposedDayOfWeek?.length > 0))) ||
      (parsed.constraints && parsed.constraints.length > 0);
    if (hasHypothesis) {
      checks.push('✓ hypothesis/simulation detected');
    } else {
      checks.push('✗ hypothesis NOT detected (question has "if" / simulation)');
      failures.push('Hypothesis not applied');
      status = status === 'FAIL' ? 'FAIL' : 'PARTIAL';
    }
  }

  // 5. Optimization goal check
  if (testCase.expected.optimizationGoal) {
    const goal = (parsed.optimizationGoal || '').toLowerCase();
    if (goal === testCase.expected.optimizationGoal.toLowerCase()) {
      checks.push(`✓ optimizationGoal="${goal}"`);
    } else {
      checks.push(`✗ optimizationGoal="${goal}" (expected: "${testCase.expected.optimizationGoal}")`);
      failures.push('Wrong optimization goal');
      status = status === 'FAIL' ? 'FAIL' : 'PARTIAL';
    }
  }

  // 6. Not out_of_scope (critical — these are all in-scope questions)
  if (intent === 'out_of_scope') {
    checks.push('✗ CRITICAL: classified as out_of_scope (should be in-scope)');
    failures.push('Wrongly marked out_of_scope');
    status = 'FAIL';
  }

  // 7. Not needsClarification for well-formed questions
  if (parsed.needsClarification && intent !== 'clarify_needed') {
    checks.push('⚠ needsClarification=true (question is well-formed)');
  }

  // 8. Constraints captured (for questions with day-specific constraints)
  const q = testCase.question.toLowerCase();
  if ((q.includes('friday') || q.includes('monday') || q.includes('tuesday') || q.includes('wednesday') || q.includes('thursday')) &&
      testCase.expected.requiresSimulation) {
    const constraints = parsed.constraints || [];
    const simParams = parsed.simulationParams || {};
    const dayWords = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
    const mentionedDays = dayWords.filter((d) => q.includes(d));
    const captured = mentionedDays.some(
      (d) =>
        constraints.some((c) => c.toLowerCase().includes(d)) ||
        (simParams.proposedDayOfWeek || []).some((pd) => pd.toLowerCase().includes(d)) ||
        (simParams.proposedDays || []).some((pd) => pd.toLowerCase().includes(d))
    );
    if (captured) {
      checks.push(`✓ day constraint captured: ${mentionedDays.join(', ')}`);
    } else {
      checks.push(`⚠ day constraint may be missing: ${mentionedDays.join(', ')} (constraints=${JSON.stringify(constraints)})`);
    }
  }

  return { status, checks, failures };
}

/* ------------------------------------------------------------------ */
/*  Main Runner                                                       */
/* ------------------------------------------------------------------ */

async function runAllTests() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   LLM EXTRACTION QUALITY TEST — 20 Hypothesis Questions    ║');
  console.log('║   Testing NVIDIA & OpenRouter Model Structured JSON Output ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const results = { nvidia: [], openrouter: [] };

  for (const tc of TEST_CASES) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`Q${tc.id} [${tc.category}]: ${tc.question}`);
    console.log(`Expected: intent=${tc.expected.acceptableIntents.join('|')}, time=${tc.expected.timeRange}`);
    console.log(`${'─'.repeat(70)}`);

    // ── NVIDIA ──
    console.log('\n  🟢 NVIDIA:');
    const nvidiaStart = Date.now();
    const nvidiaResult = await callWithFallback('nvidia', NVIDIA_MODELS, tc.question);
    const nvidiaLatency = Date.now() - nvidiaStart;

    if (nvidiaResult.error && !nvidiaResult.content) {
      console.log(`  ✗ All NVIDIA models failed: ${nvidiaResult.error}`);
      results.nvidia.push({
        id: tc.id,
        status: 'FAIL',
        failures: ['All models failed'],
        model: 'none',
        latency: nvidiaLatency,
        raw: '',
        parsed: null,
      });
    } else {
      const parsed = parseJSON(nvidiaResult.content);
      console.log(`  Model: ${nvidiaResult.model} (${nvidiaResult.latencyMs}ms)`);
      if (parsed) {
        console.log(`  JSON: intent="${parsed.intent}", people=[${(parsed.people || []).join(', ')}], time="${parsed.timeRange}"`);
        if (parsed.constraints?.length) console.log(`  Constraints: ${JSON.stringify(parsed.constraints)}`);
        if (parsed.simulationParams) console.log(`  SimParams: ${JSON.stringify(parsed.simulationParams)}`);
        if (parsed.optimizationGoal) console.log(`  Goal: ${parsed.optimizationGoal}`);
      } else {
        console.log(`  ✗ Failed to parse JSON from: ${nvidiaResult.content.substring(0, 200)}`);
      }

      const evalResult = evaluate(tc, parsed);
      console.log(`  Result: ${evalResult.status}`);
      for (const c of evalResult.checks) console.log(`    ${c}`);

      results.nvidia.push({
        id: tc.id,
        status: evalResult.status,
        failures: evalResult.failures,
        model: nvidiaResult.model,
        latency: nvidiaResult.latencyMs,
        raw: nvidiaResult.content,
        parsed,
      });
    }

    // ── OPENROUTER — small delay to avoid rate limits ──
    await new Promise((r) => setTimeout(r, 1500));

    console.log('\n  🔵 OPENROUTER:');
    const orStart = Date.now();
    const orResult = await callWithFallback('openrouter', OPENROUTER_MODELS, tc.question);
    const orLatency = Date.now() - orStart;

    if (orResult.error && !orResult.content) {
      console.log(`  ✗ All OpenRouter models failed: ${orResult.error}`);
      results.openrouter.push({
        id: tc.id,
        status: 'FAIL',
        failures: ['All models failed'],
        model: 'none',
        latency: orLatency,
        raw: '',
        parsed: null,
      });
    } else {
      const parsed = parseJSON(orResult.content);
      console.log(`  Model: ${orResult.model} (${orResult.latencyMs}ms)`);
      if (parsed) {
        console.log(`  JSON: intent="${parsed.intent}", people=[${(parsed.people || []).join(', ')}], time="${parsed.timeRange}"`);
        if (parsed.constraints?.length) console.log(`  Constraints: ${JSON.stringify(parsed.constraints)}`);
        if (parsed.simulationParams) console.log(`  SimParams: ${JSON.stringify(parsed.simulationParams)}`);
        if (parsed.optimizationGoal) console.log(`  Goal: ${parsed.optimizationGoal}`);
      } else {
        console.log(`  ✗ Failed to parse JSON from: ${orResult.content.substring(0, 200)}`);
      }

      const evalResult = evaluate(tc, parsed);
      console.log(`  Result: ${evalResult.status}`);
      for (const c of evalResult.checks) console.log(`    ${c}`);

      results.openrouter.push({
        id: tc.id,
        status: evalResult.status,
        failures: evalResult.failures,
        model: orResult.model,
        latency: orResult.latencyMs,
        raw: orResult.content,
        parsed,
      });
    }

    // Delay between questions to avoid rate limiting
    await new Promise((r) => setTimeout(r, 2000));
  }

  // ── FINAL SUMMARY ──
  printSummary(results);
}

function printSummary(results) {
  console.log('\n\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    FINAL EVALUATION SUMMARY                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  for (const provider of ['nvidia', 'openrouter']) {
    const data = results[provider];
    const pass = data.filter((d) => d.status === 'PASS').length;
    const partial = data.filter((d) => d.status === 'PARTIAL').length;
    const fail = data.filter((d) => d.status === 'FAIL').length;

    const allFailures = data.flatMap((d) => d.failures || []);
    const failureCounts = {};
    for (const f of allFailures) {
      failureCounts[f] = (failureCounts[f] || 0) + 1;
    }
    const sortedFailures = Object.entries(failureCounts).sort((a, b) => b[1] - a[1]);

    const avgLatency = data.filter((d) => d.latency > 0).reduce((sum, d) => sum + d.latency, 0) / Math.max(1, data.filter((d) => d.latency > 0).length);
    const modelsUsed = [...new Set(data.map((d) => d.model).filter((m) => m !== 'none'))];

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`  ${provider.toUpperCase()} RESULTS`);
    console.log(`${'─'.repeat(60)}`);
    console.log(`  Total PASS:    ${pass} / ${data.length}`);
    console.log(`  Total PARTIAL: ${partial} / ${data.length}`);
    console.log(`  Total FAIL:    ${fail} / ${data.length}`);
    console.log(`  Avg Latency:   ${Math.round(avgLatency)}ms`);
    console.log(`  Models Used:   ${modelsUsed.join(', ') || 'none'}`);

    if (sortedFailures.length > 0) {
      console.log(`\n  Failure Breakdown:`);
      for (const [type, count] of sortedFailures) {
        console.log(`    • ${type}: ${count} occurrences`);
      }
    }

    // Per-question breakdown
    console.log(`\n  Per-Question Results:`);
    for (const d of data) {
      const tc = TEST_CASES.find((t) => t.id === d.id);
      const emoji = d.status === 'PASS' ? '✅' : d.status === 'PARTIAL' ? '⚠️' : '❌';
      const intent = d.parsed?.intent || 'N/A';
      console.log(`    ${emoji} Q${d.id} [${tc.category}] → ${d.status} (intent=${intent}, ${d.latency}ms)`);
      if (d.failures?.length) {
        console.log(`       Failures: ${d.failures.join(', ')}`);
      }
    }
  }

  // ── COMPARISON ──
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  HEAD-TO-HEAD COMPARISON');
  console.log(`${'═'.repeat(60)}`);
  console.log(`  ${'Q#'.padEnd(5)} ${'NVIDIA'.padEnd(12)} ${'OPENROUTER'.padEnd(12)} ${'Winner'.padEnd(12)}`);
  console.log(`  ${'─'.repeat(45)}`);

  let nvidiaWins = 0;
  let orWins = 0;
  let ties = 0;

  for (const tc of TEST_CASES) {
    const nv = results.nvidia.find((d) => d.id === tc.id);
    const or = results.openrouter.find((d) => d.id === tc.id);

    const nvScore = nv.status === 'PASS' ? 3 : nv.status === 'PARTIAL' ? 1 : 0;
    const orScore = or.status === 'PASS' ? 3 : or.status === 'PARTIAL' ? 1 : 0;

    let winner = 'TIE';
    if (nvScore > orScore) { winner = 'NVIDIA'; nvidiaWins++; }
    else if (orScore > nvScore) { winner = 'OPENROUTER'; orWins++; }
    else { ties++; }

    console.log(`  Q${String(tc.id).padEnd(4)} ${nv.status.padEnd(12)} ${or.status.padEnd(12)} ${winner}`);
  }

  console.log(`\n  NVIDIA Wins:     ${nvidiaWins}`);
  console.log(`  OpenRouter Wins: ${orWins}`);
  console.log(`  Ties:            ${ties}`);

  // ── DIAGNOSTIC SUMMARY ──
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  DIAGNOSTIC SUMMARY');
  console.log(`${'═'.repeat(60)}`);

  const allNvFailures = results.nvidia.flatMap((d) => d.failures || []);
  const allOrFailures = results.openrouter.flatMap((d) => d.failures || []);
  const allFailTypes = new Set([...allNvFailures, ...allOrFailures]);

  const failureCategoryMap = {
    'Time misinterpretation': 'Time misinterpretation',
    'Wrong intent': 'Intent classification error',
    'Hypothesis not applied': 'Hypothesis not applied',
    'Missing people': 'Entity extraction failure',
    'Wrong optimization goal': 'Goal extraction failure',
    'Wrongly marked out_of_scope': 'False out_of_scope rejection',
    'All models failed': 'Infrastructure/rate limit failure',
    'JSON parse failed': 'JSON formatting failure',
  };

  console.log('\n  Common Failure Categories:');
  for (const [raw, label] of Object.entries(failureCategoryMap)) {
    const nvCount = allNvFailures.filter((f) => f === raw).length;
    const orCount = allOrFailures.filter((f) => f === raw).length;
    if (nvCount + orCount > 0) {
      console.log(`    • ${label}: NVIDIA=${nvCount}, OpenRouter=${orCount}`);
    }
  }

  const nvPass = results.nvidia.filter((d) => d.status === 'PASS').length;
  const orPass = results.openrouter.filter((d) => d.status === 'PASS').length;

  console.log(`\n  Key Reasoning Weaknesses:`);
  
  // Check for specific weakness patterns
  const nvSimFails = results.nvidia.filter((d) => {
    const tc = TEST_CASES.find((t) => t.id === d.id);
    return tc.expected.requiresSimulation && d.parsed?.intent !== 'simulate';
  }).length;
  const orSimFails = results.openrouter.filter((d) => {
    const tc = TEST_CASES.find((t) => t.id === d.id);
    return tc.expected.requiresSimulation && d.parsed?.intent !== 'simulate';
  }).length;

  if (nvSimFails > 3 || orSimFails > 3) {
    console.log('    ⚡ Models struggle to classify "if...then" hypothetical questions as simulate intent');
    console.log(`       (NVIDIA: ${nvSimFails}/14 simulation Qs not classified as simulate, OpenRouter: ${orSimFails}/14)`);
  }

  const nvTimeFails = allNvFailures.filter((f) => f === 'Time misinterpretation').length;
  const orTimeFails = allOrFailures.filter((f) => f === 'Time misinterpretation').length;
  if (nvTimeFails + orTimeFails > 2) {
    console.log(`    ⚡ Time range extraction inconsistency (NVIDIA: ${nvTimeFails}, OpenRouter: ${orTimeFails})`);
  }

  const nvOosFails = allNvFailures.filter((f) => f === 'Wrongly marked out_of_scope').length;
  const orOosFails = allOrFailures.filter((f) => f === 'Wrongly marked out_of_scope').length;
  if (nvOosFails + orOosFails > 0) {
    console.log(`    ⚡ Some in-scope questions wrongly rejected as out_of_scope (NVIDIA: ${nvOosFails}, OpenRouter: ${orOosFails})`);
  }

  // Multi-step questions (15-20) performance
  const nvHardPass = results.nvidia.filter((d) => d.id >= 15 && d.status === 'PASS').length;
  const orHardPass = results.openrouter.filter((d) => d.id >= 15 && d.status === 'PASS').length;
  console.log(`\n    Hard Multi-Step (Q15-Q20) Pass Rate: NVIDIA=${nvHardPass}/6, OpenRouter=${orHardPass}/6`);

  console.log(`\n  Overall Assessment:`);
  console.log(`    NVIDIA:     ${nvPass}/20 PASS (${Math.round(nvPass/20*100)}%)`);
  console.log(`    OpenRouter: ${orPass}/20 PASS (${Math.round(orPass/20*100)}%)`);
  console.log(`    Winner: ${nvPass > orPass ? 'NVIDIA' : orPass > nvPass ? 'OpenRouter' : 'TIE'}`);
}

/* ------------------------------------------------------------------ */
/*  Entry Point                                                       */
/* ------------------------------------------------------------------ */

console.log(`Starting test at ${new Date().toISOString()}\n`);

runAllTests()
  .then(() => {
    console.log(`\nTest completed at ${new Date().toISOString()}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
