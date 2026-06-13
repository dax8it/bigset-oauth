# Hermes Mode: BigSet on Codex OAuth + Hermes Agent

Hermes mode is the local-first execution path in this repo. It replaces BigSet's original OpenRouter + TinyFish dependency pair with one local [Hermes Agent](https://hermes-agent.nousresearch.com) API server.

| Original path | Hermes mode |
|---|---|
| OpenRouter for schema inference, populate agents, and refresh agents | Hermes Agent using its configured provider, normally `openai-codex` with a ChatGPT/Codex OAuth token |
| TinyFish search/fetch APIs for web research | Hermes tools: `web_search`, `web_extract`, and optional browser automation |
| Mastra LLM tool loop executes search/fetch/insert tools | BigSet runs deterministic TypeScript orchestration; Hermes returns strict JSON; BigSet writes rows itself |

Hermes mode is gated by `LLM_PROVIDER_MODE=hermes`. Leave it unset or set `openrouter` to use the original path.

---

## Why this mode exists

The goal is to run BigSet without OpenRouter credits or TinyFish API keys while keeping the useful parts of BigSet:

- natural-language schema inference;
- autonomous live-web research;
- per-row source provenance;
- Convex storage and realtime UI updates;
- primary-key deduplication;
- scheduled refreshes;
- CSV/XLSX export;
- optional script-based HTML/PDF report export and SMTP delivery to yourself or a client.

Hermes Agent already has two things BigSet needs:

1. an OpenAI-compatible API server at `/v1/chat/completions`;
2. its own tool runtime for web search, extraction, and browser work.

When Hermes is configured with the `openai-codex` provider, the actual LLM behind BigSet is a Codex-visible model from the user's ChatGPT/Codex OAuth account. BigSet never stores or refreshes the ChatGPT OAuth token; Hermes owns that.

The preferred user-facing workflow is the Hermes skill named `bigset`: ask a short discovery set first, then produce the bounded source-verifiable prompt. This keeps BigSet runs from drifting into broad generic crawls and makes 10-row demos / 25-row production datasets more reliable.

---

## Runtime architecture

```text
Frontend
  └─ POST /infer-schema or /populate
      └─ Backend Fastify
          ├─ schema inference
          │   └─ Hermes API server -> strict JSON DatasetSchema
          ├─ populate workflow
          │   ├─ clear rows
          │   ├─ fast candidate discovery via Hermes -> JSON entity list
          │   ├─ per-entity investigation via Hermes -> JSON row data
          │   └─ BigSet insert_row -> Convex
          └─ refresh workflow
              ├─ per-row verification via Hermes -> JSON update decision
              └─ BigSet update_row -> Convex
```

### Important implementation detail

Hermes' OpenAI-compatible endpoint is an agent endpoint. It can call its own tools, but it does not execute arbitrary client-supplied Mastra tool arrays the way a raw tool-calling model would.

So Hermes mode does not try to run the original Mastra agent loop against Hermes. Instead:

- BigSet sends self-contained prompts to Hermes.
- Hermes returns strict JSON only.
- BigSet validates JSON with Zod.
- BigSet performs inserts/updates itself through the existing capability-scoped tools.

That keeps the authorization model intact: the LLM never receives a write capability, and all writes remain scoped by server-side closures and Convex checks.

---

## One-time host setup

### 1. Install Hermes Agent

```bash
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
```

Open a new shell or source your shell profile so `hermes` is on `PATH`.

### 2. Add OpenAI Codex OAuth credentials to Hermes

```bash
hermes auth add openai-codex --type oauth
hermes model
```

Choose:

- provider: `openai-codex`
- model: a Codex-visible model such as `gpt-5.5`

Hermes stores OAuth credentials in its own auth store, usually `~/.hermes/auth.json` or the active profile's `auth.json`. Do not copy those credentials into BigSet.

### 3. Enable Hermes web tools

```bash
hermes tools
hermes doctor
```

At minimum, Hermes should have `web_search` and `web_extract` available. Browser automation is optional but useful for JavaScript-heavy sites.

### 4. Enable the Hermes API server

Find the active Hermes env file:

