# BigSet + Hermes Agent Explainer Video Script

Target: 16:9 public explainer, about 80-90 seconds.

## Voiceover

BigSet is a way to turn a plain-English data request into a live, refreshable dataset.

You describe what you want: leads, RFPs, job signals, competitors, products, events, or market research. BigSet infers the schema, researches public sources, writes rows into Convex, and gives you a working table you can refresh and export.

In this repo, we are running BigSet with Hermes Agent instead of the old model-and-search provider chain.

BigSet calls one local Hermes Agent API server. Hermes owns the Codex OAuth session, chooses the Codex-visible model, and uses its own web tools for search and extraction.

The security boundary is important: Hermes researches and returns strict JSON. BigSet validates that JSON with Zod and performs the database writes itself. The model never gets raw write access.

The workflow is now skill-driven. When someone asks for a dataset, the BigSet skill asks a short discovery set: business goal, row type, scope, public evidence signal, and delivery target.

That becomes a bounded prompt: ten rows for a demo, twenty-five for production, every row source-backed, no private contact scraping, and practical fields like why this lead matters, priority score, and first outreach note.

We proved the full loop on an AI services outreach dataset: prompt to schema, live-web research, twenty-five rows, source URLs, a BigSet link, a PDF report, and an email sent to ourselves.

The same delivery flow can send a dataset report to a client. Export CSV or Excel from the UI, or use the included scripts to render HTML/PDF and send the PDF through your own SMTP credentials.

Setup is reproducible: install Hermes, add openai-codex OAuth, enable the Hermes API server, set LLM_PROVIDER_MODE to hermes, point BigSet at host dot docker dot internal, then run make dev.

Hermes handles intelligence and web research. BigSet owns state, auth, rows, refresh, export, and delivery.

This repo is public-consumption ready: documented local setup, environment templates, bounded agent defaults, report scripts, and the explainer assets you are watching now.

## On-screen beats

1. What BigSet is: plain English → live dataset.
2. Target row examples: leads, RFPs, jobs, competitors, products, events.
3. Hermes mode architecture: BigSet → Hermes Agent → Codex OAuth + web tools.
4. Security boundary: strict JSON only; BigSet validates and writes.
5. BigSet skill workflow: goal, row type, scope, evidence, delivery.
6. Production discipline: 10 demo / 25 production, source URLs, no private scraping.
7. Proof loop: AI services outreach → 25 rows → PDF → email.
8. Delivery options: UI export, report HTML/PDF, SMTP to yourself/client.
9. Setup commands: Hermes OAuth/API server, LLM_PROVIDER_MODE=hermes, make dev.
10. Closing: Hermes handles intelligence; BigSet owns state and delivery.
