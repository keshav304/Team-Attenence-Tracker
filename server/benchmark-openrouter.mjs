/**
 * Benchmark script — tests each OpenRouter free model with real questions.
 * Usage: NODE_TLS_REJECT_UNAUTHORIZED=0 node benchmark-openrouter.mjs
 */

import 'dotenv/config';

const API_KEY = process.env.OPENROUTER_API_KEY;
const BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

const MODELS = [
  'openai/gpt-oss-120b:free',
  'arcee-ai/trinity-large-preview:free',
  'stepfun/step-3.5-flash:free',
  'z-ai/glm-4.5-air:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemma-3-27b-it:free',
  'upstage/solar-pro-3:free',
  'arcee-ai/trinity-mini:free',
  'google/gemma-3-12b-it:free',
  'nvidia/nemotron-nano-9b-v2:free',
  'qwen/qwen3-235b-a22b:free',
  'deepseek/deepseek-r1-0528:free',
  'mistralai/devstral-small:free',
  'google/gemma-3n-e4b-it:free',
  'moonshotai/kimi-k2-instruct:free',
];

const QUESTIONS = [
  {
    name: 'Simple Q&A',
    messages: [
      { role: 'system', content: 'You are a helpful assistant. Answer concisely.' },
      { role: 'user', content: 'What are 3 benefits of working from the office?' },
    ],
  },
  {
    name: 'JSON extraction',
    messages: [
      {
        role: 'system',
        content: `Extract the intent as JSON. Output ONLY valid JSON, no extra text.
Example: {"intent":"comparison","people":["me","rahul"],"timeRange":"next month"}`,
      },
      {
        role: 'user',
        content: 'Which days should I go to office next month to have minimum overlap with Rahul?',
      },
    ],
  },
  {
    name: 'Schedule parse',
    messages: [
      {
        role: 'system',
        content: `Parse the scheduling command into JSON. Today is 2026-02-25 (Wednesday).
Output ONLY valid JSON: {"actions":[{"type":"set","status":"office"|"leave","dateExpressions":["..."]}],"summary":"..."}`,
      },
      { role: 'user', content: 'Set next Monday and Tuesday as office, and take half day leave on Friday' },
    ],
  },
];

const TIMEOUT_MS = 30_000;

async function testModel(model, question) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  const start = Date.now();

  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
        'HTTP-Referer': CLIENT_URL,
        'X-Title': 'A-Team-Tracker Benchmark',
      },
      body: JSON.stringify({
        model,
        messages: question.messages,
        max_tokens: 1024,
        temperature: 0.1,
      }),
      signal: ac.signal,
    });
    clearTimeout(timer);

    const elapsed = Date.now() - start;

    if (res.status === 429) {
      return { model, question: question.name, status: 'RATE_LIMITED', elapsed, answer: '' };
    }

    if (!res.ok) {
      const body = await res.text();
      return { model, question: question.name, status: `HTTP ${res.status}`, elapsed, answer: body.substring(0, 150) };
    }

    const data = await res.json();
    const msg = data.choices?.[0]?.message;
    const answer = msg?.content?.trim() || msg?.reasoning_content?.trim() || msg?.reasoning?.trim() || '(empty)';
    const tokens = data.usage;

    return {
      model,
      question: question.name,
      status: 'OK',
      elapsed,
      promptTokens: tokens?.prompt_tokens,
      completionTokens: tokens?.completion_tokens,
      answer: answer.substring(0, 200),
    };
  } catch (err) {
    clearTimeout(timer);
    const elapsed = Date.now() - start;
    const errMsg = err.name === 'AbortError' ? `TIMEOUT (${TIMEOUT_MS / 1000}s)` : err.message;
    return { model, question: question.name, status: errMsg, elapsed, answer: '' };
  }
}

async function main() {
  if (!API_KEY) {
    console.error('ERROR: OPENROUTER_API_KEY not set in .env');
    process.exit(1);
  }

  console.log('='.repeat(100));
  console.log('OpenRouter Free Models Benchmark');
  console.log(`Testing ${MODELS.length} models × ${QUESTIONS.length} questions = ${MODELS.length * QUESTIONS.length} calls`);
  console.log('='.repeat(100));
  console.log();

  const results = [];

  for (const question of QUESTIONS) {
    console.log(`\n--- ${question.name} ---`);
    console.log('-'.repeat(100));

    for (const model of MODELS) {
      process.stdout.write(`  ${model.padEnd(50)} `);
      const result = await testModel(model, question);
      results.push(result);

      if (result.status === 'OK') {
        console.log(`✓ ${String(result.elapsed).padStart(6)}ms  (${result.promptTokens}→${result.completionTokens} tok)  ${result.answer.substring(0, 70)}...`);
      } else {
        console.log(`✗ ${String(result.elapsed).padStart(6)}ms  [${result.status}]  ${result.answer.substring(0, 70)}`);
      }

      // Small delay between calls to avoid rate limits on free tier
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Summary table
  console.log('\n\n' + '='.repeat(100));
  console.log('SUMMARY');
  console.log('='.repeat(100));

  const modelStats = {};
  for (const r of results) {
    if (!modelStats[r.model]) modelStats[r.model] = { ok: 0, fail: 0, rateLimit: 0, times: [] };
    if (r.status === 'OK') {
      modelStats[r.model].ok++;
      modelStats[r.model].times.push(r.elapsed);
    } else if (r.status === 'RATE_LIMITED') {
      modelStats[r.model].rateLimit++;
    } else {
      modelStats[r.model].fail++;
    }
  }

  console.log(`${'Model'.padEnd(50)} ${'OK'.padStart(4)} ${'Fail'.padStart(5)} ${'429'.padStart(4)} ${'Avg ms'.padStart(8)} ${'Min ms'.padStart(8)} ${'Max ms'.padStart(8)}`);
  console.log('-'.repeat(95));

  // Sort by avg time (fastest first), failures last
  const sorted = Object.entries(modelStats).sort((a, b) => {
    if (a[1].ok === 0 && b[1].ok > 0) return 1;
    if (b[1].ok === 0 && a[1].ok > 0) return -1;
    const avgA = a[1].times.length ? a[1].times.reduce((s, v) => s + v, 0) / a[1].times.length : Infinity;
    const avgB = b[1].times.length ? b[1].times.reduce((s, v) => s + v, 0) / b[1].times.length : Infinity;
    return avgA - avgB;
  });

  for (const [model, stats] of sorted) {
    const avg = stats.times.length ? Math.round(stats.times.reduce((a, b) => a + b, 0) / stats.times.length) : '-';
    const min = stats.times.length ? Math.min(...stats.times) : '-';
    const max = stats.times.length ? Math.max(...stats.times) : '-';
    console.log(
      `${model.padEnd(50)} ${String(stats.ok).padStart(4)} ${String(stats.fail).padStart(5)} ${String(stats.rateLimit).padStart(4)} ${String(avg).padStart(8)} ${String(min).padStart(8)} ${String(max).padStart(8)}`
    );
  }
}

main().catch(console.error);
