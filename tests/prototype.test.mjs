// Source-level invariants only. These assert what must NOT be present (credentials in
// the client, transfer creation) and that key wiring exists. Behaviour is covered by
// ap-agent, ap-intake, ap-case-status and airwallex-route, which call the real code.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("presents the complete AP exception workflow", async () => {
  const dashboard = await readFile(new URL("app/APWorkbench.tsx", root), "utf8");
  assert.match(dashboard, /Reset the demo\?/);
  assert.match(dashboard, /Retiring a bill cannot be undone/);
  for (const label of [
    "Bills to review", "Duplicate check", "Wallet funds", "Bill pipeline",
    "Resolve possible duplicate", "Resolve amount change", "Resolve beneficiary",
    "Validate payout with Airwallex", "View decision record", "Why the log shows a transfers call",
    "Ask about this bill", "Invoices arriving in AP", "unfiled", "Paste text instead",
  ]) {
    assert.match(dashboard, new RegExp(label));
  }
  assert.match(dashboard, /You remain in control of payment/);
  assert.match(dashboard, /AI reviews incoming bills, explains exceptions/);
  assert.doesNotMatch(dashboard, /questionBox/);
  assert.doesNotMatch(dashboard, /Server verified/);
  assert.doesNotMatch(dashboard, /guardrailBox/);
  assert.doesNotMatch(dashboard, /auditStrip/);
  assert.doesNotMatch(dashboard, /safetyFooter/);
  for (const queue of ["Attention", "Ready", "On hold", "Closed"]) assert.match(dashboard, new RegExp(queue));
  assert.match(dashboard, /duplicateResolution \? \(/);
  assert.match(dashboard, /amountResolution \? \(/);
  assert.match(dashboard, /beneficiaryResolution \? \(/);
  assert.match(dashboard, /Reopen beneficiary case/);
});

test("attaches the model's reasoning to the check the server decision turns on", async () => {
  const [dashboard, styles] = await Promise.all([
    readFile(new URL("app/APWorkbench.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);
  // The reason rows are keyed off the server recommendation, not off keywords in the
  // model's prose: every recommendation code must name the check it hangs on.
  const map = dashboard.slice(dashboard.indexOf("const decidingCheck"), dashboard.indexOf("const decidedBy"));
  for (const code of [
    "REVIEW_DUPLICATE", "REVIEW_AMOUNT_CHANGE", "MISSING_BENEFICIARY",
    "BENEFICIARY_CURRENCY_MISMATCH", "INSUFFICIENT_FUNDS", "REQUEST_INFORMATION",
    "READY_TO_VALIDATE",
  ]) {
    assert.match(map, new RegExp(`${code}: "`));
  }
  assert.match(dashboard, /decidedBy === row\.key/);
  assert.doesNotMatch(dashboard, /function reasonTone/);
  assert.match(styles, /\.why \{[^}]*border-left: 2px solid var\(--blue\)/);
  const beneficiaryTone = dashboard.slice(dashboard.indexOf("const beneficiaryCheckTone"), dashboard.indexOf("const beneficiaryCheckText"));
  assert.match(beneficiaryTone, /: "warn";/);
  assert.doesNotMatch(beneficiaryTone, /: "neutral";/);
});

test("seeds only the ask-someone actions with the model's drafted question", async () => {
  const dashboard = await readFile(new URL("app/APWorkbench.tsx", root), "utf8");
  assert.match(dashboard, /const draftedQuestion = recommendation\?\.questionForSubmitter/);
  // The two actions that ask a person something may start from the model's draft.
  // Each handler ends at its own </button>, so slice there rather than by character
  // count — a fixed window runs into the next button and reads its prefill instead.
  const handler = (mode) => {
    const from = dashboard.indexOf(`setResolutionMode("${mode}")`);
    assert.notEqual(from, -1, `no handler for ${mode}`);
    return dashboard.slice(from, dashboard.indexOf("</button>", from));
  };
  for (const mode of ["REQUEST", "REQUEST_AMOUNT"]) {
    assert.match(handler(mode), /setResolutionNote\(draftedQuestion \|\|/);
  }
  // The actions that clear or escalate an exception must not: that justification is
  // the operator's own, and a model-drafted reason for dismissing its own flag would
  // be the model deciding by the back door.
  for (const mode of ["OVERRIDE", "APPROVE_VARIANCE", "DISPUTE", "INCORRECT_VENDOR", "MATCH_BENEFICIARY"]) {
    assert.doesNotMatch(handler(mode), /draftedQuestion/);
  }
});

test("keeps the interactive assistant inside server finance guardrails", async () => {
  const [dashboard, route, agent] = await Promise.all([
    readFile(new URL("app/APWorkbench.tsx", root), "utf8"),
    readFile(new URL("app/api/ap/route.ts", root), "utf8"),
    readFile(new URL("lib/ap-agent.ts", root), "utf8"),
  ]);
  assert.match(dashboard, /message\.label\.toLowerCase\(\)\.includes\("unverified"\)/);
  assert.match(dashboard, /\? "unverified" : ""/);
  assert.match(route, /answerApQuestion\(billCase\.facts/);
  assert.match(agent, /I cannot approve, pay, schedule, or create a transfer/);
  assert.match(agent, /You do not make or change it/i);
  assert.match(agent, /invoiceNumberPresent/);
  // The model is never handed the server's answer, and has no field to state one in.
  assert.doesNotMatch(agent, /serverRequiredRecommendation/);
  assert.doesNotMatch(agent, /validateApRecommendation/);
  assert.match(agent, /recommendation.*deliberately absent/s);
  assert.match(agent, /\.\.\.result\.output,[^}]*\.\.\.decision/);
  assert.match(dashboard, /action: "triage"/);
  assert.match(route, /previousBills/);
});

test("uses real Airwallex Spend and Payout validation APIs", async () => {
  const [route, client] = await Promise.all([
    readFile(new URL("app/api/ap/route.ts", root), "utf8"),
    readFile(new URL("lib/airwallex-ap.ts", root), "utf8"),
  ]);
  assert.match(route, /listBills\(token, apiCalls\)/);
  assert.match(route, /listBeneficiaries\(token, apiCalls\)/);
  assert.match(route, /listBalances\(token, apiCalls\)/);
  assert.match(route, /validateTransfer\(token/);
  assert.match(client, /\/api\/v1\/spend\/bills/);
  assert.match(client, /\/api\/v1\/transfers\/validate/);
});

test("shows sanitized live Airwallex call results", async () => {
  const [dashboard, route, client] = await Promise.all([
    readFile(new URL("app/APWorkbench.tsx", root), "utf8"),
    readFile(new URL("app/api/ap/route.ts", root), "utf8"),
    readFile(new URL("lib/airwallex-ap.ts", root), "utf8"),
  ]);
  assert.match(dashboard, /Live Airwallex API activity/);
  assert.match(dashboard, /call\.durationMs/);
  assert.match(route, /apiCalls/);
  assert.match(client, /safeEndpoint/);
  assert.match(client, /:record_id/);
});

test("the audit trail is never signed by an unverified name", async () => {
  const [route, dashboard] = await Promise.all([
    readFile(new URL("app/api/ap/route.ts", root), "utf8"),
    readFile(new URL("app/APWorkbench.tsx", root), "utf8"),
  ]);
  assert.match(route, /Demo operator \(unauthenticated session\)/);
  assert.doesNotMatch(route, /actor: "[A-Z][a-z]+ [A-Z][a-z]+"/);
  assert.match(dashboard, /Unauthenticated session/);
});

test("one Airwallex read per request, not one per branch", async () => {
  const route = await readFile(new URL("app/api/ap/route.ts", root), "utf8");
  assert.match(route, /const requestState = async \(\)/);
  // Exactly two uncached loads: the GET, and the deliberate reload after a match.
  assert.equal((route.match(/await loadCases\(token, apiCalls\)/g) || []).length, 3);
  assert.match(route, /deliberate: the match just changed the facts/);
});

test("bill detail is only fetched for bills the queue shows", async () => {
  const route = await readFile(new URL("app/api/ap/route.ts", root), "utf8");
  assert.match(route, /if \(!OPEN_STATUSES\.has\(String\(bill\.status \|\| ""\)\)\) return bill;/);
});

test("gates a deployed copy behind a shared password", async () => {
  const worker = await readFile(new URL("worker/index.ts", root), "utf8");
  // A deployed copy drives a real sandbox and a metered model, so the gate has to
  // run before anything else the worker does.
  const fetchBody = worker.slice(worker.indexOf("async fetch("));
  const gateAt = fetchBody.indexOf("passwordGate(request, env)");
  const handlerAt = fetchBody.indexOf("handler.fetch");
  assert.ok(gateAt > -1, "the worker must call passwordGate");
  assert.ok(gateAt < handlerAt, "passwordGate must run before the app handler");
  assert.match(worker, /WWW-Authenticate/);
  // Comparison must not short-circuit on the first differing byte.
  assert.match(worker, /function secretsMatch/);
  // The scheduled reset calls the app handler directly, so the gate must not sit
  // in front of a request that never leaves the worker.
  assert.match(worker, /async scheduled\(/);
  const scheduled = worker.slice(worker.indexOf("async scheduled("), worker.indexOf("async fetch("));
  assert.match(scheduled, /reset_demo/);
  assert.doesNotMatch(scheduled, /passwordGate/);
  assert.doesNotMatch(worker, /supplied === expected/);
});

test("never creates a transfer", async () => {
  const files = await Promise.all([
    readFile(new URL("app/api/ap/route.ts", root), "utf8"),
    readFile(new URL("lib/airwallex-ap.ts", root), "utf8"),
  ]);
  const source = files.join("\n");
  assert.doesNotMatch(source, /\/api\/v1\/transfers\/create/);
  assert.doesNotMatch(source, /function createTransfer/);
});

test("keeps credentials server-side and validates actions", async () => {
  const [dashboard, route, client] = await Promise.all([
    readFile(new URL("app/APWorkbench.tsx", root), "utf8"),
    readFile(new URL("app/api/ap/route.ts", root), "utf8"),
    readFile(new URL("lib/airwallex-ap.ts", root), "utf8"),
  ]);
  assert.doesNotMatch(dashboard, /AIRWALLEX_(API_KEY|CLIENT_ID)/);
  assert.match(client, /process\.env\.AIRWALLEX_CLIENT_ID/);
  assert.match(client, /process\.env\.AIRWALLEX_API_KEY/);
  assert.match(route, /requestSchema\.safeParse/);
  assert.match(route, /Server guardrails blocked payout validation/);
});


test("persists auditable exception decisions without moving money", async () => {
  const [route, resolutions, beneficiaryResolutions, hosting] = await Promise.all([
    readFile(new URL("app/api/ap/route.ts", root), "utf8"),
    readFile(new URL("lib/ap-resolutions.ts", root), "utf8"),
    readFile(new URL("lib/ap-beneficiary-resolutions.ts", root), "utf8"),
    readFile(new URL(".openai/hosting.json", root), "utf8"),
  ]);
  assert.match(route, /confirm_duplicate/);
  assert.match(route, /override_duplicate/);
  assert.match(route, /request_information/);
  assert.match(route, /approve_variance/);
  assert.match(route, /request_amount_explanation/);
  assert.match(route, /dispute_bill/);
  assert.match(resolutions, /ap_resolutions/);
  assert.match(resolutions, /APPROVED_VARIANCE/);
  assert.match(resolutions, /REQUESTED_AMOUNT_EXPLANATION/);
  assert.match(resolutions, /DISPUTED_BILL/);
  assert.match(resolutions, /ON CONFLICT\(bill_id\) DO UPDATE/);
  assert.match(route, /match_beneficiary/);
  assert.match(route, /request_beneficiary_setup/);
  assert.match(route, /incorrect_vendor/);
  assert.match(beneficiaryResolutions, /ap_beneficiary_resolutions/);
  assert.match(beneficiaryResolutions, /MATCHED_BENEFICIARY/);
  assert.match(beneficiaryResolutions, /REQUESTED_BENEFICIARY_SETUP/);
  assert.match(beneficiaryResolutions, /INCORRECT_VENDOR/);
  assert.equal(JSON.parse(hosting).d1, "DB");
});

test("only matches a beneficiary returned by live Airwallex data", async () => {
  const route = await readFile(new URL("app/api/ap/route.ts", root), "utf8");
  assert.match(route, /state\.beneficiaryOptions\.find/);
  assert.match(route, /Select a current Airwallex beneficiary before saving/);
  assert.match(route, /payout eligibility was rechecked/);
});




test("retired app-created bills are not treated as vendor history", async () => {
  const route = await readFile(new URL("app/api/ap/route.ts", root), "utf8");
  // Bills left behind by earlier demo generations share a vendor, amount and date with
  // the ones that replaced them, which every duplicate signal would read as a duplicate.
  assert.match(route, /const supersededIds = new Set\(/);
  // The marker is the trailing timestamp, so every regenerated scenario is covered — not
  // just the ones whose id happens to end in CURRENT. History bills carry no timestamp
  // and survive, which the duplicate scenario depends on.
  assert.match(route, /\^\(AP-DEMO-\.\*\?\)\(\?:-\(\\d\{10,\}\)\)\?\$/);
  assert.match(route, /!supersededIds\.has\(String\(candidate\.id\)\)/);
  assert.match(route, /startsWith\("AP-INTAKE-"\) && !OPEN_STATUSES\.has/);
});

test("an inbox message is filed only by the bill it actually produced", async () => {
  const route = await readFile(new URL("app/api/ap/route.ts", root), "utf8");
  // Not "some bill somewhere shares this invoice number" — seeded demo bills carry the
  // same numbers as inbox messages nobody ever opened.
  assert.doesNotMatch(route, /filed\.has\(message\.invoiceNumber/);
  assert.match(route, /AP-INTAKE-\$\{message\.id\}-/);
  // The bill records which message created it, and only an open bill counts as filed.
  assert.match(route, /AP-INTAKE-\$\{parsed\.data\.messageId\.replace/);
  assert.match(route, /This message was already filed as/);
});

test("resetting the demo clears saved decisions and retires only demo bills", async () => {
  const [route, resolutions, beneficiaryResolutions] = await Promise.all([
    readFile(new URL("app/api/ap/route.ts", root), "utf8"),
    readFile(new URL("lib/ap-resolutions.ts", root), "utf8"),
    readFile(new URL("lib/ap-beneficiary-resolutions.ts", root), "utf8"),
  ]);
  assert.match(resolutions, /DELETE FROM ap_resolutions/);
  assert.match(beneficiaryResolutions, /DELETE FROM ap_beneficiary_resolutions/);
  // Only bills this app created may be retired, and only while still open.
  assert.match(route, /externalId\.startsWith\("AP-DEMO-"\) \|\| externalId\.startsWith\("AP-INTAKE-"\)/);
  assert.match(route, /isDemoBill && OPEN_STATUSES\.has/);
  // A retired scenario has to be re-creatable, so current bills get a fresh external id.
  assert.match(route, /spec\.history \? spec\.externalId : `\$\{spec\.externalId\}-\$\{Date\.now\(\)\}`/);
});

test("validate and create are distinguished, and only validate is reachable", async () => {
  const [client, dashboard] = await Promise.all([
    readFile(new URL("lib/airwallex-ap.ts", root), "utf8"),
    readFile(new URL("app/APWorkbench.tsx", root), "utf8"),
  ]);
  // The only transfers endpoint the app can reach is the dry run.
  const endpoints = [...client.matchAll(/["'`](\/api\/v1\/transfers[^"'`]*)/g)].map((m) => m[1]);
  assert.deepEqual(endpoints, ["/api/v1/transfers/validate"]);
  // And the UI says so where a reader would otherwise misread the log.
  assert.match(dashboard, /POST \/transfers\/validate/);
  assert.match(dashboard, /POST \/transfers\/create/);
  assert.match(dashboard, /never makes/);
});
