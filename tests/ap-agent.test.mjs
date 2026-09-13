import assert from "node:assert/strict";
import test from "node:test";
import {
  buildApAssistantFallback,
  buildApFallback,
  decideApBill,
  expectedRecommendation,
  fundingStatusForModel,
} from "../lib/ap-agent.ts";

const readyFacts = {
  billId: "8a02ca96-e3ac-4210-a835-324160ad7b01",
  vendor: "AU Payroll Bureau",
  invoiceNumber: "PAY-0901",
  description: "Monthly payroll processing",
  amount: 100,
  currency: "AUD",
  dueDate: "2026-09-21",
  duplicateBillIds: [],
  duplicateMatchReasons: [],
  previousAmounts: [100, 100],
  averagePreviousAmount: 100,
  amountChangePercent: 0,
  beneficiaryId: "ebbb816f-b752-4ce0-a0dd-32f30a5afc18",
  beneficiaryName: "AU Payroll Bureau",
  transferRouteAvailable: true,
  transferMethod: "LOCAL",
  transferReason: null,
  payoutCurrency: "AUD",
  sourceCurrency: "USD",
  availableSourceBalance: 11199390,
  requiredSourceAmount: 72.37,
  fxRate: 0.723739,
  fxQuotedAt: "2026-09-12T06:02:05+0000",
  hasSufficientBalance: true,
};

test("allows only a clean bill to reach payout validation", () => {
  const recommendation = buildApFallback(readyFacts);
  assert.equal(recommendation.recommendation, "READY_TO_VALIDATE");
  assert.equal(recommendation.requiresHuman, false);
});

test("the decision comes from verified facts alone", () => {
  assert.deepEqual(decideApBill(readyFacts), {
    recommendation: "READY_TO_VALIDATE",
    priority: "LOW",
    requiresHuman: false,
  });
  assert.deepEqual(decideApBill({ ...readyFacts, duplicateBillIds: ["x"] }), {
    recommendation: "REVIEW_DUPLICATE",
    priority: "HIGH",
    requiresHuman: true,
  });
});

test("duplicate evidence takes precedence over other exceptions", () => {
  const facts = {
    ...readyFacts,
    duplicateBillIds: ["34b0345d-ae4d-45b8-a19c-171c9be2e633"],
    amountChangePercent: 38,
  };
  assert.equal(expectedRecommendation(facts), "REVIEW_DUPLICATE");
  assert.equal(buildApFallback(facts).requiresHuman, true);
});

test("a 38 percent increase requires review", () => {
  const facts = { ...readyFacts, amount: 138, amountChangePercent: 38 };
  const recommendation = buildApFallback(facts);
  assert.equal(recommendation.recommendation, "REVIEW_AMOUNT_CHANGE");
  assert.match(recommendation.summary, /amount increase/i);
});

test("a model cannot express a recommendation at all", async () => {
  // Structural, not a check after the fact: the schema the model answers with has no
  // recommendation, priority or requiresHuman field to put a decision in.
  const { apExplanationSchema } = await import("../lib/ap-agent.ts");
  const fields = Object.keys(apExplanationSchema.shape);
  assert.deepEqual(fields.filter((f) => ["recommendation", "priority", "requiresHuman"].includes(f)), []);
  assert.ok(fields.includes("summary") && fields.includes("reasons"));
});

test("bill assistant refuses to approve or pay", () => {
  const facts = { ...readyFacts, amount: 138, amountChangePercent: 38 };
  const answer = buildApAssistantFallback(facts, "Approve this and pay it now");
  assert.equal(answer.recommendation, "REVIEW_AMOUNT_CHANGE");
  assert.equal(answer.requiresHuman, true);
  assert.match(answer.answer, /cannot approve, pay/i);
});

