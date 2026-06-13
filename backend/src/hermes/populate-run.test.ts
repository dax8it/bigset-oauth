import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeHermesPopulatePlan, requestedRowCount } from "./populate-plan.js";

describe("requestedRowCount", () => {
  it("reads row counts from natural dataset prompts, not only leading numbers", () => {
    assert.equal(
      requestedRowCount("Create a dataset of 25 US companies showing public buying intent."),
      25,
    );
    assert.equal(requestedRowCount("25 US companies showing public buying intent."), 25);
  });
});

describe("computeHermesPopulatePlan", () => {
  const base = {
    requestedMaxRowCount: 100,
    requestedCount: 25,
    envMaxRows: 25,
    batchMaxRows: 10,
    maxCandidatesPerRound: 15,
  };

  it("allows a 25-row run while keeping each discovery/investigation batch bounded to 10 rows", () => {
    assert.deepEqual(computeHermesPopulatePlan({ ...base, currentRowCount: 0 }), {
      maxRowCount: 25,
      remainingRows: 25,
      batchTargetRowCount: 10,
      batchRemainingRows: 10,
      discoveryCount: 15,
      investigationBudget: 15,
    });

    assert.deepEqual(computeHermesPopulatePlan({ ...base, currentRowCount: 10 }), {
      maxRowCount: 25,
      remainingRows: 15,
      batchTargetRowCount: 20,
      batchRemainingRows: 10,
      discoveryCount: 15,
      investigationBudget: 15,
    });

    assert.deepEqual(computeHermesPopulatePlan({ ...base, currentRowCount: 20 }), {
      maxRowCount: 25,
      remainingRows: 5,
      batchTargetRowCount: 25,
      batchRemainingRows: 5,
      discoveryCount: 10,
      investigationBudget: 8,
    });
  });
});
