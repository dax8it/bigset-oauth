# BigSet Backend

Fastify + Mastra backend for BigSet. It owns auth, dataset workflow execution, local setup checks, Hermes/OpenRouter provider routing, and Convex writes.

## Running from source

Preferred full-stack workflow from the repo root:

```bash
cp .env.example .env
make dev
```

`make dev` starts Postgres, self-hosted Convex, backend, frontend, Mastra Studio, and the local keychain bridge.

Backend-only development is possible after the root `.env` is configured:

```bash
cd backend
npm install
npm run dev
```

The backend listens on http://localhost:3501 by default.

## Provider modes

### Hermes mode

Set:

```bash
LLM_PROVIDER_MODE=hermes
HERMES_BASE_URL=http://host.docker.internal:8642/v1
HERMES_API_KEY=replace-this-local-secret
HERMES_MODEL=hermes-agent
```

Hermes mode sends schema inference, populate discovery/investigation, and refresh work to a local Hermes Agent API server. Hermes normally runs the `openai-codex` provider with ChatGPT/Codex OAuth and handles web access with its own tools.

The backend still performs all row writes itself through Convex. Hermes returns strict JSON only.

### Original OpenRouter + TinyFish mode

Set or leave as default:

```bash
LLM_PROVIDER_MODE=openrouter
OPENROUTER_API_KEY=...
TINYFISH_API_KEY=...
```

This preserves the original BigSet execution path.

## Key paths

| Path | Purpose |
|---|---|
| `src/index.ts` | Fastify server and route setup. |
| `src/env.ts` | Root `.env` loader and typed runtime config. |
| `src/clerk-auth.ts` | Clerk JWT verification for protected routes. |
| `src/convex.ts` | Convex HTTP client. |
| `src/pipeline/schema-inference.ts` | Dataset schema inference; branches to Hermes in Hermes mode. |
| `src/hermes/client.ts` | Hermes API client and strict JSON validation helper. |
| `src/hermes/research.ts` | Hermes prompts/contracts for discovery, investigation, refresh. |
| `src/hermes/populate-run.ts` | Deterministic Hermes populate orchestration. |
| `src/mastra/workflows/` | Mastra workflow shells for populate/update. |
| `src/mastra/tools/dataset-tools.ts` | Capability-scoped row insert/update tools. |
| `src/local-credentials.ts` | Local setup and provider health checks. |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start backend with hot reload. |
| `npm run build` | Compile TypeScript. |

Backend scripts load the repo-root `.env` through `../scripts/with-root-env.mjs`.

## Verification

From repo root:

```bash
cd backend && npm run build
bash ../scripts/verify-authz.sh
```

For Hermes mode, also verify the backend container can reach Hermes:

```bash
docker compose -f docker-compose.dev.yml exec backend sh -lc '
  curl -sS http://host.docker.internal:8642/v1/models \
    -H "Authorization: Bearer $HERMES_API_KEY"
'
```
