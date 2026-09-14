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
    "Bills to review", "Verified financial facts", "Bill pipeline",
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

test("shows reasoning evidence with semantic status indicators", async () => {
  const [dashboard, styles] = await Promise.all([
    readFile(new URL("app/APWorkbench.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);
  assert.match(dashboard, /blocked: "×"/);
  assert.match(dashboard, /review: "!"/);
  assert.match(dashboard, /unchecked: "—"/);
  assert.match(dashboard, /function reasonTone/);
  assert.match(styles, /li\.blocked > span \{ color: var\(--red\)/);
  assert.match(styles, /li\.unchecked > span \{ color: var\(--muted\)/);
  const beneficiaryTone = dashboard.slice(dashboard.indexOf("const beneficiaryCheckTone"), dashboard.indexOf("const beneficiaryCheckText"));
  assert.match(beneficiaryTone, /: "warn";/);
  assert.doesNotMatch(beneficiaryTone, /: "neutral";/);
});

test("keeps the interactive assistant inside server finance guardrails", async () => {
  const [dashboard, route, agent] = await Promise.all([
    readFile(new URL("app/APWorkbench.tsx", root), "utf8"),
    readFile(new URL("app/api/ap/route.ts", root), "utf8"),
    readFile(new URL("lib/ap-agent.ts", root), "utf8"),
  ]);
  assert.match(dashboard, /Anything entered here is treated as unverified/);
  assert.match(route, /answerApQuestion\(billCase\.facts/);
  assert.match(agent, /I cannot approve, pay, schedule, or create a transfer/);
  assert.match(agent, /You do not make or change it/i);
  assert.match(agent, /invoiceNumberPresent/);
  // The model is never handed the server's answer, and has no field to state one in.
  assert.doesNotMatch(agent, /serverRequiredRecommendation/);
  assert.doesNotMatch(agent, /validateApRecommendation/);
  assert.match(agent, /recommendation.*deliberately absent/s);
  assert.match(agent, /\.\.\.result\.output, \.\.\.decision/);
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
