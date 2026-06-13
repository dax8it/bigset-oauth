<p align="center">
  <img src="assets/logo-dark.png" alt="BigSet" width="280" />
</p>

<p align="center">
  <strong>Build and refresh live-web datasets with local Hermes + Codex OAuth agents.</strong>
</p>

<p align="center">
  <a href="https://github.com/dax8it/bigset-oauth/stargazers"><img src="https://img.shields.io/github/stars/dax8it/bigset-oauth?style=flat" alt="GitHub Stars" /></a>
  <a href="https://github.com/dax8it/bigset-oauth/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License" /></a>
  <a href="https://github.com/dax8it/bigset-oauth/issues"><img src="https://img.shields.io/github/issues/dax8it/bigset-oauth" alt="Issues" /></a>
</p>

---

BigSet turns a plain-English request into a structured dataset. This fork keeps the original BigSet OpenRouter + TinyFish path, and adds a local-first Hermes mode where one [Hermes Agent](https://hermes-agent.nousresearch.com) instance replaces both external AI/search services.

Example prompt:

> 5 popular open-source database engines with license and first release year

BigSet infers a schema, researches public web sources, writes verified rows into Convex, and exports CSV/XLSX. Datasets can be refreshed on a schedule.

## Execution modes

| Mode | LLM provider | Web/search provider | Use when |
|---|---|---|---|
| `openrouter` | OpenRouter models | TinyFish search/fetch APIs | You want the original hosted/API-key flow. |
| `hermes` | Hermes Agent, normally configured with OpenAI Codex / ChatGPT OAuth | Hermes tools: `web_search`, `web_extract`, optional browser automation | You want local-first BigSet runs backed by your Codex-capable ChatGPT account. |

In `hermes` mode BigSet does not call OpenRouter, TinyFish, or OpenAI directly. BigSet calls a local OpenAI-compatible Hermes API server. Hermes owns the Codex OAuth token, model selection, and web tooling.

## Architecture in Hermes mode

```text
schema inference       -> Hermes /v1/chat/completions -> strict JSON schema
candidate discovery    -> Hermes agent + web_search -> strict JSON entity list
per-entity research    -> Hermes agent + web tools -> strict JSON row data
row writes             -> BigSet insert_row tool -> Convex
refresh runs           -> Hermes agent -> strict JSON update decision
```

Hermes is an agent endpoint, not a raw tool-calling model. It does not execute arbitrary Mastra client-side tool arrays. BigSet therefore runs deterministic TypeScript orchestration around Hermes calls:

- Hermes returns data only.
- BigSet validates JSON with Zod.
- BigSet performs all inserts/updates itself.
- The existing closure-scoped `buildPopulateTools()` authorization model remains intact.

## Quick start: Hermes + Codex OAuth local mode

Prerequisites:

- Node.js 22+ with npm
- Docker Desktop or compatible Docker engine
- Make
- Hermes Agent installed on the host
- A ChatGPT/Codex account that exposes the Codex model you want to use

### 1. Configure Hermes Agent

Install Hermes if needed:

```bash
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
```

Add Codex OAuth credentials and pick the model:

```bash
hermes auth add openai-codex --type oauth
hermes model
```

Choose the `openai-codex` provider and a Codex-visible model such as `gpt-5.5`.

Enable/check tools:

```bash
hermes tools
hermes doctor
```

At minimum, Hermes needs working `web_search` and `web_extract` tools for BigSet populate/refresh.

### 2. Enable the Hermes API server

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
# or foreground:
hermes gateway run
```

Verify from the host:

```bash
curl http://127.0.0.1:8642/v1/models \
  -H "Authorization: Bearer replace-this-local-secret"
```

### 3. Configure BigSet

```bash
cp .env.example .env
```

Set at least:

```bash
LLM_PROVIDER_MODE=hermes
HERMES_API_KEY=replace-this-local-secret
HERMES_BASE_URL=http://host.docker.internal:8642/v1
HERMES_MODEL=hermes-agent
```

`host.docker.internal` is required because the backend runs in Docker and must reach the host-side Hermes gateway. If you run the backend directly on the host, use `http://127.0.0.1:8642/v1`.

### 4. Start BigSet

```bash
make dev
```

When ready:

| Service | URL |
|---|---|
| BigSet app | http://localhost:3500 |
| Backend API | http://localhost:3501 |
| Mastra Studio | http://localhost:4111 |
| Convex dashboard | http://localhost:6791 |

Open http://localhost:3500. In Hermes mode the setup screen checks the Hermes endpoint instead of asking for TinyFish/OpenRouter keys.

### 5. Smoke test

Create a small bounded dataset first:

```text
5 popular open-source database engines with license and first release year
```

Expected behavior:

- schema inference returns a compact schema;
- populate target resolves to 5 rows;
- discovery uses a bounded candidate batch;
- rows appear live in the table;
- CSV/XLSX export works.

## Original OpenRouter + TinyFish mode

Leave `LLM_PROVIDER_MODE` unset or set it to `openrouter`, then provide TinyFish and OpenRouter credentials through setup or `.env`.

```bash
LLM_PROVIDER_MODE=openrouter
TINYFISH_API_KEY=...
OPENROUTER_API_KEY=...
```

## Key environment variables

| Variable | Default | Meaning |
|---|---:|---|
| `LLM_PROVIDER_MODE` | `openrouter` | Set to `hermes` to route LLM + web research through Hermes Agent. |
| `HERMES_BASE_URL` | `http://host.docker.internal:8642/v1` | Hermes API server base URL from Docker. |
| `HERMES_API_KEY` | empty | Must match Hermes `API_SERVER_KEY` in Hermes mode. |
| `HERMES_MODEL` | `hermes-agent` | Cosmetic model id sent to Hermes; Hermes config chooses the real provider/model. |
| `HERMES_CHAT_TIMEOUT_MS` | `180000` | Timeout for schema/non-web Hermes calls. |
| `HERMES_DISCOVERY_TIMEOUT_MS` | `120000` | Timeout for fast candidate-discovery calls. |
| `HERMES_RESEARCH_TIMEOUT_MS` | `480000` | Timeout for per-entity research and refresh calls. |
| `HERMES_MAX_ROWS` | `10` | Safety cap for local Hermes populate runs. Explicit leading prompt counts below this cap are respected. |
| `HERMES_MAX_CANDIDATES_PER_ROUND` | `8` | Safety cap for discovery candidates per round. |
| `HERMES_MAX_CONCURRENT` | `2` | Parallel per-entity Hermes research calls. Increase cautiously. |
| `CONVEX_SELF_HOSTED_ADMIN_KEY` | auto | Generated by `make dev` for local self-hosted Convex. |
| `LOCAL_KEYCHAIN_PORT`, `LOCAL_KEYCHAIN_TOKEN`, `BIGSET_LOCAL_WORKSPACE_ID` | auto | Generated by `make dev` for the local keychain bridge. |

## Development workflow

```bash
make dev          # start/recover local stack
make down         # stop containers, preserve data
make clean        # stop containers and delete local volumes
make convex-push  # deploy changed frontend/convex functions
```

`make dev` bootstraps the local stack: it creates `.env` if needed, installs frontend/backend dependencies, starts the local keychain bridge, starts Postgres + self-hosted Convex, validates/generates the Convex admin key, deploys Convex functions, starts frontend/backend/Mastra, and streams logs.

If you edit Convex functions under `frontend/convex/`, run `make convex-push`. Convex does not hot-reload those functions from the mounted source tree.

## Deployment notes

This repo is primarily wired for local Docker development. For a public/self-hosted deployment, deploy the same four layers explicitly:

1. Frontend: Next.js app from `frontend/`.
2. Backend: Fastify app from `backend/`.
3. Convex: self-hosted Convex plus deployed functions from `frontend/convex/`.
4. Hermes: a reachable Hermes Agent gateway if using `LLM_PROVIDER_MODE=hermes`.

Production-style environment:

```bash
PROD=1
CLIENT_ORIGIN=https://your-frontend.example
CONVEX_URL=https://your-convex.example
CONVEX_SELF_HOSTED_ADMIN_KEY=...
NEXT_PUBLIC_CONVEX_URL=https://your-convex.example
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
CLERK_JWT_ISSUER_DOMAIN=https://your-clerk-issuer.example

# Hermes mode only:
LLM_PROVIDER_MODE=hermes
HERMES_BASE_URL=https://your-hermes-gateway.example/v1
HERMES_API_KEY=...
```

Deploy Convex functions after changing schema/functions:

```bash
cd frontend
npx convex deploy --url "$CONVEX_URL" --admin-key "$CONVEX_SELF_HOSTED_ADMIN_KEY"
```

If the Hermes API server is reachable over a network, put TLS and authentication/rate limits in front of it. Never expose an unauthenticated Hermes gateway.

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 16, React 19, Tailwind 4 |
| Backend | Fastify, TypeScript, ESM |
| Workflow inspector | Mastra workflows + Mastra Studio |
| Database | Self-hosted Convex + Postgres |
| Hermes mode LLM/web | Hermes Agent API server + OpenAI Codex OAuth + Hermes web tools |
| Original mode LLM/web | OpenRouter + TinyFish APIs |
| Table view | TanStack Table + react-window virtualization |
| Exports | CSV + XLSX via SheetJS |
| Optional analytics/email | PostHog + Resend |

## Project structure

```text
bigset-oauth/
├── frontend/                 Next.js UI + Convex schema/functions
│   └── convex/               Convex schema, authz, rows, model config, seed data
├── backend/                  Fastify + Mastra + Hermes/OpenRouter adapters
│   ├── src/hermes/           Hermes HTTP client and JSON research orchestration
│   ├── src/pipeline/         Schema inference and dataset type contracts
│   ├── src/mastra/           Original workflows/agents/tools and Hermes branch points
│   ├── src/email/            Optional dataset-ready email
│   └── src/analytics/        Optional PostHog wrapper
├── scripts/                  Build/release and verification helpers
├── makefiles/                Local Docker workflow
├── HERMES_MODE.md            Operator guide for Hermes/Codex mode
├── IMPLEMENTATION_NOTES.md   Code-level notes on what was replaced
├── docker-compose.dev.yml    Local stack
└── .env.example              Public env template
```

## Verification checklist before publishing changes

```bash
cd backend && npm run build
cd ../frontend && npm run build
bash scripts/verify-authz.sh
```

Also run a small Hermes-mode populate test and verify rows appear in the UI.

## License

AGPL-3.0. See `LICENSE`.
