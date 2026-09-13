import assert from "node:assert/strict";
import test from "node:test";
import { apQueueStatus } from "../lib/ap-case-status.ts";

function bill({ resolution = null, beneficiaryResolution = null, recommendation = "REVIEW_AMOUNT_CHANGE" } = {}) {
  return {
    resolution: resolution ? { action: resolution } : null,
    beneficiaryResolution: beneficiaryResolution ? { action: beneficiaryResolution } : null,
    serverRecommendation: { recommendation },
  };
}

test("classifies actionable and ready bills", () => {
  assert.equal(apQueueStatus(bill()), "ATTENTION");
  assert.equal(apQueueStatus(bill({ recommendation: "READY_TO_VALIDATE" })), "READY");
});

test("puts externally blocked cases on hold", () => {
  for (const resolution of ["DISPUTED_BILL", "REQUESTED_INFORMATION", "REQUESTED_AMOUNT_EXPLANATION"]) {
    assert.equal(apQueueStatus(bill({ resolution })), "ON_HOLD");
  }
  for (const beneficiaryResolution of ["REQUESTED_BENEFICIARY_SETUP", "INCORRECT_VENDOR"]) {
    assert.equal(apQueueStatus(bill({ beneficiaryResolution })), "ON_HOLD");
  }
});

test("closes confirmed duplicates", () => {
  assert.equal(apQueueStatus(bill({ resolution: "CONFIRMED_DUPLICATE" })), "CLOSED");
});