test("bill assistant explains why a bill cannot be paid", () => {
  const facts = {
    ...readyFacts,
    beneficiaryId: null,
    beneficiaryName: null,
    transferRouteAvailable: false,
    transferMethod: null,
    transferReason: null,
    sourceCurrency: null,
    availableSourceBalance: 0,
    hasSufficientBalance: false,
  };
  const answer = buildApAssistantFallback(facts, "Why can't this bill be paid?");
  assert.equal(answer.recommendation, "MISSING_BENEFICIARY");
  assert.match(answer.answer, /approved Airwallex beneficiary/i);
  assert.doesNotMatch(answer.answer, /I cannot approve, pay/i);
});

test("model context distinguishes an unchecked wallet from insufficient funds", () => {
  const missingRoute = {
    ...readyFacts,
    beneficiaryId: null,
    beneficiaryName: null,
    transferRouteAvailable: false,
    transferMethod: null,
    transferReason: null,
    sourceCurrency: null,
    availableSourceBalance: 0,
    hasSufficientBalance: false,
  };
  assert.equal(fundingStatusForModel(missingRoute), "NOT_CHECKED");
  assert.equal(fundingStatusForModel({ ...readyFacts, hasSufficientBalance: false }), "INSUFFICIENT");
});

test("bill assistant labels added context as unverified", () => {
  const facts = { ...readyFacts, amount: 138, amountChangePercent: 38 };
  const answer = buildApAssistantFallback(facts, "The submitter says usage increased after launch");
  assert.equal(answer.grounding, "UNVERIFIED_CONTEXT_CONSIDERED");
  assert.match(answer.answer, /unverified/i);
});



test("funding is compared in the wallet currency, not across currencies", () => {
  // The AUD wallet is empty, so an AUD payout funds from USD via FX. The old code
  // compared an AUD bill amount straight against a foreign balance.
  const recommendation = buildApFallback(readyFacts);
  assert.equal(recommendation.recommendation, "READY_TO_VALIDATE");
  assert.match(recommendation.reasons.join(" "), /Funded from USD \(72\.37 USD at 0\.723739\)/);
});

test("no wallet able to cover the converted amount blocks the payout", () => {
  const facts = {
    ...readyFacts,
    sourceCurrency: "USD",
    availableSourceBalance: 10,
    requiredSourceAmount: 72.37,
    hasSufficientBalance: false,
  };
  const recommendation = buildApFallback(facts);
  assert.equal(recommendation.recommendation, "INSUFFICIENT_FUNDS");
  assert.match(recommendation.reasons.join(" "), /72\.37 USD/);
});

test("a beneficiary paid in another currency is its own exception", () => {
  const facts = { ...readyFacts, currency: "USD", payoutCurrency: "AUD" };
  assert.equal(expectedRecommendation(facts), "BENEFICIARY_CURRENCY_MISMATCH");
  const recommendation = buildApFallback(facts);
  assert.equal(recommendation.requiresHuman, true);
  assert.match(recommendation.summary, /USD but the matched beneficiary is paid in AUD/);
});

test("a missing payout route is reported before funding is judged", () => {
  const facts = {
    ...readyFacts,
    beneficiaryId: null,
    transferRouteAvailable: false,
    transferMethod: null,
    payoutCurrency: null,
    sourceCurrency: null,
    requiredSourceAmount: null,
    fxRate: null,
    hasSufficientBalance: false,
  };
  assert.equal(expectedRecommendation(facts), "MISSING_BENEFICIARY");
  assert.equal(fundingStatusForModel(facts), "NOT_CHECKED");
});

test("a duplicate explanation names how the match was made", () => {
  const facts = {
    ...readyFacts,
    duplicateBillIds: ["34b0345d-ae4d-45b8-a19c-171c9be2e633"],
    duplicateMatchReasons: ["Same vendor and amount, issued 2 days apart under invoice number PAY-0902."],
  };
  const recommendation = buildApFallback(facts);
  assert.equal(recommendation.recommendation, "REVIEW_DUPLICATE");
  assert.match(recommendation.reasons.join(" "), /issued 2 days apart/);
  assert.ok(recommendation.reasons.length <= 4);
});