```bash
hermes config env-path
# or for a named profile:
hermes -p <profile> config env-path
```

Add:

```bash
API_SERVER_ENABLED=true
API_SERVER_HOST=0.0.0.0
API_SERVER_PORT=8642
API_SERVER_KEY=replace-this-local-secret
```

Start or restart the gateway:

```bash
hermes gateway restart
# or:
hermes gateway run
```

Verify from the host:

```bash
curl http://127.0.0.1:8642/v1/models \
  -H "Authorization: Bearer replace-this-local-secret"
```

Expected: HTTP 200 and a model list response.

---

## BigSet setup

Create `.env` from the public example:

```bash
cp .env.example .env
```

Set these values:

```bash
LLM_PROVIDER_MODE=hermes
HERMES_API_KEY=replace-this-local-secret
HERMES_BASE_URL=http://host.docker.internal:8642/v1
HERMES_MODEL=hermes-agent
```

Why `host.docker.internal`? In the Docker dev stack, the backend container's `127.0.0.1` is the container itself. `host.docker.internal` reaches the host machine where Hermes is running.

Start BigSet:

```bash
make dev
```

Open http://localhost:3500.

---
## Agent-operated dataset delivery

A complete local production run can be operated from the CLI after a dataset is live:

```bash
node scripts/with-root-env.mjs node scripts/export-dataset-report.mjs \
  --dataset-id <dataset_id> \
  --title "Client-ready BigSet report"

EMAIL_TO=client@example.com \
EMAIL_ATTACHMENT=artifacts/dataset-reports/<dataset_id>/report.pdf \
python3 scripts/send-dataset-report.py
```

The report exporter reads the trusted local CLI endpoints, writes `dataset.json`, `report.html`, and optionally `report.pdf` through `wkhtmltopdf`. The SMTP sender uses environment variables only; do not commit mail credentials.

---


## Environment variables

| Variable | Default | Required? | Meaning |
|---|---:|---|---|
| `LLM_PROVIDER_MODE` | `openrouter` | yes for Hermes mode | Set to `hermes` to activate this path. |
| `HERMES_BASE_URL` | `http://host.docker.internal:8642/v1` | yes | Base URL of Hermes' OpenAI-compatible API server. |
| `HERMES_API_KEY` | empty | yes | Must equal Hermes `API_SERVER_KEY`. |
| `HERMES_MODEL` | `hermes-agent` | no | Cosmetic id sent in chat requests; Hermes chooses its real model internally. |
| `HERMES_CHAT_TIMEOUT_MS` | `180000` | no | Timeout for schema/non-web calls. |
| `HERMES_DISCOVERY_TIMEOUT_MS` | `120000` | no | Timeout for fast candidate discovery. |
| `HERMES_RESEARCH_TIMEOUT_MS` | `480000` | no | Timeout for per-entity research and refresh. |
| `HERMES_MAX_ROWS` | `25` | no | Overall local safety cap for populate runs. Prompt counts such as `25 companies` are respected up to this cap. |
| `HERMES_BATCH_MAX_ROWS` | `10` | no | Per-batch row target. Larger runs are split into bounded batches instead of one large agentic wave. |
| `HERMES_MAX_CANDIDATES_PER_ROUND` | `15` | no | Local safety cap for discovery candidates per bounded batch. |
| `HERMES_MAX_CONCURRENT` | `2` | no | Parallel per-entity research calls. |

Recommended local defaults:

```bash
HERMES_DISCOVERY_TIMEOUT_MS=120000
HERMES_CHAT_TIMEOUT_MS=180000
HERMES_RESEARCH_TIMEOUT_MS=480000
HERMES_MAX_ROWS=25
HERMES_BATCH_MAX_ROWS=10
HERMES_MAX_CANDIDATES_PER_ROUND=15
HERMES_MAX_CONCURRENT=2
```

These caps exist because a local agent call can be much slower than a direct API call. A prompt like `5 popular databases...` should build 5 rows, not fan out to a default 100-row crawl.

---

## What changed in code

