# BigSet Local Hermes Migration Notes

This repo has been adapted so BigSet can run in a local-first Hermes mode.

## Final target

`LLM_PROVIDER_MODE=hermes` routes all AI and live-web research through one local Hermes Agent API server.

Hermes is configured outside BigSet, normally with:

- provider: `openai-codex`
- auth: ChatGPT/Codex OAuth stored by Hermes
- model: a Codex-visible model such as `gpt-5.5`
- tools: `web_search`, `web_extract`, optional browser automation
- API server: OpenAI-compatible `/v1/chat/completions`

BigSet calls Hermes at `HERMES_BASE_URL` and authenticates with `HERMES_API_KEY`, which must match Hermes' API server key.

## What was replaced

| Before | After in Hermes mode |
|---|---|
| OpenRouter for schema inference | Hermes strict-JSON call |
| OpenRouter populate orchestrator | Deterministic BigSet orchestration around Hermes JSON calls |
| OpenRouter investigate subagents | Hermes per-entity research returning one row of JSON |
| OpenRouter refresh agents | Hermes row verification returning JSON update decisions |
| TinyFish search/fetch tools | Hermes web tools |

The OpenRouter + TinyFish code path remains available when `LLM_PROVIDER_MODE=openrouter`.

## Why the final design changed from a simple provider swap

A simple OpenAI-compatible base URL swap is not enough because Hermes is an agent endpoint. It can use its own tools, but it does not behave like a raw model that Mastra can drive with arbitrary client-supplied tool schemas.

The safe design is:

```text
Hermes does model + web research -> returns strict JSON
BigSet validates JSON -> writes rows through existing server-side tools
```

This avoids double agent loops and preserves the write authorization model.

## Implementation phases completed

1. Added `LLM_PROVIDER_MODE=hermes` and Hermes env settings in `backend/src/env.ts`.
2. Added Hermes API client and JSON validation helper under `backend/src/hermes/`.
3. Branched schema inference to Hermes in Hermes mode.
4. Added bounded Hermes populate orchestration.
5. Branched populate/update workflows to use Hermes in Hermes mode.
6. Updated setup status so Hermes endpoint health replaces TinyFish/OpenRouter setup in Hermes mode.
7. Added static Hermes model catalog behavior.
8. Wired Hermes env vars into Docker Compose.
9. Added public docs and `.env.example`.

## Operational defaults

```bash
LLM_PROVIDER_MODE=hermes
HERMES_BASE_URL=http://host.docker.internal:8642/v1
HERMES_MODEL=hermes-agent
HERMES_CHAT_TIMEOUT_MS=180000
HERMES_DISCOVERY_TIMEOUT_MS=120000
HERMES_RESEARCH_TIMEOUT_MS=480000
HERMES_MAX_ROWS=25
HERMES_BATCH_MAX_ROWS=10
HERMES_MAX_CANDIDATES_PER_ROUND=15
HERMES_MAX_CONCURRENT=2
```

`host.docker.internal` is required for Docker dev because the backend container must reach the host-side Hermes gateway.

## Verification target

Use a small prompt:

```text
5 popular open-source database engines with license and first release year
```

Expected outcome: five rows inserted, with source URLs and row summaries.

## Rollback

```bash
LLM_PROVIDER_MODE=openrouter
```

Then configure `OPENROUTER_API_KEY` and `TINYFISH_API_KEY`.
