# Hermes Mode — Run BigSet on local Codex GPT‑5.5 + hermes‑agent

Hermes mode replaces BigSet's two external paid dependencies with locally
running software:

| Was (openrouter mode) | Now (hermes mode) |
|---|---|
| **OpenRouter** — LLM calls (schema inference, orchestrator, subagents) | **Codex GPT‑5.5 via ChatGPT OAuth**, configured *inside* hermes‑agent |
| **TinyFish** — web search + page fetch | **hermes‑agent's own web tools** (`web_search`, `web_extract`, browser) |

It is fully env‑gated: with `LLM_PROVIDER_MODE` unset (or `openrouter`),
nothing changes. Set `LLM_PROVIDER_MODE=hermes` and no OpenRouter or
TinyFish key is needed anywhere.

---

## How it works

[hermes‑agent](https://hermes-agent.nousresearch.com) exposes an
OpenAI‑compatible **agent** endpoint (`/v1/chat/completions`). Two facts
shaped the design:

1. **Codex OAuth lives inside hermes.** Hermes ships an "OpenAI Codex"
   provider — a ChatGPT device‑code OAuth flow. Once configured, GPT‑5.5
   is the model behind every hermes response, billed to your ChatGPT
   subscription. BigSet never talks to OpenAI directly.
2. **The hermes endpoint is an agent, not a raw model.** Its `model` field
   is cosmetic and it runs *its own* tools — it does not honor client-side
   `tools` arrays. So BigSet doesn't run its Mastra LLM tool loop against
   hermes. Instead, BigSet asks hermes for **strict‑JSON research results**
   and performs every dataset write itself.

```
schema inference  ──▶  hermes /v1/chat/completions ──▶ JSON schema (Zod-validated)

populate run:
  discovery        ──▶ hermes (web_search …) ──▶ JSON entity list
  per-entity       ──▶ hermes (web research) ──▶ JSON row {data, sources, how_found}
  insert           ──▶ BigSet's closure-scoped insert_row → Convex (PK dedup, authz)

refresh run:
  per-row          ──▶ hermes (re-verify via how_found/sources) ──▶ JSON {updated, data}
  apply            ──▶ BigSet's closure-scoped update_row → Convex
```

**Security note:** in hermes mode the LLM never holds a write capability at
all — inserts/updates go through the same `buildPopulateTools()` closure
(dataset id captured in the closure, primary‑key dedup and atomic
dataset‑id checks in Convex) that the original agents used. The authz
model is unchanged; `scripts/verify-authz.sh` still applies.

---

## Setup (one time, ~10 minutes)

### 1. Install hermes‑agent on the host

```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
source ~/.bashrc   # or ~/.zshrc
```

### 2. Connect Codex GPT‑5.5 (ChatGPT OAuth)

```bash
hermes model        # choose "OpenAI Codex" → device-code OAuth in browser
```

Notes:
- Requires a ChatGPT plan that includes Codex.
- Hermes stores tokens in `~/.hermes/auth.json` and refreshes them
  automatically. If you already use the Codex CLI, hermes can import
  `~/.codex/auth.json`. Re‑auth anytime with `hermes auth add codex-oauth`.
- Pick a GPT‑5.5 Codex model when prompted (≥64K context required).

### 3. Make sure hermes' web tools work

Hermes' `web_search` / `web_extract` need a backend. Easiest checks:

```bash
hermes doctor       # shows what's configured
hermes              # ask it: "search the web for today's top HN story"
```

If web search isn't configured, either use the Nous Portal Tool Gateway
(`hermes setup --portal`) or set a scraping key (e.g. `hermes config set
FIRECRAWL_API_KEY fc-...`). Any backend works — BigSet only sees the
final JSON.

### 4. Enable the hermes API server

Add to `~/.hermes/.env`:

```bash
API_SERVER_ENABLED=true
API_SERVER_KEY=pick-a-strong-local-secret
# API_SERVER_PORT=8642   (default)
```

Then start the gateway and leave it running:

```bash
hermes gateway
# → [API Server] API server listening on http://127.0.0.1:8642
```

Sanity check:

```bash
curl http://127.0.0.1:8642/v1/models -H "Authorization: Bearer pick-a-strong-local-secret"
```

### 5. Point BigSet at it

Add to BigSet's root `.env`:

```bash
LLM_PROVIDER_MODE=hermes
HERMES_API_KEY=pick-a-strong-local-secret
# Defaults (override only if needed):
# HERMES_BASE_URL=http://host.docker.internal:8642/v1   ← Docker dev (make dev)
# HERMES_BASE_URL=http://127.0.0.1:8642/v1              ← backend run outside Docker
# HERMES_MODEL=hermes-agent
# HERMES_RESEARCH_TIMEOUT_MS=480000
# HERMES_CHAT_TIMEOUT_MS=180000
# HERMES_MAX_CONCURRENT=2
```

```bash
make dev
```

The setup screen shows both services green as soon as the hermes endpoint
is reachable — no TinyFish or OpenRouter keys are requested.

---

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `LLM_PROVIDER_MODE` | `openrouter` | `hermes` switches every LLM + web call to the hermes endpoint |
| `HERMES_BASE_URL` | `http://host.docker.internal:8642/v1` | hermes API server base. Inside Docker, `127.0.0.1` is the container — use `host.docker.internal` |
| `HERMES_API_KEY` | *(required in hermes mode)* | Must equal `API_SERVER_KEY` in `~/.hermes/.env` |
| `HERMES_MODEL` | `hermes-agent` | Cosmetic — hermes uses its own configured provider/model |
| `HERMES_RESEARCH_TIMEOUT_MS` | `480000` | Per‑call cap for agentic research (discovery / investigate / refresh) |
| `HERMES_CHAT_TIMEOUT_MS` | `180000` | Per‑call cap for non‑web calls (schema inference) |
| `HERMES_MAX_CONCURRENT` | `2` | Parallel per‑entity research calls during populate |

## Switching back

Remove `LLM_PROVIDER_MODE=hermes` (or set `openrouter`) and restart. The
original OpenRouter + TinyFish code paths are untouched.

## What to expect / current limitations

- **Speed:** each hermes research call is a full agent run (search → fetch
  → reason), typically slower per row than the TinyFish pipeline but with
  deeper verification. Dataset builds are minutes, not seconds.
- **Tokens/metrics:** the runs dashboard records hermes' reported token
  usage; `search_calls` / `fetch_calls` stay 0 because hermes executes
  those internally.
- **Model picker:** the settings → models page shows a single fixed entry
  in hermes mode (model choice happens inside hermes via `hermes model`).
- **One gateway, many runs:** all calls share your single hermes instance
  and its provider rate limits. Raise `HERMES_MAX_CONCURRENT` cautiously.

## Touched files (for reviewers)

| File | Change |
|---|---|
| `backend/src/env.ts` | `LLM_PROVIDER_MODE`, `HERMES_*` vars |
| `backend/src/hermes/client.ts` | hermes HTTP client, JSON extraction, endpoint verification |
| `backend/src/hermes/research.ts` | discovery / investigate / refresh prompt + schema contracts |
| `backend/src/hermes/populate-run.ts` | deterministic populate orchestration (replaces agent loop in hermes mode) |
| `backend/src/pipeline/schema-inference.ts` | hermes branch for `inferSchema` |
| `backend/src/mastra/workflows/populate.ts` | skip classification; delegate agent step to `runHermesPopulate` |
| `backend/src/mastra/workflows/update.ts` | per‑row refresh via hermes; apply via closure‑scoped `update_row` |
| `backend/src/local-credentials.ts` | setup status = hermes endpoint health in hermes mode |
| `backend/src/config/models.ts` | static model catalog; slug validation no‑op in hermes mode |
| `docker-compose.dev.yml` | pass `HERMES_*` env into `backend` + `mastra` services |
