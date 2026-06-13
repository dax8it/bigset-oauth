# Codex / Agent Maintenance Prompt

This is a public, repo-safe prompt for asking a coding agent to inspect or extend BigSet's Hermes mode. It reflects the implemented architecture, not the older migration plan.

```text
You are working in the BigSet repository.

Goal: maintain the implemented Hermes mode without regressing the original OpenRouter + TinyFish path.

Current architecture:

- `LLM_PROVIDER_MODE=openrouter` (default/original): OpenRouter for LLM calls and TinyFish for search/fetch.
- `LLM_PROVIDER_MODE=hermes`: BigSet calls a local Hermes Agent API server at `HERMES_BASE_URL`; Hermes is normally configured with OpenAI Codex / ChatGPT OAuth and uses its own web tools.

Hard constraints:

1. Do not commit secrets, `.env`, OAuth tokens, or machine-local paths.
2. Keep all Hermes behavior behind `LLM_PROVIDER_MODE=hermes`.
3. Do not remove or silently break the OpenRouter + TinyFish path.
4. Do not pass BigSet row-write tools to Hermes. Hermes returns strict JSON; BigSet writes rows itself.
5. Preserve the authorization model in `buildPopulateTools()` and Convex expected-dataset checks.
6. Keep Hermes populate bounded: row caps, candidate caps, discovery timeout, research timeout, and modest concurrency.
7. If editing Convex functions under `frontend/convex/`, run or document `make convex-push`.

Read first:

- `README.md`
- `HERMES_MODE.md`
- `IMPLEMENTATION_NOTES.md`
- `backend/src/env.ts`
- `backend/src/hermes/client.ts`
- `backend/src/hermes/research.ts`
- `backend/src/hermes/populate-run.ts`
- `backend/src/pipeline/schema-inference.ts`
- `backend/src/mastra/workflows/populate.ts`
- `backend/src/mastra/workflows/update.ts`
- `backend/src/local-credentials.ts`
- `backend/src/config/models.ts`
- `docker-compose.dev.yml`

Verification:

- `cd backend && npm run build`
- `cd frontend && npm run build`
- `bash scripts/verify-authz.sh`
- In Hermes mode, run a small bounded dataset like: `5 popular open-source database engines with license and first release year`

Troubleshooting focus:

- `fetch failed` usually means Hermes reachability/auth/timeout, wrong Docker host URL, gateway restart, or web extraction timeout.
- A stale UI failure banner can remain after a successful row insert; verify backend logs and actual row count before assuming the current run failed.
```
