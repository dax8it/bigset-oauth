# Implementation Notes: Hermes + Codex OAuth Mode

This document records the implementation choices behind BigSet's `LLM_PROVIDER_MODE=hermes` path.

## Summary

Original BigSet used:

- OpenRouter for schema inference, populate orchestration, investigation subagents, and refresh agents.
- TinyFish APIs for web search and page fetching.

Hermes mode replaces both with one local Hermes Agent API server:

- Hermes is configured outside the repo with the `openai-codex` provider and ChatGPT/Codex OAuth.
- BigSet talks to Hermes through `/v1/chat/completions`.
- Hermes executes its own web tools (`web_search`, `web_extract`, optional browser).
- BigSet validates strict JSON responses and writes rows itself.

The original OpenRouter + TinyFish path remains env-gated behind `LLM_PROVIDER_MODE=openrouter`.

## Design decisions

### 1. Hermes is treated as an agent endpoint, not a raw model

Hermes' OpenAI-compatible endpoint runs a Hermes conversation loop. It can use Hermes tools internally, but it is not a raw OpenAI tool-calling model that Mastra can drive with arbitrary client-side tool schemas.

Because of that, Hermes mode does not run the original Mastra LLM tool loop directly against Hermes. Instead, BigSet uses deterministic TypeScript orchestration:

```text
BigSet prompt -> Hermes strict JSON -> Zod validation -> BigSet write tool -> Convex
```

This avoids a double-agent-loop failure mode where Mastra and Hermes both try to control tool execution.

### 2. The LLM never gets write capability

In the original path, agents could call `insert_row` / `update_row` tools through Mastra. In Hermes mode, Hermes never receives those tools. It only returns data.

BigSet keeps write authority in process:

- `buildPopulateTools(datasetId, authContext)` captures dataset id server-side.
- Convex mutations still check dataset ownership and expected dataset id.
- Primary-key dedup remains in the BigSet tool path.

### 3. Schema inference is strict JSON, not AI SDK structured output

`backend/src/pipeline/schema-inference.ts` uses AI SDK structured output in OpenRouter mode.

In Hermes mode, the schema prompt includes an explicit JSON shape and calls `hermesJsonChat()`, then validates with the same Zod schema. `hermesJsonChat()` extracts JSON and retries once with validation errors.

### 4. Populate is bounded for local agent latency

Local Hermes/Codex calls are slower and can do real web work. The implementation adds caps:

- `HERMES_MAX_ROWS`
- `HERMES_MAX_CANDIDATES_PER_ROUND`
- `HERMES_MAX_CONCURRENT`
- `HERMES_DISCOVERY_TIMEOUT_MS`
- `HERMES_RESEARCH_TIMEOUT_MS`

`backend/src/hermes/populate-run.ts` also detects an explicit leading count in the dataset description. For example, `5 popular databases...` resolves to a target of 5 rows, bounded by `HERMES_MAX_ROWS`.

### 5. Discovery avoids source-hint pinning

A schema inference step may produce a `source_hint`. In OpenRouter/TinyFish mode that can be useful. In Hermes mode, pinning discovery to a stale or blocked URL can trap the agent in repeated failed fetches.

`backend/src/mastra/workflows/populate.ts` therefore does not force schema-inferred source hints into Hermes populate discovery. Hermes discovery is prompted to find fast lead sources with search first, then investigate each entity separately.

## Files touched

| File | Responsibility |
|---|---|
| `backend/src/env.ts` | Parses `LLM_PROVIDER_MODE`, Hermes base URL/key/model, timeouts, caps, and concurrency. |
| `backend/src/hermes/client.ts` | Hermes HTTP client, JSON extraction, Zod validation, retry-on-validation-error, endpoint health check. |
| `backend/src/hermes/research.ts` | Strict-JSON contracts for discovery, per-entity investigation, and refresh. |
| `backend/src/hermes/populate-run.ts` | Bounded populate orchestration, candidate discovery, per-entity research, insert application, metrics. |
| `backend/src/pipeline/schema-inference.ts` | Branches schema inference to Hermes in Hermes mode. |
| `backend/src/mastra/workflows/populate.ts` | Keeps the workflow shell but delegates populate agent step to Hermes orchestration in Hermes mode. |
| `backend/src/mastra/workflows/update.ts` | Uses Hermes refresh outcomes and applies updates with BigSet's `update_row`. |
| `backend/src/local-credentials.ts` | Treats Hermes endpoint health as local setup completion in Hermes mode. |
| `backend/src/config/models.ts` | Uses a static Hermes model catalog and ignores OpenRouter model choices in Hermes mode. |
| `docker-compose.dev.yml` | Passes Hermes env vars into backend and Mastra services. |
| `.env.example` | Public template for both Hermes and original modes. |

## Environment contract

Minimum Hermes mode:

```bash
LLM_PROVIDER_MODE=hermes
HERMES_BASE_URL=http://host.docker.internal:8642/v1
HERMES_API_KEY=replace-this-local-secret
HERMES_MODEL=hermes-agent
```

Hermes host profile must have:

```bash
API_SERVER_ENABLED=true
API_SERVER_HOST=0.0.0.0
API_SERVER_PORT=8642
API_SERVER_KEY=replace-this-local-secret
```

`HERMES_API_KEY` must equal Hermes `API_SERVER_KEY`.

## Verification performed during implementation

The implementation was validated against a bounded prompt:

```text
5 popular open-source database engines with license and first release year
```

Expected logs include a 5-row target and an 8-candidate discovery batch. A successful run inserts five rows. If the UI still shows an older `Last populate failed` banner while rows exist, treat that as stale run-status state and inspect backend logs before assuming the current run failed.

## Troubleshooting notes

### `TypeError: fetch failed`

Usually one of:

- Hermes gateway is not running or was restarted mid-request.
- `HERMES_API_KEY` does not match `API_SERVER_KEY`.
- Docker is using `127.0.0.1` instead of `host.docker.internal`.
- Hermes web extraction backend is timing out.
- Discovery got stuck on a blocked/dead URL.

Check:

```bash
docker compose -f docker-compose.dev.yml logs --since=20m backend
```

And the active Hermes profile gateway logs.

### Hermes returns invalid JSON

Relevant files:

- `backend/src/hermes/research.ts`
- `backend/src/pipeline/schema-inference.ts`
- `backend/src/hermes/client.ts`

Tighten the prompt contract or the Zod schema depending on whether the JSON is malformed or semantically invalid.

## Rollback

To return to the original path:

```bash
LLM_PROVIDER_MODE=openrouter
```

Then provide `OPENROUTER_API_KEY` and `TINYFISH_API_KEY` through setup or `.env`, and restart the stack.
