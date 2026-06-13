# BigSet — Agent Guidelines

## Architecture

- **Frontend** (`frontend/`): Next.js 16, React 19, Tailwind 4. UI and Convex client code live here; do not add backend API routes to the frontend.
- **Backend** (`backend/`): Fastify, TypeScript, ESM. Owns auth, provider routing, dataset workflows, row writes, and local setup checks.
- **Workflows** (`backend/src/mastra/`): Mastra workflow shells for populate/update. In Hermes mode they delegate model/web work to `backend/src/hermes/*` and keep writes inside BigSet.
- **Database**: self-hosted Convex in local Docker dev. Convex schema/functions live under `frontend/convex/` and must be deployed with `make convex-push` after edits.

## Provider modes

- `LLM_PROVIDER_MODE=openrouter` or unset: original OpenRouter + TinyFish path.
- `LLM_PROVIDER_MODE=hermes`: local-first path. BigSet calls a Hermes Agent API server; Hermes normally uses OpenAI Codex / ChatGPT OAuth for the model and Hermes web tools for research.

Hermes is an agent endpoint, not a raw tool-calling model. Do not route Mastra tool arrays directly into Hermes. In Hermes mode, prompts must request strict JSON; BigSet validates the JSON and applies writes itself.

## What not to do

- Do not add API routes to the frontend. All API logic belongs in the backend.
- Do not hardcode ports. Read from env vars (`PORT`, `CLIENT_ORIGIN`, `HERMES_BASE_URL`, etc.).
- Do not commit `.env` files or real secrets.
- Do not expose a Hermes API server publicly without TLS/auth/rate limits.
- Do not bypass `buildPopulateTools()` or Convex expected-dataset checks for row writes.
- Do not silently reintroduce OpenRouter/TinyFish calls into Hermes mode.

## Dev setup

`make dev` starts the supported local Docker stack: Postgres, Convex, Convex dashboard, backend, frontend, Mastra Studio, and local keychain bridge.

Useful commands:

```bash
make dev
make down
make clean
make convex-push
```

Run after backend changes:

```bash
cd backend && npm run build
```

Run after Convex changes:

```bash
make convex-push
```
