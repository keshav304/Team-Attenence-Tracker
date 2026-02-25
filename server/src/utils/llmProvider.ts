/**
 * Unified LLM Provider — supports OpenRouter and NVIDIA NIM APIs.
 *
 * Switch between providers using the LLM_PROVIDER env var ("openrouter" | "nvidia").
 * All LLM callers should use `callLLMProvider()` instead of making direct fetch calls.
 */

import config from '../config/index.js';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMCallOptions {
  /** Messages to send (system + user + optional history) */
  messages: LLMMessage[];
  /** Maximum tokens in the response (default: 1024) */
  maxTokens?: number;
  /** Sampling temperature (default: 0.2) */
  temperature?: number;
  /** Per-model timeout in ms (default: 30_000) */
  timeoutMs?: number;
  /** Whether to request JSON format (only supported on some models) */
  jsonMode?: boolean;
  /** Log prefix for console output (default: "LLM") */
  logPrefix?: string;
}

export type LLMProvider = 'openrouter' | 'nvidia';

/* ------------------------------------------------------------------ */
/*  Model lists                                                       */
/* ------------------------------------------------------------------ */

/**
 * OpenRouter free-tier models (tried in order).
 * Benchmarked 2026-02-25 — ordered by speed + reliability.
 *
 *  #  Model                                  Avg ms   Reliability
 *  1  arcee-ai/trinity-large-preview          975     3/3  ← fastest, clean output
 *  2  nvidia/nemotron-3-nano-30b-a3b        1,094     3/3
 *  3  upstage/solar-pro-3                   1,610     3/3  ← good JSON
 *  4  nvidia/nemotron-nano-9b-v2            1,909     3/3
 *  5  arcee-ai/trinity-mini                 3,978     3/3  ← inconsistent spikes
 *  6  stepfun/step-3.5-flash                5,737     3/3  ← slow fallback
 *  7  z-ai/glm-4.5-air                     6,284     3/3  ← slow fallback
 *  8+ llama-3.3-70b / gemma — rate-limited during benchmark, kept as last resort
 */
const OPENROUTER_MODELS = [
  'arcee-ai/trinity-large-preview:free',               // ~1s avg, fastest, clean output
  'nvidia/nemotron-3-nano-30b-a3b:free',               // ~1.1s avg, fast & reliable
  'upstage/solar-pro-3:free',                          // ~1.6s avg, good JSON extraction
  'nvidia/nemotron-nano-9b-v2:free',                   // ~1.9s avg, lightweight
  'arcee-ai/trinity-mini:free',                        // ~4s avg, inconsistent but works
  'stepfun/step-3.5-flash:free',                       // ~5.7s avg, slow fallback
  'z-ai/glm-4.5-air:free',                            // ~6.3s avg, slow fallback
  'meta-llama/llama-3.3-70b-instruct:free',            // rate-limited, last resort
  'google/gemma-3-27b-it:free',                        // rate-limited, last resort
  'google/gemma-3-12b-it:free',                        // rate-limited, last resort
];

/**
 * NVIDIA NIM models (tried in order).
 * Free-tier models available at https://build.nvidia.com
 * Benchmarked 2026-02-25 — ordered by speed + reliability.
 *
 *  #  Model                                Avg ms   Reliability
 *  1  meta/llama-3.3-70b-instruct          1,075    3/3  ← fastest
 *  2  google/gemma-3-27b-it                1,547    3/3
 *  3  mistralai/mistral-nemotron           1,839    3/3
 *  4  nvidia/llama-3.1-nemotron-ultra-253b 2,156    3/3  ← strongest reasoning
 *  5  nvidia/nemotron-3-nano-30b-a3b       3,555    3/3  ← lightweight fallback
 */
const NVIDIA_MODELS = [
  'meta/llama-3.3-70b-instruct',                      // ~1s avg, clean JSON, best overall
  'google/gemma-3-27b-it',                             // ~1.5s avg, reliable mid-size
  'mistralai/mistral-nemotron',                        // ~1.8s avg, good instruction following
  'nvidia/llama-3.1-nemotron-ultra-253b-v1',          // ~2.2s avg, strongest reasoning
  'nvidia/nemotron-3-nano-30b-a3b',                    // ~3.5s avg, lightweight last resort
];

/* ------------------------------------------------------------------ */
/*  Provider configuration                                            */
/* ------------------------------------------------------------------ */

interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  models: string[];
  headers: (apiKey: string) => Record<string, string>;
  bodyExtras: (model: string) => Record<string, unknown>;
}

