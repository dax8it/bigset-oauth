/**
 * hermes-mode populate run.
 *
 * Drop-in replacement for the Mastra orchestrator/subagent loop used by
 * the populate workflow's agent step. The control flow that the populate
 * agent's LLM used to improvise (discover → fan out subagents → insert →
 * repeat until maxRowCount) is implemented here as plain TypeScript, with
 * hermes-agent doing the actual web research per call.
 *
 * Security: rows are inserted through the SAME buildPopulateTools()
 * closure-scoped insert_row as openrouter mode — dataset id captured in
 * closure, PK dedup enforced by Convex, quota errors honored. hermes only
 * ever returns data; it never holds a write capability.
 */

import { convex, internal } from "../convex.js";
import { env } from "../env.js";
import { getSignal } from "../abort-registry.js";
import { buildPopulateTools } from "../mastra/tools/dataset-tools.js";
import type { AuthContext } from "../mastra/workflows/populate.js";
import type { PopulateColumn } from "../pipeline/populate.js";
import type { RunMetrics } from "../mastra/run-metrics.js";
import {
  discoverEntities,
  investigateEntity,
  pkSignature,
  withConcurrency,
  type DiscoveredEntity,
} from "./research.js";

import {
  computeHermesPopulatePlan,
  requestedRowCount,
} from "./populate-plan.js";

const MAX_DISCOVERY_ROUNDS = 5;

export interface HermesPopulateArgs {
  authorizedDatasetId: string;
  authContext: AuthContext;
  datasetName: string;
  description: string;
  columns: PopulateColumn[];
  maxRowCount: number;
  sourceHint?: string;
  metrics: RunMetrics;
}

interface InsertOutcome {
  success: boolean;
  error?: string;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const err = new Error("Stopped by user");
    err.name = "AbortError";
    throw err;
  }
}

