import assert from "node:assert/strict";
import test from "node:test";
import { chooseTransferMethod, readPayoutRoute } from "../lib/airwallex-ap.ts";

// Shapes copied from real GET /api/v1/beneficiaries responses in the Sandbox.
const nicknamed = {
  id: "b857d00b-412e-4b8f-a3c7-a4b31338bb2a",
  nickname: "OB-1001 AU Payroll Bureau",
  transfer_methods: ["LOCAL"],
  beneficiary: {
    entity_type: "COMPANY",
    bank_details: {
      account_currency: "AUD",
      account_name: "AU Payroll Bureau Pty Ltd",
      bank_country_code: "AU",
    },
  },
};

const unnamed = {
  id: "96d11f87-9edf-43b3-b203-a2d58cd55c33",
  transfer_methods: ["LOCAL"],
  beneficiary: {
    entity_type: "PERSONAL",
    first_name: "US USD",
    last_name: "LOCAL",
    bank_details: {
      account_currency: "USD",
      account_name: "US USD LOCAL",
      bank_country_code: "US",
    },
  },
};

test("a payout route is read from the beneficiary, not from transfer history", () => {
  const route = readPayoutRoute(nicknamed);
  assert.equal(route.beneficiaryId, nicknamed.id);
  assert.equal(route.payoutCurrency, "AUD");
  assert.equal(route.bankCountryCode, "AU");
  assert.deepEqual(route.transferMethods, ["LOCAL"]);
});

test("a beneficiary with no nickname is still usable", () => {
  // Seven of eight Sandbox beneficiaries have no nickname. The previous code dropped
  // them from the picker entirely, leaving a single selectable payee.
  const route = readPayoutRoute(unnamed);
  assert.equal(route.displayName, "US USD LOCAL");
  assert.equal(route.payoutCurrency, "USD");
});

test("a record with no id yields no route", () => {
  assert.equal(readPayoutRoute({ transfer_methods: ["LOCAL"] }), null);
});

test("a record with no usable name yields no route", () => {
  assert.equal(readPayoutRoute({ id: "x", beneficiary: { bank_details: {} } }), null);
});

test("a beneficiary with no transfer methods has no usable route", () => {
  const route = readPayoutRoute({ ...nicknamed, transfer_methods: [] });
  assert.deepEqual(route.transferMethods, []);
  assert.equal(chooseTransferMethod(route), null);
});

test("LOCAL is preferred over SWIFT when both are offered", () => {
  assert.equal(chooseTransferMethod({ transferMethods: ["SWIFT", "LOCAL"] }), "LOCAL");
  assert.equal(chooseTransferMethod({ transferMethods: ["SWIFT"] }), "SWIFT");
});

test("payout currency is normalised to upper case", () => {
  const route = readPayoutRoute({
    ...nicknamed,
    beneficiary: { bank_details: { account_currency: "aud", account_name: "x" } },
  });
  assert.equal(route.payoutCurrency, "AUD");
});
