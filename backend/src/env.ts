import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";

loadDotenv({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * LLM provider mode.
 *
 * "openrouter" (default) — original behavior: OpenRouter for all LLM calls,
 *   TinyFish for web search/fetch. Nothing changes.
 *
 * "hermes" — all LLM + web work flows through a locally running
 *   hermes-agent API server (https://hermes-agent.nousresearch.com).
 *   Hermes is configured separately with the "OpenAI Codex" provider
 *   (ChatGPT OAuth → GPT-5.5), so every model call runs on the user's
 *   ChatGPT subscription and all web research uses hermes' own
 *   web_search / web_extract tools. OpenRouter and TinyFish keys are
 *   not required in this mode.
 */
const llmProviderMode =
  process.env.LLM_PROVIDER_MODE === "hermes" ? "hermes" : "openrouter";

export const env = {
  PROD: process.env.PROD,
  IS_PROD: process.env.PROD === "1",
  IS_LOCAL_MODE: process.env.PROD !== "1",

  LLM_PROVIDER_MODE: llmProviderMode as "openrouter" | "hermes",
  IS_HERMES_MODE: llmProviderMode === "hermes",

  // hermes-agent API server (OpenAI-compatible agent endpoint).
  // Inside Docker, 127.0.0.1 is the container — use host.docker.internal
  // to reach a hermes gateway running on the host machine.
  HERMES_BASE_URL: (
    process.env.HERMES_BASE_URL || "http://host.docker.internal:8642/v1"
  ).replace(/\/+$/, ""),
  // Must match API_SERVER_KEY in ~/.hermes/.env on the host.
  HERMES_API_KEY: process.env.HERMES_API_KEY || "",
  // Cosmetic — the hermes API server uses its own configured provider/model.
  HERMES_MODEL: process.env.HERMES_MODEL || "hermes-agent",
  // Agentic research calls (web search + multi-step reasoning) are slow.
  // These bound a single hermes chat call, not the whole populate run.
  HERMES_RESEARCH_TIMEOUT_MS: numberFromEnv("HERMES_RESEARCH_TIMEOUT_MS", 480_000),
  HERMES_DISCOVERY_TIMEOUT_MS: numberFromEnv("HERMES_DISCOVERY_TIMEOUT_MS", 120_000),
  HERMES_CHAT_TIMEOUT_MS: numberFromEnv("HERMES_CHAT_TIMEOUT_MS", 180_000),
  // Concurrent per-entity research calls during a populate run. A single
  // hermes gateway handles concurrent requests, but keep this modest.
  HERMES_MAX_CONCURRENT: numberFromEnv("HERMES_MAX_CONCURRENT", 2),
  // Overall local cap for a populate run. Larger runs are split into
  // bounded batches so no single discovery/investigation wave gets too big.
  HERMES_MAX_ROWS: numberFromEnv("HERMES_MAX_ROWS", 25),
  HERMES_BATCH_MAX_ROWS: numberFromEnv("HERMES_BATCH_MAX_ROWS", 10),
  HERMES_MAX_CANDIDATES_PER_ROUND: numberFromEnv(
    "HERMES_MAX_CANDIDATES_PER_ROUND",
    15,
  ),
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN || "http://localhost:3500",
  CONVEX_URL: required("CONVEX_URL"),
  PORT: numberFromEnv("PORT", 3501),

  // Used by ./convex.ts to call internal Convex functions (e.g. agent-driven
  // row inserts). Optional today because no scheduled jobs run yet; required
  // once the agent runner actually writes to Convex.
  CONVEX_ADMIN_KEY: process.env.CONVEX_SELF_HOSTED_ADMIN_KEY,

  // Used by ./clerk-auth.ts to verify JWTs on protected routes (e.g.
  // /infer-schema). Required for the backend to function.
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  CLERK_PUBLISHABLE_KEY:
    process.env.CLERK_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,

  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  BIGSET_LOCAL_WORKSPACE_ID: required("BIGSET_LOCAL_WORKSPACE_ID"),
  LOCAL_KEYCHAIN_URL: process.env.LOCAL_KEYCHAIN_URL,
  LOCAL_KEYCHAIN_TOKEN: process.env.LOCAL_KEYCHAIN_TOKEN,
  LOCAL_KEYCHAIN_TIMEOUT_MS: numberFromEnv("LOCAL_KEYCHAIN_TIMEOUT_MS", 5_000),

  // Default models — used when a user has not saved a preference.
  // Each must be a valid OpenRouter model slug.
  SCHEMA_INFERENCE_MODEL:
    process.env.SCHEMA_INFERENCE_MODEL ?? "anthropic/claude-sonnet-4.6",
  POPULATE_ORCHESTRATOR_MODEL:
    process.env.POPULATE_ORCHESTRATOR_MODEL ?? "qwen/qwen3.7-max",
  INVESTIGATE_SUBAGENT_MODEL:
    process.env.INVESTIGATE_SUBAGENT_MODEL ?? "qwen/qwen3.7-max",

  // Resend (transactional email). Optional — when RESEND_API_KEY is unset
  // the email module no-ops with a log line, so local dev works without
  // a Resend account. EMAIL_FROM must be a domain that's verified in the
  // Resend dashboard.
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM || "BigSet <simantak@tinyfish.ai>",

  // PostHog (server-side analytics for events the frontend can't observe —
  // currently just the transactional email lifecycle). Same project key
  // as the frontend (`phc_...`); events identify by Clerk userId so they
  // associate to the same user the frontend already identified.
  // No-op when unset.
  POSTHOG_KEY: process.env.POSTHOG_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY,
  POSTHOG_HOST:
    process.env.POSTHOG_HOST ||
    process.env.NEXT_PUBLIC_POSTHOG_HOST ||
    "https://us.i.posthog.com",

  REFRESH_SCHEDULER_ENABLED:
    process.env.REFRESH_SCHEDULER_ENABLED !== "false",
  REFRESH_SCHEDULER_POLL_MS: numberFromEnv(
    "REFRESH_SCHEDULER_POLL_MS",
    60_000,
  ),
  REFRESH_SCHEDULER_BATCH_SIZE: numberFromEnv(
    "REFRESH_SCHEDULER_BATCH_SIZE",
    5,
  ),
  REFRESH_SCHEDULER_STALE_AFTER_MS: numberFromEnv(
    "REFRESH_SCHEDULER_STALE_AFTER_MS",
    6 * 60 * 60 * 1000,
  ),

};
