/**
 * hermes-mode research pipeline.
 *
 * In hermes mode the LLM-driven Mastra tool loop (orchestrator agent +
 * investigate subagents calling search_web / fetch_page / insert_row) is
 * replaced by deterministic TypeScript orchestration around the hermes
 * agent endpoint:
 *
 *   discoverEntities()   — one hermes call: "search the web, list entities"
 *   investigateEntity()  — one hermes call per entity: "research it,
 *                          return the row as strict JSON"
 *   refreshRow()         — one hermes call per existing row: "re-verify,
 *                          return changes as strict JSON"
 *
 * hermes does ALL web access with its own tools (web_search, web_extract,
 * browser); BigSet performs ALL dataset writes itself through the existing
 * closure-scoped tools from buildPopulateTools — so the authorization
 * model (dataset id captured in closure, PK dedup in Convex, uniform
 * row-not-found errors) is byte-for-byte the same as in openrouter mode.
 * The LLM never holds a write capability in this mode at all.
 */

import { z } from "zod";
import { env } from "../env.js";
import { hermesJsonChat, type HermesUsage } from "./client.js";
import type { PopulateColumn } from "../pipeline/populate.js";

/* ────────────────────────── shared prompt pieces ───────────────────── */

function columnsBlock(columns: PopulateColumn[]): string {
  return columns
    .map(
      (c) =>
        `- "${c.name}" (${c.type})${c.isPrimaryKey ? " [PRIMARY KEY]" : ""}${c.description ? `: ${c.description}` : ""}`,
    )
    .join("\n");
}

const JSON_ONLY = `Reply with ONLY the JSON — no prose before or after, no markdown fences.`;

const NO_FABRICATION = `Never fabricate values. Use "" (empty string) for any field you cannot verify from a real source.`;

/* ───────────────────────────── discovery ───────────────────────────── */

const discoveredEntitySchema = z.object({
  primary_keys: z.record(z.string(), z.string()),
  context: z.string().optional().default(""),
  urls: z.array(z.string()).optional().default([]),
});
export type DiscoveredEntity = z.infer<typeof discoveredEntitySchema>;

const discoverySchema = z.object({
  entities: z.array(discoveredEntitySchema),
});

export interface DiscoveryArgs {
  datasetName: string;
  description: string;
  columns: PopulateColumn[];
  count: number;
  /** Primary-key signatures already attempted — tell hermes to skip them. */
  exclude: string[];
  sourceHint?: string;
  abortSignal?: AbortSignal;
  sessionId?: string;
}

export interface DiscoveryResult {
  entities: DiscoveredEntity[];
  usage: HermesUsage;
}

export async function discoverEntities(args: DiscoveryArgs): Promise<DiscoveryResult> {
  const pkColumns = args.columns.filter((c) => c.isPrimaryKey);
  const pkNames = pkColumns.map((c) => c.name);

  const excludeBlock =
    args.exclude.length > 0
      ? `\nAlready collected or attempted — do NOT return these again:\n${args.exclude
          .slice(0, 200)
          .map((e) => `- ${e}`)
          .join("\n")}`
      : "";

  const sourceBlock = args.sourceHint
    ? `\nLikely authoritative source (start here — it may list many entities at once): ${args.sourceHint}`
    : "";

  const prompt = `You are doing breadth-first discovery for a dataset. Use your web tools (web_search, web_extract) to find REAL entities that belong in it. Do not invent entities.

Dataset: ${args.datasetName}
Description: ${args.description}

Columns:
${columnsBlock(args.columns)}

Primary key column(s): ${pkNames.map((n) => `"${n}"`).join(", ")}
${sourceBlock}${excludeBlock}

Find up to ${args.count} distinct entities. For each, return the primary key value(s) you verified, a one-line context of what you already learned, and any URLs that likely contain the rest of the row's data.

Output JSON of this exact shape:
{
  "entities": [
    {
      "primary_keys": { ${pkNames.map((n) => `"${n}": "value"`).join(", ")} },
      "context": "one line of partial data you found",
      "urls": ["https://..."]
    }
  ]
}
${JSON_ONLY}`;

  const { value, usage } = await hermesJsonChat(prompt, discoverySchema, {
    timeoutMs: env.HERMES_RESEARCH_TIMEOUT_MS,
    abortSignal: args.abortSignal,
    sessionId: args.sessionId,
  });
  return { entities: value.entities, usage };
}

/* ──────────────────────────── investigation ────────────────────────── */

const rowValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const investigationSchema = z.object({
  found: z.boolean(),
  data: z.record(z.string(), rowValueSchema).optional(),
  sources: z.array(z.string()).optional().default([]),
  row_summary: z.string().optional().default(""),
  how_found: z.string().optional().default(""),
  reason: z.string().optional().default(""),
});
export type Investigation = z.infer<typeof investigationSchema>;

export interface InvestigateArgs {
  entity: DiscoveredEntity;
  datasetName: string;
  description: string;
  columns: PopulateColumn[];
  abortSignal?: AbortSignal;
  sessionId?: string;
}

export interface InvestigateResult {
  investigation: Investigation;
  usage: HermesUsage;
}