| File | Change |
|---|---|
| `backend/src/env.ts` | Adds `IS_HERMES_MODE` and `HERMES_*` config. |
| `backend/src/hermes/client.ts` | Minimal Hermes HTTP client, JSON extraction, Zod validation/retry, endpoint verification. |
| `backend/src/hermes/research.ts` | Strict-JSON prompts for discovery, investigation, and refresh. |
| `backend/src/hermes/populate-run.ts` | Deterministic populate orchestration around Hermes calls; respects explicit row counts and local caps. |
| `backend/src/pipeline/schema-inference.ts` | Branches schema inference to Hermes in Hermes mode. |
| `backend/src/mastra/workflows/populate.ts` | Keeps Mastra workflow shell but delegates the agent step to `runHermesPopulate()` in Hermes mode. |
| `backend/src/mastra/workflows/update.ts` | Refreshes rows through Hermes and applies updates with closure-scoped `update_row`. |
| `backend/src/local-credentials.ts` | Setup status verifies Hermes endpoint instead of asking for TinyFish/OpenRouter keys. |
| `backend/src/config/models.ts` | Returns a static Hermes model entry and ignores stored OpenRouter per-user model config in Hermes mode. |
| `docker-compose.dev.yml` | Passes Hermes env vars to backend and Mastra containers. |

See `IMPLEMENTATION_NOTES.md` for more detail.

---

## Smoke tests

### API server health

From the host:

```bash
curl http://127.0.0.1:8642/v1/models \
  -H "Authorization: Bearer replace-this-local-secret"
```

From inside the backend container:

```bash
docker compose -f docker-compose.dev.yml exec backend sh -lc '
  curl -sS http://host.docker.internal:8642/v1/models \
    -H "Authorization: Bearer $HERMES_API_KEY"
'
```

### Dataset populate

Use a small bounded prompt first:

```text
5 popular open-source database engines with license and first release year
```

Backend logs should show something like:

```text
[hermes-populate] ... target=5 ... round=1 rows=0/5 discovering=8
```

The table should receive five rows.

### Build checks

```bash
cd backend && npm run build
cd ../frontend && npm run build
bash scripts/verify-authz.sh
```

---

## Troubleshooting

### Setup screen is not green

Check that BigSet can reach Hermes from the container:

```bash
docker compose -f docker-compose.dev.yml exec backend sh -lc '
  node --input-type=module - <<"JS"
  console.log(process.env.LLM_PROVIDER_MODE)
  console.log(process.env.HERMES_BASE_URL)
  console.log(Boolean(process.env.HERMES_API_KEY))
  JS
'
```

Then verify `/v1/models` with the bearer key.

### `fetch failed` during populate

This usually means the backend's HTTP request to Hermes timed out or the Hermes process was stuck in a slow tool/model call. Check both sides:

```bash
docker compose -f docker-compose.dev.yml logs --since=20m backend
# Hermes profile logs, path varies by profile:
# ~/.hermes/logs/gateway.error.log
# ~/.hermes/profiles/<profile>/logs/gateway.error.log
```

Common causes:

- `HERMES_API_KEY` does not match `API_SERVER_KEY`;
- backend uses `127.0.0.1` instead of `host.docker.internal` inside Docker;
- Hermes gateway was restarted while a run was in flight;
- discovery got pinned to a dead/blocked source URL;
- web extraction backend is timing out.

The current implementation avoids pinning schema-inferred source hints during Hermes discovery and caps discovery so one bad URL should not stall the full run.

### Hermes returns prose instead of JSON

`hermesJsonChat()` extracts the first JSON object/array and retries once with validation details. If this still fails, inspect the corresponding prompt in `backend/src/hermes/research.ts` or `backend/src/pipeline/schema-inference.ts` and tighten the output contract.

### Want original behavior back

Set:

```bash
LLM_PROVIDER_MODE=openrouter
```

Then provide TinyFish/OpenRouter credentials through setup or `.env` and restart.

---

## Production warning

Do not expose Hermes API server unauthenticated. If Hermes is reachable over a network:

- require TLS;
- keep `API_SERVER_KEY` secret;
- restrict ingress by IP/VPN if possible;
- set conservative timeouts/concurrency;
- monitor gateway logs and provider quotas.