export async function runHermesPopulate(args: HermesPopulateArgs): Promise<string> {
  const {
    authorizedDatasetId,
    authContext,
    datasetName,
    description,
    columns,
    sourceHint,
    metrics,
  } = args;

  const requestedCount = requestedRowCount(description);
  const initialPlan = computeHermesPopulatePlan({
    requestedMaxRowCount: args.maxRowCount,
    requestedCount,
    envMaxRows: env.HERMES_MAX_ROWS,
    batchMaxRows: env.HERMES_BATCH_MAX_ROWS,
    currentRowCount: 0,
    maxCandidatesPerRound: env.HERMES_MAX_CANDIDATES_PER_ROUND,
  });
  const maxRowCount = initialPlan.maxRowCount;

  const tools = buildPopulateTools(authorizedDatasetId, authContext);
  const signal = getSignal(authorizedDatasetId);
  const sessionId = `bigset-populate-${authContext.workflowRunId}`;
  const logCtx = `user=${authContext.authorizedUserId} run=${authContext.workflowRunId} dataset=${authorizedDatasetId}`;

  const attempted = new Set<string>();
  let inserted = 0;
  let duplicates = 0;
  let failures = 0;
  let quotaHit = false;

  const currentRowCount = async (): Promise<number> =>
    await convex.query(internal.datasetRows.countByDataset, {
      datasetId: authorizedDatasetId,
    });

  console.log(
    `[hermes-populate] ${logCtx} target=${maxRowCount} cols=${columns.length} source=${sourceHint ?? "(none)"}`,
  );

  for (let round = 0; round < MAX_DISCOVERY_ROUNDS; round++) {
    throwIfAborted(signal);

    const rowCount = await currentRowCount();
    const plan = computeHermesPopulatePlan({
      requestedMaxRowCount: args.maxRowCount,
      requestedCount,
      envMaxRows: env.HERMES_MAX_ROWS,
      batchMaxRows: env.HERMES_BATCH_MAX_ROWS,
      currentRowCount: rowCount,
      maxCandidatesPerRound: env.HERMES_MAX_CANDIDATES_PER_ROUND,
    });
    if (plan.remainingRows <= 0 || quotaHit) break;

    const want = plan.discoveryCount;
    console.log(
      `[hermes-populate] ${logCtx} round=${round + 1} rows=${rowCount}/${maxRowCount} batchTarget=${plan.batchTargetRowCount} discovering=${want}`,
    );

    let candidates: DiscoveredEntity[];
    try {
      const discovery = await discoverEntities({
        datasetName,
        description,
        columns,
        count: want,
        exclude: [...attempted],
        sourceHint,
        abortSignal: signal,
        sessionId,
      });
      // Discovery plays the orchestrator role for token accounting.
      metrics.addOrchestratorResult({ usage: discovery.usage, steps: [] });
      candidates = discovery.entities;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError" && signal?.aborted) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[hermes-populate] ${logCtx} discovery failed round=${round + 1}: ${msg}`);
      // One failed discovery round isn't fatal — try again next round,
      // unless it's the first round (then there's nothing to work with).
      if (round === 0) throw err;
      continue;
    }

    const fresh = candidates.filter((c) => {
      const sig = pkSignature(c.primary_keys);
      if (!sig || attempted.has(sig)) return false;
      attempted.add(sig);
      return true;
    });

    if (fresh.length === 0) {
      console.log(`[hermes-populate] ${logCtx} round=${round + 1} no new candidates — stopping`);
      break;
    }

    // Budget: never dispatch more investigations than this bounded batch
    // needs, with a small overshoot to absorb not-found / duplicate outcomes.
    let budget = plan.investigationBudget;

    await withConcurrency(
      fresh,
      async (entity) => {
        if (quotaHit || budget <= 0) return;
        throwIfAborted(signal);
        if ((await currentRowCount()) >= plan.batchTargetRowCount) return;
        budget--;

        metrics.investigateCalls++;
        const entityLabel = JSON.stringify(entity.primary_keys);
        try {
          const { investigation, usage } = await investigateEntity({
            entity,
            datasetName,
            description,
            columns,
            abortSignal: signal,
            sessionId,
          });
          metrics.addInvestigateResult({ usage, steps: [] });

          if (!investigation.found || !investigation.data) {
            console.log(
              `[hermes-populate] ${logCtx} entity=${entityLabel} not found: ${investigation.reason}`,
            );
            return;
          }

          // Primary-key values are authoritative from discovery — make sure
          // they're present in the row even if the research reply drifted.
          const data: Record<string, unknown> = { ...investigation.data };
          for (const [pk, value] of Object.entries(entity.primary_keys)) {
            const existing = data[pk];
            if (existing === undefined || existing === null || existing === "") {
              data[pk] = value;
            }
          }

          if ((await currentRowCount()) >= plan.batchTargetRowCount) return;

          // Calling the tool's execute directly (outside an agent run):
          // first arg mirrors the tool's input schema, second is an empty
          // ToolExecutionContext (all of its fields are optional).
          const result = (await tools.insert_row.execute?.(
            {
              data,
              sources: investigation.sources,
              row_summary: investigation.row_summary || undefined,
              how_found: investigation.how_found || undefined,
            } as never,
            {} as never,
          )) as InsertOutcome | undefined;

          if (!result) {
            failures++;
            console.error(`[hermes-populate] ${logCtx} entity=${entityLabel} insert returned nothing`);
            return;
          }
          if (result.success) {
            inserted++;
            metrics.rowsInserted++;
            console.log(
              `[hermes-populate] ${logCtx} inserted entity=${entityLabel}${investigation.row_summary ? ` — ${investigation.row_summary}` : ""}`,
            );
            return;
          }
          if (result.error && /duplicate/i.test(result.error)) {
            duplicates++;
            console.log(`[hermes-populate] ${logCtx} duplicate entity=${entityLabel}`);
            return;
          }
          if (result.error && /quota/i.test(result.error)) {
            quotaHit = true;
            console.warn(`[hermes-populate] ${logCtx} quota hit — stopping inserts`);
            return;
          }
          failures++;
          console.error(
            `[hermes-populate] ${logCtx} insert failed entity=${entityLabel}: ${result.error}`,
          );
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError" && signal?.aborted) throw err;
          failures++;
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[hermes-populate] ${logCtx} entity=${entityLabel} failed: ${msg}`);
        }
      },
      env.HERMES_MAX_CONCURRENT,
    );

    throwIfAborted(signal);
  }

  const finalCount = await currentRowCount();
  const summary =
    `hermes populate finished: ${finalCount}/${maxRowCount} rows ` +
    `(+${inserted} this run, ${duplicates} duplicates skipped, ${failures} failures` +
    `${quotaHit ? ", stopped at quota" : ""}).`;
  console.log(`[hermes-populate] ${logCtx} ${summary}`);
  return summary;
}
