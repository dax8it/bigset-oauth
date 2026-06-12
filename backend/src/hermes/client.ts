/**
 * Minimal HTTP client for a locally running hermes-agent API server.
 *
 * hermes-agent (https://hermes-agent.nousresearch.com) exposes an
 * OpenAI-compatible **agent** endpoint at {HERMES_BASE_URL}/chat/completions.
 * Two properties matter for how BigSet uses it:
 *
 *   1. The `model` field is cosmetic — the actual LLM is whatever provider
 *      hermes is configured with server-side. In our setup that is the
 *      "OpenAI Codex" provider (ChatGPT OAuth → GPT-5.5), so every call
 *      here runs on the user's ChatGPT subscription.
 *
 *   2. It is an AGENT endpoint, not raw model inference: hermes runs its
 *      own toolset (web_search, web_extract, terminal, …) while handling
 *      a request and returns only the final assistant message. Client-side
 *      `tools` arrays are NOT honored. That's why BigSet, in hermes mode,
 *      asks hermes for *structured JSON results* and performs all dataset
 *      writes itself through the existing closure-scoped Convex tools —
 *      the LLM never gets write access, which preserves the authz model.
 *
 * Requests are stateless (full context in each call), matching how the
 * populate pipeline already isolates per-entity research.
 */

import { z } from "zod";
import { env } from "../env.js";

export interface HermesUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface HermesChatResult {
  text: string;
  usage: HermesUsage;
}

export interface HermesChatOptions {
  system?: string;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  /**
   * Hint threaded through as X-Hermes-Session-Id so related calls within
   * one populate run group together in hermes' session history/dashboard.
   */
  sessionId?: string;
}

function requireHermesConfig(): { baseUrl: string; apiKey: string } {
  if (!env.HERMES_API_KEY) {
    throw new Error(
      "LLM_PROVIDER_MODE=hermes but HERMES_API_KEY is not set. " +
        "Set it to the API_SERVER_KEY value from ~/.hermes/.env on the host.",
    );
  }
  return { baseUrl: env.HERMES_BASE_URL, apiKey: env.HERMES_API_KEY };
}

function combineSignals(
  timeoutMs: number,
  abortSignal?: AbortSignal,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return abortSignal ? AbortSignal.any([abortSignal, timeout]) : timeout;
}

/**
 * One stateless chat-completion call against the hermes agent.
 * Returns the final assistant text plus token usage (when reported).
 */
export async function hermesChat(
  prompt: string,
  options: HermesChatOptions = {},
): Promise<HermesChatResult> {
  const { baseUrl, apiKey } = requireHermesConfig();
  const timeoutMs = options.timeoutMs ?? env.HERMES_CHAT_TIMEOUT_MS;

  const messages: Array<{ role: string; content: string }> = [];
  if (options.system) messages.push({ role: "system", content: options.system });
  messages.push({ role: "user", content: prompt });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (options.sessionId) headers["X-Hermes-Session-Id"] = options.sessionId;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: env.HERMES_MODEL,
      messages,
      stream: false,
    }),
    signal: combineSignals(timeoutMs, options.abortSignal),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "hermes-agent rejected the API key. Check HERMES_API_KEY matches API_SERVER_KEY in ~/.hermes/.env.",
      );
    }
    throw new Error(
      `hermes-agent chat failed: HTTP ${res.status} ${res.statusText} ${body.slice(0, 300)}`,
    );
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const text = json.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) {
    throw new Error("hermes-agent returned an empty response.");
  }

  return {
    text,
    usage: {
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
    },
  };
}

/**
 * Pull the first JSON value (object or array) out of agent text.
 *
 * Agents wrap JSON in prose or markdown fences more often than not, so:
 *   1. try the whole trimmed text,
 *   2. try fenced ```json blocks,
 *   3. scan for the first balanced {...} or [...] span.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();

  const tryParse = (candidate: string): unknown | undefined => {
    try {
      return JSON.parse(candidate);
    } catch {
      return undefined;
    }
  };

  const whole = tryParse(trimmed);
  if (whole !== undefined) return whole;

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    const fenced = tryParse(fenceMatch[1].trim());
    if (fenced !== undefined) return fenced;
  }

  // Balanced-span scan from the first opening brace/bracket.
  for (const open of ["{", "["] as const) {
    const close = open === "{" ? "}" : "]";
    const start = trimmed.indexOf(open);
    if (start === -1) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = !inString;
      if (inString) continue;
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          const span = tryParse(trimmed.slice(start, i + 1));
          if (span !== undefined) return span;
          break;
        }
      }
    }
  }

  throw new Error(
    `Could not extract JSON from hermes response (first 200 chars): ${trimmed.slice(0, 200)}`,
  );
}

export interface HermesJsonResult<T> {
  value: T;
  usage: HermesUsage;
}

/**
 * Chat call that must come back as schema-valid JSON. On a parse or
 * validation failure, retries ONCE with the validation error appended —
 * the same self-correction pattern pipeline/schema-inference.ts already
 * uses for OpenRouter structured output.
 */
export async function hermesJsonChat<T>(
  prompt: string,
  schema: z.ZodType<T>,
  options: HermesChatOptions = {},
): Promise<HermesJsonResult<T>> {
  const usage: HermesUsage = { inputTokens: 0, outputTokens: 0 };

  const attempt = async (p: string): Promise<T> => {
    const result = await hermesChat(p, options);
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    const raw = extractJson(result.text);
    return schema.parse(raw);
  };

  try {
    return { value: await attempt(prompt), usage };
  } catch (err) {
    // User-initiated aborts and timeouts must propagate, not retry.
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      throw err;
    }
    const detail = err instanceof Error ? err.message : String(err);
    const retryPrompt = `${prompt}

Your previous reply failed JSON validation:
${detail.slice(0, 1000)}

Reply again. Output ONLY the corrected JSON — no prose, no markdown fences.`;
    return { value: await attempt(retryPrompt), usage };
  }
}

/**
 * Lightweight reachability/auth check used by local setup status.
 * GET /v1/models is part of the hermes API server's stable surface.
 */
export async function verifyHermesEndpoint(): Promise<void> {
  const { baseUrl, apiKey } = requireHermesConfig();
  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "hermes-agent rejected the API key. Check HERMES_API_KEY matches API_SERVER_KEY.",
      );
    }
    throw new Error(`hermes-agent verification failed: HTTP ${res.status}`);
  }
}