function getProviderConfig(provider: LLMProvider): ProviderConfig {
  switch (provider) {
    case 'nvidia':
      return {
        baseUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
        apiKey: config.nvidiaApiKey,
        models: NVIDIA_MODELS,
        headers: (apiKey) => ({
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        }),
        bodyExtras: (model) => {
          // Kimi K2.5 supports thinking mode
          if (model.includes('kimi-k2.5')) {
            return { chat_template_kwargs: { thinking: true } };
          }
          return {};
        },
      };

    case 'openrouter':
    default:
      return {
        baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
        apiKey: config.openRouterApiKey,
        models: OPENROUTER_MODELS,
        headers: (apiKey) => ({
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': config.clientUrl,
          'X-Title': 'A-Team-Tracker',
        }),
        bodyExtras: () => ({}),
      };
  }
}

/* ------------------------------------------------------------------ */
/*  Active provider                                                   */
/* ------------------------------------------------------------------ */

export function getActiveProvider(): LLMProvider {
  const env = config.llmProvider?.toLowerCase();
  if (env === 'nvidia') return 'nvidia';
  return 'openrouter';
}

/* ------------------------------------------------------------------ */
/*  Core LLM call                                                     */
/* ------------------------------------------------------------------ */

/**
 * Call the configured LLM provider. Tries models in order until one
 * succeeds with a non-empty response.
 *
 * Handles rate-limiting, timeouts, empty responses, and model fallback.
 */
export async function callLLMProvider(opts: LLMCallOptions): Promise<string> {
  const {
    messages,
    maxTokens = 1024,
    temperature = 0.2,
    timeoutMs = 30_000,
    jsonMode = false,
    logPrefix = 'LLM',
  } = opts;

  const provider = getActiveProvider();
  const providerCfg = getProviderConfig(provider);

  if (!providerCfg.apiKey) {
    const keyName = provider === 'nvidia' ? 'NVIDIA_API_KEY' : 'OPENROUTER_API_KEY';
    throw new Error(`${keyName} is not configured (LLM_PROVIDER=${provider})`);
  }

  let lastError = '';
  const overallStart = Date.now();

  for (const model of providerCfg.models) {
    const modelStart = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);

    try {
      const body: Record<string, unknown> = {
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
        top_p: 1.0,
        ...providerCfg.bodyExtras(model),
      };

      // JSON mode — OpenRouter supports response_format, NVIDIA may not for all models
      if (jsonMode && provider === 'openrouter') {
        body.response_format = { type: 'json_object' };
      }

      const res = await fetch(providerCfg.baseUrl, {
        method: 'POST',
        headers: providerCfg.headers(providerCfg.apiKey),
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      clearTimeout(timer);

      if (res.status === 429) {
        await res.text();
        lastError = `Rate limited (${model})`;
        console.log(`[${logPrefix}] ⚠ [${provider}] ${model} → 429 rate-limited (${Date.now() - modelStart}ms)`);
        continue;
      }

      if (!res.ok) {
        const errBody = await res.text();
        lastError = `${model} error ${res.status}: ${errBody.substring(0, 200)}`;
        console.log(`[${logPrefix}] ✗ [${provider}] ${model} → HTTP ${res.status} (${Date.now() - modelStart}ms)`);
        continue;
      }

      const data = (await res.json()) as {
        choices: {
          message: {
            content?: string;
            reasoning?: string;
            reasoning_content?: string;
          };
        }[];
      };

      const msg = data.choices?.[0]?.message;
      const answer =
        msg?.content?.trim() ||
        msg?.reasoning_content?.trim() ||
        msg?.reasoning?.trim() ||
        '';

      if (answer) {
        console.log(`[${logPrefix}] ✓ [${provider}] ${model} → success (${Date.now() - modelStart}ms, total ${Date.now() - overallStart}ms)`);
        return answer;
      }

      lastError = `Empty answer (${model})`;
      console.log(`[${logPrefix}] ✗ [${provider}] ${model} → empty response (${Date.now() - modelStart}ms)`);
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof Error && (err.name === 'AbortError' || (err as any).name === 'AbortError')) {
        lastError = `Timeout after ${timeoutMs / 1000}s (${model})`;
        console.log(`[${logPrefix}] ✗ [${provider}] ${model} → timeout after ${timeoutMs}ms`);
      } else {
        lastError = err instanceof Error ? err.message : String(err);
        console.log(`[${logPrefix}] ✗ [${provider}] ${model} → error: ${lastError} (${Date.now() - modelStart}ms)`);
      }
    }
  }

  console.log(`[${logPrefix}] ✗ [${provider}] All models failed after ${Date.now() - overallStart}ms. Last: ${lastError}`);
  throw new Error(`All LLM models failed (provider: ${provider}). Last error: ${lastError}`);
}
