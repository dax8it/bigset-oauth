const DEFAULT_BATCH_MAX_ROWS = 10;

export function requestedRowCount(text: string): number | null {
  const trimmed = text.trim();
  const patterns = [
    /^(\d{1,3})\b/,
    /\bdataset\s+(?:of|with|for)\s+(\d{1,3})\b/i,
    /\b(?:create|find|return|include|show|give me)\s+(?:only\s+)?(?:a\s+dataset\s+of\s+)?(\d{1,3})\s+(?:rows?|records?|companies|businesses|prospects|items|entities)\b/i,
    /\b(\d{1,3})\s+(?:rows?|records?|companies|businesses|prospects|items|entities)\b/i,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    const count = Number(match[1]);
    if (Number.isFinite(count) && count > 0 && count <= 100) return count;
  }
  return null;
}

export interface HermesPopulatePlanArgs {
  requestedMaxRowCount: number;
  requestedCount: number | null;
  envMaxRows: number;
  batchMaxRows: number;
  currentRowCount: number;
  maxCandidatesPerRound: number;
}

export interface HermesPopulatePlan {
  maxRowCount: number;
  remainingRows: number;
  batchTargetRowCount: number;
  batchRemainingRows: number;
  discoveryCount: number;
  investigationBudget: number;
}

export function computeHermesPopulatePlan(args: HermesPopulatePlanArgs): HermesPopulatePlan {
  const safeBatchMaxRows = Math.max(1, args.batchMaxRows || DEFAULT_BATCH_MAX_ROWS);
  const maxRowCount = Math.min(
    args.requestedMaxRowCount,
    args.requestedCount ?? args.requestedMaxRowCount,
    args.envMaxRows,
  );
  const remainingRows = Math.max(0, maxRowCount - args.currentRowCount);
  const batchRemainingRows = Math.min(remainingRows, safeBatchMaxRows);
  const batchTargetRowCount = args.currentRowCount + batchRemainingRows;
  return {
    maxRowCount,
    remainingRows,
    batchTargetRowCount,
    batchRemainingRows,
    discoveryCount:
      batchRemainingRows > 0
        ? Math.min(Math.ceil(batchRemainingRows * 1.5) + 2, args.maxCandidatesPerRound)
        : 0,
    investigationBudget: batchRemainingRows + Math.ceil(batchRemainingRows / 2),
  };
}