export async function investigateEntity(args: InvestigateArgs): Promise<InvestigateResult> {
  const columnNames = args.columns.map((c) => c.name);
  const pkBlock = Object.entries(args.entity.primary_keys)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  const urlsBlock =
    args.entity.urls.length > 0
      ? `\nUseful URLs to start from:\n${args.entity.urls.map((u) => `- ${u}`).join("\n")}`
      : "";

  const prompt = `Research ONE entity for the dataset "${args.datasetName}" (${args.description}) and report the row data. Use your web tools (web_search, web_extract) to verify facts from real pages. Be efficient — a handful of lookups, not an exhaustive crawl.

Columns to fill:
${columnsBlock(args.columns)}

Entity (primary key values — copy them into the row data EXACTLY as given):
${pkBlock}

Context already found: ${args.entity.context || "(none)"}${urlsBlock}

RULES:
- ${NO_FABRICATION}
- Partial real data is better than nothing: if you verified the entity exists, set found=true and fill what you can.
- Set found=false ONLY if you cannot verify the entity exists at all.
- "sources" must list the actual URLs you used.
- "how_found" must be a short step-by-step guide (which URL to fetch, which field to read) so a future agent can refresh this row.

Output JSON of this exact shape:
{
  "found": true,
  "data": { ${columnNames.map((n) => `"${n}": "value"`).join(", ")} },
  "sources": ["https://..."],
  "row_summary": "one line about this entity",
  "how_found": "1. fetch <url> 2. read <field> ...",
  "reason": "one line on what you verified or why you failed"
}
${JSON_ONLY}`;

  const { value, usage } = await hermesJsonChat(prompt, investigationSchema, {
    timeoutMs: env.HERMES_RESEARCH_TIMEOUT_MS,
    abortSignal: args.abortSignal,
    sessionId: args.sessionId,
  });
  return { investigation: value, usage };
}

/* ─────────────────────────────── refresh ───────────────────────────── */

const refreshSchema = z.object({
  updated: z.boolean(),
  data: z.record(z.string(), rowValueSchema).optional(),
  sources: z.array(z.string()).optional(),
  row_summary: z.string().optional(),
  how_found: z.string().optional(),
  changes: z.string().optional().default(""),
});
export type RefreshOutcome = z.infer<typeof refreshSchema>;

export interface RefreshArgs {
  datasetName: string;
  columns: PopulateColumn[];
  row: {
    _id: string;
    data: Record<string, unknown>;
    sources?: string[];
    rowSummary?: string;
    howFound?: string;
  };
  abortSignal?: AbortSignal;
  sessionId?: string;
}

export interface RefreshResult {
  outcome: RefreshOutcome;
  usage: HermesUsage;
}

export async function refreshRow(args: RefreshArgs): Promise<RefreshResult> {
  const columnNames = args.columns.map((c) => c.name);
  const pkColumns = args.columns.filter((c) => c.isPrimaryKey);

  const pkBlock =
    pkColumns.length > 0
      ? pkColumns.map((c) => `- ${c.name}: ${args.row.data[c.name] ?? ""}`).join("\n")
      : "(no primary keys defined)";
  const existingBlock = Object.entries(args.row.data)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  const sourcesBlock =
    args.row.sources && args.row.sources.length > 0
      ? `\nSource URLs to re-check:\n${args.row.sources.map((s) => `- ${s}`).join("\n")}`
      : "\nNo source URLs recorded — search the web using the primary key values.";

  const prompt = `Re-verify ONE existing dataset row ("${args.datasetName}") and report whether the data changed. Use your web tools to fetch fresh data. Be efficient.

Columns:
${columnsBlock(args.columns)}

Primary keys:
${pkBlock}

Existing data:
${existingBlock}
${sourcesBlock}
${args.row.howFound ? `\nPreviously found via (reproduce these steps for fresh data): ${args.row.howFound}` : ""}

RULES:
- ${NO_FABRICATION} If you can't verify a field, keep its existing value.
- Set updated=true ONLY if values MEANINGFULLY changed (not formatting). Then include the FULL data object (every column), plus fresh sources / row_summary / how_found.
- If sources are dead (404/blocked), try ONE web search using the primary key values.
- If nothing changed, set updated=false and omit data.

Output JSON of this exact shape:
{
  "updated": false,
  "data": { ${columnNames.map((n) => `"${n}": "value"`).join(", ")} },
  "sources": ["https://..."],
  "row_summary": "one line",
  "how_found": "how you verified",
  "changes": "what changed, or 'no changes'"
}
${JSON_ONLY}`;

  const { value, usage } = await hermesJsonChat(prompt, refreshSchema, {
    timeoutMs: env.HERMES_RESEARCH_TIMEOUT_MS,
    abortSignal: args.abortSignal,
    sessionId: args.sessionId,
  });
  return { outcome: value, usage };
}

/* ───────────────────────────── utilities ───────────────────────────── */

/** Stable signature for a set of PK values, for dedup/exclusion lists. */
export function pkSignature(primaryKeys: Record<string, unknown>): string {
  return Object.keys(primaryKeys)
    .sort()
    .map((k) => `${k}=${String(primaryKeys[k]).trim().toLowerCase()}`)
    .join("|");
}

/** Tiny worker pool — same shape as update.ts's processWithConcurrency. */
export async function withConcurrency<T>(
  items: T[],
  handler: (item: T) => Promise<void>,
  max: number,
): Promise<void> {
  let idx = 0;
  const workers = Array.from({ length: Math.min(max, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await handler(items[i]);
    }
  });
  await Promise.allSettled(workers);
}
