import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  analyzeApBill,
  answerApQuestion,
  buildApFallback,
  expectedRecommendation,
  type ApFacts,
} from "../../../lib/ap-agent";
import {
  AirwallexApiError,
  authenticateAirwallex,
  createBill,
  createVendor,
  getBill,
  getCurrentAccount,
  listBalances,
  listBeneficiaries,
  listBills,
  listVendors,
  markBillPaid,
  readPayoutRoute,
  chooseTransferMethod,
  getCurrentFxRate,
  validateTransfer,
  type PayoutRoute,
  type AirwallexApiTrace,
  type AirwallexJson,
} from "../../../lib/airwallex-ap";
import {
  buildIntakeDraft,
  extractIntakeFields,
  type VendorOption,
} from "../../../lib/ap-intake";
import { findInboxMessage, listInboxMessages } from "../../../lib/ap-inbox";
import {
  clearAllApResolutions,
  clearApResolution,
  listApResolutions,
  saveApResolution,
  type ApResolution,
} from "../../../lib/ap-resolutions";
import {
  clearAllApBeneficiaryResolutions,
  clearApBeneficiaryResolution,
  listApBeneficiaryResolutions,
  saveApBeneficiaryResolution,
  type ApBeneficiaryResolution,
} from "../../../lib/ap-beneficiary-resolutions";
import { apQueueStatus } from "../../../lib/ap-case-status";

const confirmedIntakeSchema = z.object({
  vendorName: z.string().trim().min(1).max(120),
  invoiceNumber: z.string().trim().min(1).max(60),
  amount: z.number().finite(),
  currency: z.string().trim().length(3),
  dueDate: z.string().trim().max(40),
  description: z.string().trim().min(1).max(200),
}).strict();

const requestSchema = z.object({
  action: z.enum(["seed", "reset_demo", "triage", "assistant", "validate", "inbox", "intake", "create_bill_from_intake", "discard_intake_bill", "confirm_duplicate", "override_duplicate", "request_information", "approve_variance", "request_amount_explanation", "dispute_bill", "match_beneficiary", "request_beneficiary_setup", "incorrect_vendor", "clear_resolution", "clear_beneficiary_resolution"]),
  billId: z.string().uuid().optional(),
  question: z.string().trim().min(2).max(1000).optional(),
  note: z.string().trim().max(1000).optional(),
  matchingBillId: z.string().uuid().optional(),
  beneficiaryId: z.string().uuid().optional(),
  documentText: z.string().trim().min(20).max(20000).optional(),
  messageId: z.string().trim().max(60).optional(),
  confirmed: confirmedIntakeSchema.optional(),
  /** Set when a person has checked each field of a low-confidence extraction. */
  fieldsReviewed: z.boolean().optional(),
  extractionConfidence: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
}).strict();

/** How a candidate was matched. An invoice number is decisive; the rest is a signal. */
type DuplicateMatchType = "INVOICE_NUMBER" | "AMOUNT_AND_DATE";

type DuplicateMatch = {
  id: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  issuedDate: string;
  dueDate: string;
  status: string;
  matchType: DuplicateMatchType;
  matchReason: string;
};

/** Same vendor, same amount, issued within this many days counts as a likely resubmission. */
const DUPLICATE_WINDOW_DAYS = 10;

function daysApart(a: string, b: string) {
  const left = Date.parse(a.length === 10 ? `${a}T12:00:00Z` : a);
  const right = Date.parse(b.length === 10 ? `${b}T12:00:00Z` : b);
  if (Number.isNaN(left) || Number.isNaN(right)) return null;
  return Math.abs(left - right) / 86_400_000;
}

type BillCase = {
  id: string;
  vendorId: string;
  vendor: string;
  invoiceNumber: string;
  description: string;
  amount: number;
  currency: string;
  issuedDate: string;
  dueDate: string;
  status: string;
  syncStatus: string;
  observedAmountChangePercent: number | null;
  arrivedByIntake: boolean;
  facts: ApFacts;
  duplicateMatches: DuplicateMatch[];
  previousBills: Array<{
    id: string;
    invoiceNumber: string;
    amount: number;
    currency: string;
    issuedDate: string;
    status: string;
  }>;
  resolution: ApResolution | null;
  beneficiaryResolution: ApBeneficiaryResolution | null;
  serverRecommendation: ReturnType<typeof buildApFallback>;
};

type BeneficiaryOption = {
  id: string;
  name: string;
  transferMethod: string | null;
  payoutCurrency: string | null;
  bankCountry: string | null;
  routeAvailable: boolean;
};

type Funding = {
  sourceCurrency: string | null;
  availableSourceBalance: number;
  requiredSourceAmount: number | null;
  fxRate: number | null;
  fxQuotedAt: string | null;
  hasSufficientBalance: boolean;
};

const UNFUNDED: Funding = {
  sourceCurrency: null,
  availableSourceBalance: 0,
  requiredSourceAmount: null,
  fxRate: null,
  fxQuotedAt: null,
  hasSufficientBalance: false,
};

/** Wallets to try when the payout currency itself is not funded, best first. */
const FUNDING_PREFERENCE = ["USD", "GBP", "EUR", "SGD", "HKD", "AUD", "CNY"];

/**
 * Answers "can we actually pay this?" in the payout currency, converting through a
 * live FX rate when the payout currency wallet cannot cover it on its own.
 */
async function resolveFunding(
  token: string,
  payoutCurrency: string,
  payoutAmount: number,
  availableByCurrency: Map<string, number>,
  rateCache: Map<string, Promise<AirwallexJson | null>>,
  apiCalls?: AirwallexApiTrace,
): Promise<Funding> {
  const sameCurrency = availableByCurrency.get(payoutCurrency) ?? 0;
  if (sameCurrency >= payoutAmount) {
    return {
      sourceCurrency: payoutCurrency,
      availableSourceBalance: sameCurrency,
      requiredSourceAmount: payoutAmount,
      fxRate: 1,
      fxQuotedAt: null,
      hasSufficientBalance: true,
    };
  }

  for (const currency of FUNDING_PREFERENCE) {
    if (currency === payoutCurrency) continue;
    const available = availableByCurrency.get(currency) ?? 0;
    if (available <= 0) continue;

    // Cache the in-flight promise, not the result: bills resolve concurrently, so
    // caching only on completion lets identical quotes go out several times over.
    const cacheKey = `${payoutCurrency}:${currency}:${payoutAmount}`;
    if (!rateCache.has(cacheKey)) {
      rateCache.set(cacheKey, getCurrentFxRate(token, payoutCurrency, currency, payoutAmount, apiCalls).catch(() => null));
    }
    const quote = await rateCache.get(cacheKey);
    if (!quote) continue;

    const client = (quote.rate_details || []).find((detail: AirwallexJson) => detail.level === "CLIENT");
    const requiredSourceAmount = amount(client?.sell_amount);
    if (requiredSourceAmount <= 0 || available < requiredSourceAmount) continue;

    return {
      sourceCurrency: currency,
      availableSourceBalance: available,
      requiredSourceAmount: round(requiredSourceAmount),
      fxRate: amount(client?.rate) || null,
      fxQuotedAt: String(quote.created_at || "") || null,
      hasSufficientBalance: true,
    };
  }

  return { ...UNFUNDED, sourceCurrency: payoutCurrency, availableSourceBalance: sameCurrency, requiredSourceAmount: payoutAmount };
}

/**
 * There is no authentication in this prototype, so the audit trail says so rather than
 * signing decisions with a person's name nobody verified.
 */
const AUDIT_ACTOR = "Demo operator (unauthenticated session)";

/** Statuses that mean a bill is still the operator's problem. */
const OPEN_STATUSES = new Set(["DRAFT", "AWAITING_APPROVAL", "AWAITING_PAYMENT", "PAYMENT_IN_PROGRESS", "SCHEDULED"]);

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function amount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function billDescription(bill: AirwallexJson) {
  if (typeof bill.description === "string" && bill.description.trim()) return bill.description.trim();
  const descriptions = (bill.line_items || [])
    .map((item: AirwallexJson) => item.description)
    .filter((value: unknown): value is string => typeof value === "string" && Boolean(value.trim()));
  return descriptions.join("; ");
}

async function loadCases(token: string, apiCalls?: AirwallexApiTrace) {
  const [billSummaries, vendors, beneficiaries, balances, resolutions, beneficiaryResolutions] = await Promise.all([
    listBills(token, apiCalls),
    listVendors(token, apiCalls),
    listBeneficiaries(token, apiCalls),
    listBalances(token, apiCalls),
    listApResolutions(),
    listApBeneficiaryResolutions(),
  ]);

  const bills = await Promise.all(billSummaries.map(async (bill) => {
    if (!OPEN_STATUSES.has(String(bill.status || ""))) return bill;
    try {
      return await getBill(token, bill.id, apiCalls);
    } catch {
      return bill;
    }
  }));

  // A demo reset retires a bill and lays down a replacement with the same vendor, amount
  // and date — which every duplicate signal correctly reads as a duplicate. Those retired
  // generations are demo artefacts, not vendor history, so they are not evidence about
  // anything. Keep only the newest bill per scenario.
  //
  // The trailing timestamp is what marks a generated bill. History bills (…-HIST-01) and
  // the Studio original carry no timestamp, so each is its own scenario and survives —
  // which matters, because the original is what the duplicate scenario matches against.
  const newestByScenario = new Map<string, { id: string; stamp: number }>();
  for (const bill of billSummaries) {
    const match = /^(AP-DEMO-.*?)(?:-(\d{10,}))?$/.exec(String(bill.external_id || ""));
    if (!match) continue;
    const stamp = Number(match[2] || 0);
    const current = newestByScenario.get(match[1]);
    if (!current || stamp > current.stamp) newestByScenario.set(match[1], { id: String(bill.id), stamp });
  }
  const supersededIds = new Set(
    billSummaries
      .filter((bill) => {
        const externalId = String(bill.external_id || "");
        // An intake bill that was withdrawn or retired by a reset was never really paid,
        // so it is not vendor history either. (A production system would distinguish
        // "paid" from "retired"; the Spend API has no retire, so this stands in.)
        if (externalId.startsWith("AP-INTAKE-") && !OPEN_STATUSES.has(String(bill.status || ""))) return true;
        const match = /^(AP-DEMO-.*?)(?:-(\d{10,}))?$/.exec(externalId);
        return match ? newestByScenario.get(match[1])?.id !== String(bill.id) : false;
      })
      .map((bill) => String(bill.id)),
  );

  const vendorById = new Map(vendors.map((vendor) => [vendor.id as string, vendor]));
  const resolutionByBillId = new Map(resolutions.map((resolution) => [resolution.billId, resolution]));
  const beneficiaryResolutionByBillId = new Map(beneficiaryResolutions.map((resolution) => [resolution.billId, resolution]));
  const availableByCurrency = new Map(
    balances.map((balance) => [String(balance.currency), amount(balance.available_amount)]),
  );
  const routes = beneficiaries
    .map(readPayoutRoute)
    .filter((route): route is PayoutRoute => route !== null);
  const routeById = new Map(routes.map((route) => [route.beneficiaryId, route]));
  const routeByName = new Map<string, PayoutRoute>();
  for (const route of routes) {
    routeByName.set(normalizeName(route.displayName), route);
    // "OB-1001 AU Payroll Bureau" should still match the vendor "AU Payroll Bureau".
    const bare = route.displayName.replace(/^[A-Za-z]{2}-\d+\s+/, "");
    if (bare !== route.displayName) routeByName.set(normalizeName(bare), route);
  }

  const beneficiaryOptions = routes.map((route): BeneficiaryOption => ({
    id: route.beneficiaryId,
    name: route.displayName,
    transferMethod: chooseTransferMethod(route),
    payoutCurrency: route.payoutCurrency,
    bankCountry: route.bankCountryCode,
    routeAvailable: route.transferMethods.length > 0 && Boolean(route.payoutCurrency),
  })).sort((a, b) => a.name.localeCompare(b.name));

  const rateCache = new Map<string, Promise<AirwallexJson | null>>();

  const cases: BillCase[] = await Promise.all(bills.map(async (bill) => {
    const vendor = vendorById.get(bill.vendor_id as string);
    const vendorName = String(vendor?.name || "Unknown vendor");
    const invoiceNumber = String(bill.invoice_number || "");
    const currentAmount = amount(bill.billing_amount);
    const sameVendor = bills.filter((candidate) =>
      candidate.id !== bill.id
      && candidate.vendor_id === bill.vendor_id
      && !supersededIds.has(String(candidate.id)));
    const issuedOn = String(bill.issued_date || bill.created_at || "");
    // Two signals, not one. Matching the invoice number is decisive; the same vendor
    // billing the same amount within a few days is the resubmission-under-a-new-number
    // case, which an invoice-number check alone never sees.
    const duplicateCandidates = sameVendor.flatMap((candidate) => {
      const candidateNumber = String(candidate.invoice_number || "");
      if (invoiceNumber && candidateNumber.toLowerCase() === invoiceNumber.toLowerCase()) {
        return [{ candidate, matchType: "INVOICE_NUMBER" as const, matchReason: `Same vendor and invoice number ${invoiceNumber}.` }];
      }
      const candidateAmount = amount(candidate.billing_amount);
      const sameAmount = candidateAmount > 0 && Math.abs(candidateAmount - currentAmount) < 0.01;
      const sameCurrency = String(candidate.billing_currency || "").toUpperCase() === String(bill.billing_currency || "").toUpperCase();
      const gap = daysApart(issuedOn, String(candidate.issued_date || candidate.created_at || ""));
      if (sameAmount && sameCurrency && gap !== null && gap <= DUPLICATE_WINDOW_DAYS) {
        return [{
          candidate,
          matchType: "AMOUNT_AND_DATE" as const,
          matchReason: `Same vendor and amount, issued ${Math.round(gap)} day${Math.round(gap) === 1 ? "" : "s"} apart under invoice number ${candidateNumber || "(none)"}.`,
        }];
      }
      return [];
    });
    const resolution = resolutionByBillId.get(String(bill.id)) || null;
    const beneficiaryResolution = beneficiaryResolutionByBillId.get(String(bill.id)) || null;
    const duplicateBillIds = resolution?.action === "NOT_DUPLICATE"
      ? []
      : duplicateCandidates.map(({ candidate }) => String(candidate.id));
    const duplicateMatches = duplicateCandidates.map(({ candidate, matchType, matchReason }): DuplicateMatch => ({
      id: String(candidate.id),
      invoiceNumber: String(candidate.invoice_number || ""),
      amount: amount(candidate.billing_amount),
      currency: String(candidate.billing_currency || "USD"),
      issuedDate: String(candidate.issued_date || ""),
      dueDate: String(candidate.due_date || ""),
      status: String(candidate.status || "UNKNOWN"),
      matchType,
      matchReason,
    }));
    const issuedAt = issuedOn;
    const previousBills = sameVendor
      .filter((candidate) => {
        const candidateDate = String(candidate.issued_date || candidate.created_at || "");
        return candidateDate < issuedAt
          && String(candidate.invoice_number || "").toLowerCase() !== invoiceNumber.toLowerCase();
      })
      .sort((a, b) => String(b.issued_date || b.created_at).localeCompare(String(a.issued_date || a.created_at)))
      .slice(0, 6)
      .map((candidate) => ({
        id: String(candidate.id),
        invoiceNumber: String(candidate.invoice_number || ""),
        amount: amount(candidate.billing_amount),
        currency: String(candidate.billing_currency || "USD"),
        issuedDate: String(candidate.issued_date || candidate.created_at || ""),
        status: String(candidate.status || "UNKNOWN"),
      }));
    const previousAmounts = previousBills.map((candidate) => candidate.amount);
    const averagePreviousAmount = previousAmounts.length
      ? round(previousAmounts.reduce((total, value) => total + value, 0) / previousAmounts.length)
      : null;
    const observedAmountChangePercent = averagePreviousAmount && averagePreviousAmount > 0
      ? round(((currentAmount - averagePreviousAmount) / averagePreviousAmount) * 100)
      : null;
    const amountChangePercent = resolution?.action === "APPROVED_VARIANCE"
      ? 0
      : observedAmountChangePercent;
    const route = beneficiaryResolution
      ? beneficiaryResolution.action === "MATCHED_BENEFICIARY" && beneficiaryResolution.beneficiaryId
        ? routeById.get(beneficiaryResolution.beneficiaryId)
        : undefined
      : routeByName.get(normalizeName(vendorName));
    const transferMethod = route ? chooseTransferMethod(route) : null;
    const routeAvailable = Boolean(route && transferMethod && route.payoutCurrency);
    const billCurrency = String(bill.billing_currency || "USD").toUpperCase();
    // Funding is only meaningful once a route exists and the bill is in the currency
    // that beneficiary is actually paid in.
    const funding = routeAvailable && route?.payoutCurrency === billCurrency
      ? await resolveFunding(token, billCurrency, currentAmount, availableByCurrency, rateCache, apiCalls)
      : UNFUNDED;
    const facts: ApFacts = {
      billId: String(bill.id),
      vendor: vendorName,
      invoiceNumber,
      description: billDescription(bill),
      amount: currentAmount,
      currency: billCurrency,
      dueDate: String(bill.due_date || ""),
      duplicateBillIds,
      duplicateMatchReasons: resolution?.action === "NOT_DUPLICATE" ? [] : duplicateCandidates.map((match) => match.matchReason),
      previousAmounts,
      averagePreviousAmount,
      amountChangePercent,
      beneficiaryId: route?.beneficiaryId || null,
      beneficiaryName: route?.displayName || null,
      transferRouteAvailable: routeAvailable,
      transferMethod,
      transferReason: null,
      payoutCurrency: route?.payoutCurrency || null,
      sourceCurrency: funding.sourceCurrency,
      availableSourceBalance: funding.availableSourceBalance,
      requiredSourceAmount: funding.requiredSourceAmount,
      fxRate: funding.fxRate,
      fxQuotedAt: funding.fxQuotedAt,
      hasSufficientBalance: funding.hasSufficientBalance,
    };

    return {
      id: String(bill.id),
      vendorId: String(bill.vendor_id || ""),
      vendor: vendorName,
      invoiceNumber,
      description: facts.description,
      amount: currentAmount,
      currency: facts.currency,
      issuedDate: String(bill.issued_date || ""),
      dueDate: facts.dueDate,
      status: String(bill.status || "UNKNOWN"),
      syncStatus: String(bill.sync_status || "UNKNOWN"),
      observedAmountChangePercent,
      arrivedByIntake: String(bill.external_id || "").startsWith("AP-INTAKE-"),
      facts,
      duplicateMatches,
      previousBills,
      resolution,
      beneficiaryResolution,
      serverRecommendation: buildApFallback(facts),
    };
  }));

  const openCases = cases
    .filter((item) => OPEN_STATUSES.has(item.status))
    .sort((a, b) => {
      const priority = { REVIEW_DUPLICATE: 0, REVIEW_AMOUNT_CHANGE: 1, MISSING_BENEFICIARY: 2, BENEFICIARY_CURRENCY_MISMATCH: 3, INSUFFICIENT_FUNDS: 4, REQUEST_INFORMATION: 5, READY_TO_VALIDATE: 6 } as const;
      return priority[expectedRecommendation(a.facts)] - priority[expectedRecommendation(b.facts)]
        || a.dueDate.localeCompare(b.dueDate);
    });

  const caseStatuses = new Map(openCases.map((item) => [item.id, apQueueStatus(item)]));

  return {
    cases: openCases,
    allBills: bills,
    vendors,
    beneficiaries,
    beneficiaryOptions,
    balances,
    summary: {
      open: openCases.length,
      needsAttention: openCases.filter((item) => caseStatuses.get(item.id) === "ATTENTION").length,
      ready: openCases.filter((item) => caseStatuses.get(item.id) === "READY").length,
      onHold: openCases.filter((item) => caseStatuses.get(item.id) === "ON_HOLD").length,
      closed: openCases.filter((item) => caseStatuses.get(item.id) === "CLOSED").length,
      totalValue: round(openCases.reduce((total, item) => total + item.amount, 0)),
    },
  };
}

/**
 * The live Airwallex facts intake is allowed to validate against: which vendors
 * already exist, and which currencies this account actually holds.
 */
async function loadIntakeContext(token: string, apiCalls?: AirwallexApiTrace) {
  const [vendors, balances] = await Promise.all([
    listVendors(token, apiCalls),
    listBalances(token, apiCalls),
  ]);
  return {
    vendors: vendors.flatMap((vendor): VendorOption[] => {
      const id = String(vendor.id || "");
      const name = String(vendor.name || "").trim();
      return id && name ? [{ id, name }] : [];
    }),
    supportedCurrencies: balances
      .map((balance) => String(balance.currency || ""))
      .filter(Boolean),
  };
}

function dateFromToday(offsetDays: number) {
  const value = new Date();
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

async function seedDemoData(token: string, apiCalls?: AirwallexApiTrace) {
  const [account, existingVendors, existingBills, beneficiaries] = await Promise.all([
    getCurrentAccount(token, apiCalls),
    listVendors(token, apiCalls),
    listBills(token, apiCalls),
    listBeneficiaries(token, apiCalls),
  ]);
  const legalEntityId = account.account_details?.legal_entity_id;
  if (!legalEntityId) throw new Error("Airwallex did not return a legal entity ID for bill setup");

  // Any beneficiary carrying its own transfer method and account currency will do —
  // this no longer depends on a transfer having been sent to it in the past.
  const payrollRoute = beneficiaries
    .map(readPayoutRoute)
    .find((route): route is PayoutRoute => Boolean(route && route.transferMethods.length && route.payoutCurrency));
  if (!payrollRoute) throw new Error("No saved beneficiary with a usable payout route is available for the routine scenario");

  const vendorSpecs = [
    { externalId: "AP-DEMO-PAYROLL-VENDOR", name: payrollRoute.displayName },
    { externalId: "AP-DEMO-CLOUD-VENDOR", name: "Northstar Cloud" },
    { externalId: "AP-DEMO-STUDIO-VENDOR", name: "Studio North" },
  ];
  const vendorIds = new Map<string, string>();
  let vendorsCreated = 0;
  for (const spec of vendorSpecs) {
    let vendor = existingVendors.find((item) => item.external_id === spec.externalId);
    if (!vendor) {
      vendor = await createVendor(token, {
        request_id: randomUUID(),
        external_id: spec.externalId,
        name: spec.name,
        legal_entity_ids: [legalEntityId],
        status: "ACTIVE",
        sync_status: "NOT_SYNCED",
      }, apiCalls);
      vendorsCreated += 1;
    }
    vendorIds.set(spec.externalId, String(vendor.id));
  }

  const payrollCurrency = payrollRoute.payoutCurrency as string;
  const generation = 1 + existingBills.filter((item) => String(item.external_id || "").startsWith("AP-DEMO-PAYROLL-CURRENT")).length;
  const generationSuffix = generation > 1 ? `-${generation}` : "";
  const billSpecs = [
    { externalId: "AP-DEMO-PAYROLL-HIST-01", vendorKey: "AP-DEMO-PAYROLL-VENDOR", invoice: "PAY-0701", amount: 100, currency: payrollCurrency, issue: -60, due: -45, description: "Monthly payroll processing", history: true },
    { externalId: "AP-DEMO-PAYROLL-HIST-02", vendorKey: "AP-DEMO-PAYROLL-VENDOR", invoice: "PAY-0801", amount: 100, currency: payrollCurrency, issue: -30, due: -15, description: "Monthly payroll processing", history: true },
    { externalId: "AP-DEMO-PAYROLL-CURRENT", vendorKey: "AP-DEMO-PAYROLL-VENDOR", invoice: "PAY-0901", amount: 100, currency: payrollCurrency, issue: 0, due: 10, description: "Monthly payroll processing", history: false },
    { externalId: "AP-DEMO-CLOUD-HIST", vendorKey: "AP-DEMO-CLOUD-VENDOR", invoice: "NC-0801", amount: 100, currency: "USD", issue: -30, due: -15, description: "Cloud infrastructure subscription", history: true },
    { externalId: "AP-DEMO-CLOUD-CURRENT", vendorKey: "AP-DEMO-CLOUD-VENDOR", invoice: "NC-0901", amount: 138, currency: "USD", issue: 0, due: 12, description: "Cloud infrastructure subscription", history: false },
    { externalId: "AP-DEMO-STUDIO-ORIGINAL", vendorKey: "AP-DEMO-STUDIO-VENDOR", invoice: "SN-552", amount: 500, currency: "USD", issue: -4, due: -1, description: "Product design services", history: true },
    { externalId: "AP-DEMO-STUDIO-DUPLICATE", vendorKey: "AP-DEMO-STUDIO-VENDOR", invoice: "SN-552", amount: 500, currency: "USD", issue: 0, due: 14, description: "Product design services", history: false, keepInvoiceNumber: true },
  ];

  let billsCreated = 0;
  let historyMarkedPaid = 0;
  const warnings: string[] = [];
  for (const spec of billSpecs) {
    // History bills are matched exactly: they are meant to stay paid and be reused.
    // Current bills are matched only while still OPEN, so a reset that retires them
    // lets the next seed create a fresh one under a new external id.
    const bill0 = spec.history
      ? existingBills.find((item) => item.external_id === spec.externalId)
      : existingBills.find((item) => String(item.external_id || "").startsWith(spec.externalId) && OPEN_STATUSES.has(String(item.status || "")));
    let bill = bill0;
    if (!bill) {
      bill = await createBill(token, {
        billing_currency: spec.currency,
        due_date: dateFromToday(spec.due),
        external_id: spec.history ? spec.externalId : `${spec.externalId}-${Date.now()}`,
        invoice_number: spec.history || "keepInvoiceNumber" in spec ? spec.invoice : `${spec.invoice}${generationSuffix}`,
        issued_date: dateFromToday(spec.issue),
        legal_entity_id: legalEntityId,
        line_items: [{ description: spec.description, quantity: "1", unit_price: spec.amount.toFixed(2) }],
        request_id: randomUUID(),
        sync_status: "NOT_SYNCED",
        tax_status: "TAX_EXCLUSIVE",
        vendor_id: vendorIds.get(spec.vendorKey),
      }, apiCalls);
      billsCreated += 1;
    }
    if (spec.history && !["PAID", "MARKED_AS_PAID"].includes(String(bill.status))) {
      try {
        await markBillPaid(token, String(bill.id), apiCalls);
        historyMarkedPaid += 1;
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : `Could not mark ${spec.externalId} as paid`);
      }
    }
  }

  return {
    message: billsCreated || vendorsCreated
      ? "Airwallex demo bills are ready"
      : "Airwallex demo bills already exist",
    vendorsCreated,
    billsCreated,
    historyMarkedPaid,
    warnings,
  };
}

function errorResponse(error: unknown, apiCalls: AirwallexApiTrace = []) {
  if (error instanceof AirwallexApiError) {
    return NextResponse.json({ error: error.message, code: error.code, details: error.details, apiCalls }, { status: error.status });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error", apiCalls }, { status: 500 });
}

export async function GET() {
  const apiCalls: AirwallexApiTrace = [];
  try {
    const token = await authenticateAirwallex(apiCalls);
    const state = await loadCases(token, apiCalls);
    return NextResponse.json({ cases: state.cases, beneficiaries: state.beneficiaryOptions, summary: state.summary, source: "AIRWALLEX_SANDBOX", apiCalls });
  } catch (error) {
    return errorResponse(error, apiCalls);
  }
}

export async function POST(request: NextRequest) {
  const apiCalls: AirwallexApiTrace = [];
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid or unsupported AP action" }, { status: 400 });
    const token = await authenticateAirwallex(apiCalls);

    // One Airwallex read per request, shared by every branch below.
    let cachedState: Awaited<ReturnType<typeof loadCases>> | null = null;
    const requestState = async () => {
      if (!cachedState) cachedState = await loadCases(token, apiCalls);
      return cachedState;
    };

    if (parsed.data.action === "reset_demo") {
      // Return the sandbox to the state a fresh demo starts from: forget every saved
      // decision, retire the open demo and intake bills, then lay the scenarios out again.
      const [resolutionsCleared, beneficiaryResolutionsCleared] = await Promise.all([
        clearAllApResolutions(),
        clearAllApBeneficiaryResolutions(),
      ]);

      const bills = await listBills(token, apiCalls);
      const retirable = bills.filter((bill) => {
        const externalId = String(bill.external_id || "");
        const isDemoBill = externalId.startsWith("AP-DEMO-") || externalId.startsWith("AP-INTAKE-");
        return isDemoBill && OPEN_STATUSES.has(String(bill.status || ""));
      });

      const warnings: string[] = [];
      let billsRetired = 0;
      for (const bill of retirable) {
        try {
          await markBillPaid(token, String(bill.id), apiCalls);
          billsRetired += 1;
        } catch (error) {
          warnings.push(error instanceof Error ? error.message : `Could not retire ${bill.invoice_number}`);
        }
      }

      const seeded = await seedDemoData(token, apiCalls);
      return NextResponse.json({
        action: "DEMO_RESET",
        resolutionsCleared,
        beneficiaryResolutionsCleared,
        billsRetired,
        billsCreated: seeded.billsCreated,
        message: `Demo reset: ${billsRetired} open bill${billsRetired === 1 ? "" : "s"} retired, ${resolutionsCleared + beneficiaryResolutionsCleared} saved decision${resolutionsCleared + beneficiaryResolutionsCleared === 1 ? "" : "s"} cleared, ${seeded.billsCreated} fresh bill${seeded.billsCreated === 1 ? "" : "s"} created.`,
        warnings: [...warnings, ...seeded.warnings],
        apiCalls,
      });
    }

    if (parsed.data.action === "seed") {
      return NextResponse.json({ ...await seedDemoData(token, apiCalls), apiCalls });
    }

    if (parsed.data.action === "inbox") {
      // Filed means THIS message produced a bill that is still open — not merely that some
      // bill somewhere carries the same invoice number, which was true of seeded demo data
      // the operator never touched.
      const bills = await listBills(token, apiCalls);
      const openIntakeBills = bills.filter((bill) =>
        String(bill.external_id || "").startsWith("AP-INTAKE-")
        && OPEN_STATUSES.has(String(bill.status || "")));

      return NextResponse.json({
        action: "INBOX",
        messages: listInboxMessages().map((message) => {
          const bill = openIntakeBills.find((candidate) =>
            String(candidate.external_id || "").startsWith(`AP-INTAKE-${message.id}-`));
          return {
            ...message,
            filed: Boolean(bill),
            filedAs: bill ? { id: String(bill.id), invoiceNumber: String(bill.invoice_number || "") } : null,
          };
        }),
        apiCalls,
      });
    }

    if (parsed.data.action === "intake") {
      const message = parsed.data.messageId ? findInboxMessage(parsed.data.messageId) : null;
      if (parsed.data.messageId && !message) {
        return NextResponse.json({ error: "That inbox message no longer exists", apiCalls }, { status: 404 });
      }
      const documentText = message?.body || parsed.data.documentText;
      if (!documentText) {
        return NextResponse.json({ error: "Choose an inbox message or paste invoice text", apiCalls }, { status: 400 });
      }
      const context = await loadIntakeContext(token, apiCalls);
      const extracted = await extractIntakeFields(documentText);
      const draft = buildIntakeDraft({
        extraction: extracted.extraction,
        rawText: documentText,
        vendors: context.vendors,
        supportedCurrencies: context.supportedCurrencies,
        source: extracted.source,
        model: extracted.model,
        fallbackReason: extracted.fallbackReason,
      });
      return NextResponse.json({
        action: "EXTRACTED",
        draft,
        sourceMessage: message
          ? { id: message.id, subject: message.subject, attachment: message.attachment, fromName: message.fromName, body: message.body }
          : { id: null, subject: null, attachment: null, fromName: null, body: documentText },
        knownVendors: context.vendors.map((vendor) => vendor.name),
        message: draft.readyToCreate
          ? "The invoice was read and every field passed server validation."
          : `The invoice was read. ${draft.blockers.length} field ${draft.blockers.length === 1 ? "needs" : "need"} attention before a bill can be created.`,
        apiCalls,
      });
    }

    if (parsed.data.action === "create_bill_from_intake") {
      if (!parsed.data.confirmed) {
        return NextResponse.json({ error: "Confirmed invoice fields are required", apiCalls }, { status: 400 });
      }
      // The client sends values, never decisions. Re-validate everything against live
      // Airwallex data before a bill record is created.
      const context = await loadIntakeContext(token, apiCalls);
      // A low-confidence read still has to clear a person. The client reports which
      // confidence it saw and whether the fields were reviewed; both are re-checked here,
      // and an unreviewed low-confidence draft is refused regardless of what it claims.
      if (parsed.data.messageId) {
        const existing = (await listBills(token, apiCalls)).find((bill) =>
          String(bill.external_id || "").startsWith(`AP-INTAKE-${parsed.data.messageId}-`)
          && OPEN_STATUSES.has(String(bill.status || "")));
        if (existing) {
          return NextResponse.json({
            error: `This message was already filed as ${existing.invoice_number}. Withdraw that bill first if you need to redo it.`,
            apiCalls,
          }, { status: 409 });
        }
      }

      const reportedConfidence = parsed.data.extractionConfidence || "HIGH";
      if (reportedConfidence === "LOW" && parsed.data.fieldsReviewed !== true) {
        return NextResponse.json({
          error: "This extraction was low confidence. Confirm each field against the document before creating the bill.",
          blockers: ["Low-confidence extraction: confirm each field against the document."],
          apiCalls,
        }, { status: 409 });
      }
      const draft = buildIntakeDraft({
        extraction: {
          ...parsed.data.confirmed,
          containsInstructionsToAgent: false,
          confidence: reportedConfidence === "LOW" ? "MEDIUM" : reportedConfidence,
          notes: [],
        },
        rawText: "",
        vendors: context.vendors,
        supportedCurrencies: context.supportedCurrencies,
        source: "SAFE_FALLBACK",
        model: null,
      });
      if (!draft.readyToCreate || !draft.vendor.vendorId) {
        return NextResponse.json({
          error: "Server validation rejected these invoice fields",
          blockers: draft.blockers,
          draft,
          apiCalls,
        }, { status: 409 });
      }

      const account = await getCurrentAccount(token, apiCalls);
      const legalEntityId = account.account_details?.legal_entity_id;
      if (!legalEntityId) throw new Error("Airwallex did not return a legal entity ID for bill setup");

      const bill = await createBill(token, {
        billing_currency: draft.currency.value,
        due_date: draft.dueDate.value,
        external_id: parsed.data.messageId
          ? `AP-INTAKE-${parsed.data.messageId.replace(/[^A-Za-z0-9-]/g, "")}-${randomUUID()}`
          : `AP-INTAKE-${randomUUID()}`,
        invoice_number: draft.invoiceNumber.value,
        issued_date: dateFromToday(0),
        legal_entity_id: legalEntityId,
        line_items: [{
          description: draft.description.value,
          quantity: "1",
          unit_price: (draft.amount.value as number).toFixed(2),
        }],
        request_id: randomUUID(),
        sync_status: "NOT_SYNCED",
        tax_status: "TAX_EXCLUSIVE",
        vendor_id: draft.vendor.vendorId,
      }, apiCalls);

      return NextResponse.json({
        action: "BILL_CREATED",
        billId: String(bill.id),
        message: `Bill ${draft.invoiceNumber.value} was created in Airwallex and entered the review queue.`,
        apiCalls,
      });
    }

    if (parsed.data.action === "triage") {
      const state = await requestState();
      const reviewableCases = state.cases
        .filter((item) => !["CONFIRMED_DUPLICATE", "DISPUTED_BILL"].includes(item.resolution?.action || ""))
        .filter((item) => item.beneficiaryResolution?.action !== "INCORRECT_VENDOR")
        .slice(0, 10);
      const results = await Promise.all(reviewableCases.map(async (item) => {
        const agent = await analyzeApBill(item.facts);
        return { action: "ANALYZED" as const, billId: item.id, agent };
      }));
      return NextResponse.json({
        action: "TRIAGED",
        results,
        analyzedAt: new Date().toISOString(),
        message: `${results.length} exception ${results.length === 1 ? "recommendation is" : "recommendations are"} ready.`,
        apiCalls,
      });
    }

    if (!parsed.data.billId) return NextResponse.json({ error: "billId is required", apiCalls }, { status: 400 });
    const state = await requestState();
    const billCase = state.cases.find((item) => item.id === parsed.data.billId);
    if (!billCase) return NextResponse.json({ error: "Open bill not found", apiCalls }, { status: 404 });

    if (parsed.data.action === "assistant") {
      if (!parsed.data.question) {
        return NextResponse.json({ error: "Ask a question about this bill", apiCalls }, { status: 400 });
      }
      const answer = await answerApQuestion(billCase.facts, parsed.data.question);
      return NextResponse.json({ action: "ASSISTANT_ANSWERED", billId: billCase.id, answer, apiCalls });
    }

    if (parsed.data.action === "discard_intake_bill") {
      // Only bills this app created by intake may be withdrawn, and only by marking them
      // paid — the Spend API has no delete, and nothing else should be touchable here.
      const raw = state.allBills.find((item) => String(item.id) === billCase.id);
      if (!String(raw?.external_id || "").startsWith("AP-INTAKE-")) {
        return NextResponse.json({ error: "Only bills created by invoice intake can be withdrawn", apiCalls }, { status: 409 });
      }
      await markBillPaid(token, billCase.id, apiCalls);
      await clearApResolution(billCase.id);
      await clearApBeneficiaryResolution(billCase.id);
      return NextResponse.json({
        action: "INTAKE_BILL_WITHDRAWN",
        billId: billCase.id,
        message: `${billCase.invoiceNumber || "The bill"} was withdrawn from the queue. No payment was made.`,
        apiCalls,
      });
    }

    if (parsed.data.action === "clear_resolution") {
      await clearApResolution(billCase.id);
      return NextResponse.json({
        action: "EXCEPTION_UPDATED",
        billId: billCase.id,
        resolution: null,
        message: "The case was reopened for review.",
        apiCalls,
      });
    }

    if (parsed.data.action === "clear_beneficiary_resolution") {
      await clearApBeneficiaryResolution(billCase.id);
      return NextResponse.json({
        action: "EXCEPTION_UPDATED",
        billId: billCase.id,
        resolution: null,
        message: "The beneficiary exception was reopened for review.",
        apiCalls,
      });
    }

    if (["confirm_duplicate", "override_duplicate", "request_information"].includes(parsed.data.action)) {
      if (!billCase.duplicateMatches.length) {
        return NextResponse.json({ error: "No matching bill is available for duplicate resolution", apiCalls }, { status: 409 });
      }
      const note = parsed.data.note?.trim() || "";
      if (parsed.data.action !== "confirm_duplicate" && note.length < 5) {
        return NextResponse.json({ error: "Add a short explanation before saving this decision", apiCalls }, { status: 400 });
      }
      const matchingBillId = parsed.data.matchingBillId || billCase.duplicateMatches[0].id;
      if (!billCase.duplicateMatches.some((match) => match.id === matchingBillId)) {
        return NextResponse.json({ error: "The selected matching bill is not part of this duplicate case", apiCalls }, { status: 400 });
      }
      const action = parsed.data.action === "confirm_duplicate"
        ? "CONFIRMED_DUPLICATE"
        : parsed.data.action === "override_duplicate"
          ? "NOT_DUPLICATE"
          : "REQUESTED_INFORMATION";
      const resolution = await saveApResolution({
        billId: billCase.id,
        action,
        note: note || "Invoice number and vendor match confirmed.",
        matchingBillId,
        actor: AUDIT_ACTOR,
      });
      return NextResponse.json({
        action: "EXCEPTION_UPDATED",
        billId: billCase.id,
        resolution,
        message: action === "CONFIRMED_DUPLICATE"
          ? "Duplicate confirmed. Payout validation remains blocked."
          : action === "NOT_DUPLICATE"
            ? "The duplicate flag was cleared with an audit explanation."
            : "The case is waiting for additional information.",
        apiCalls,
      });
    }

    if (["approve_variance", "request_amount_explanation", "dispute_bill"].includes(parsed.data.action)) {
      if (billCase.observedAmountChangePercent === null || billCase.observedAmountChangePercent < 25) {
        return NextResponse.json({ error: "This bill does not have a reviewable amount increase", apiCalls }, { status: 409 });
      }
      const note = parsed.data.note?.trim() || "";
      if (note.length < 5) {
        return NextResponse.json({ error: "Add a short explanation before saving this decision", apiCalls }, { status: 400 });
      }
      const action = parsed.data.action === "approve_variance"
        ? "APPROVED_VARIANCE"
        : parsed.data.action === "request_amount_explanation"
          ? "REQUESTED_AMOUNT_EXPLANATION"
          : "DISPUTED_BILL";
      const resolution = await saveApResolution({
        billId: billCase.id,
        action,
        note,
        actor: AUDIT_ACTOR,
      });
      return NextResponse.json({
        action: "EXCEPTION_UPDATED",
        billId: billCase.id,
        resolution,
        message: action === "APPROVED_VARIANCE"
          ? "The amount variance was approved with an audit explanation."
          : action === "REQUESTED_AMOUNT_EXPLANATION"
            ? "The case is waiting for an explanation of the amount change."
            : "The bill was marked as disputed and payout validation remains blocked.",
        apiCalls,
      });
    }

    if (["match_beneficiary", "request_beneficiary_setup", "incorrect_vendor"].includes(parsed.data.action)) {
      if (billCase.facts.beneficiaryId && !billCase.beneficiaryResolution) {
        return NextResponse.json({ error: "This bill already has an automatically verified beneficiary", apiCalls }, { status: 409 });
      }

      const note = parsed.data.note?.trim() || "";
      if (parsed.data.action !== "match_beneficiary" && note.length < 5) {
        return NextResponse.json({ error: "Add a short explanation before saving this decision", apiCalls }, { status: 400 });
      }

      const beneficiary = parsed.data.action === "match_beneficiary"
        ? state.beneficiaryOptions.find((option) => option.id === parsed.data.beneficiaryId)
        : undefined;
      if (parsed.data.action === "match_beneficiary" && !beneficiary) {
        return NextResponse.json({ error: "Select a current Airwallex beneficiary before saving", apiCalls }, { status: 400 });
      }

      const action = parsed.data.action === "match_beneficiary"
        ? "MATCHED_BENEFICIARY"
        : parsed.data.action === "request_beneficiary_setup"
          ? "REQUESTED_BENEFICIARY_SETUP"
          : "INCORRECT_VENDOR";
      const resolution = await saveApBeneficiaryResolution({
        billId: billCase.id,
        action,
        beneficiaryId: beneficiary?.id,
        beneficiaryName: beneficiary?.name,
        note: note || `Matched to the existing Airwallex beneficiary ${beneficiary?.name}.`,
        actor: AUDIT_ACTOR,
      });

      let analysis = null;
      if (action === "MATCHED_BENEFICIARY") {
        const updatedState = await loadCases(token, apiCalls);  // deliberate: the match just changed the facts
        const updatedCase = updatedState.cases.find((item) => item.id === billCase.id);
        if (updatedCase) {
          const agent = await analyzeApBill(updatedCase.facts);
          analysis = { action: "ANALYZED", billId: updatedCase.id, agent };
        }
      }

      return NextResponse.json({
        action: "EXCEPTION_UPDATED",
        billId: billCase.id,
        resolution,
        analysis,
        message: action === "MATCHED_BENEFICIARY"
          ? "The approved beneficiary was matched and payout eligibility was rechecked."
          : action === "REQUESTED_BENEFICIARY_SETUP"
            ? "Beneficiary setup was assigned to Vendor Operations. The demo did not contact the vendor or collect bank details."
            : "The bill was flagged for vendor correction and payout validation remains blocked.",
        apiCalls,
      });
    }

    const expected = expectedRecommendation(billCase.facts);
    if (expected !== "READY_TO_VALIDATE") {
      return NextResponse.json({
        error: "Server guardrails blocked payout validation until this exception is resolved",
        expectedRecommendation: expected,
        apiCalls,
      }, { status: 409 });
    }
    if (!billCase.facts.beneficiaryId || !billCase.facts.transferMethod || !billCase.facts.sourceCurrency) {
      return NextResponse.json({ error: "A verified beneficiary payout route is required", apiCalls }, { status: 409 });
    }

    await validateTransfer(token, {
      beneficiary_id: billCase.facts.beneficiaryId,
      transfer_amount: String(billCase.amount),
      transfer_currency: billCase.facts.payoutCurrency || billCase.currency,
      transfer_method: billCase.facts.transferMethod,
      reason: billCase.facts.transferReason || "Payroll",
      reference: billCase.invoiceNumber.slice(0, 35),
      request_id: randomUUID(),
      source_currency: billCase.facts.sourceCurrency,
    }, apiCalls);
    return NextResponse.json({
      action: "VALIDATED",
      billId: billCase.id,
      airwallex: {
        status: "VALIDATED",
        transferAmount: billCase.amount,
        transferCurrency: billCase.facts.payoutCurrency || billCase.currency,
        sourceCurrency: billCase.facts.sourceCurrency,
        requiredSourceAmount: billCase.facts.requiredSourceAmount,
        fxRate: billCase.facts.fxRate,
        fxQuotedAt: billCase.facts.fxQuotedAt,
        beneficiaryName: billCase.facts.beneficiaryName,
      },
      message: "Airwallex validated the payout instructions. No transfer was created.",
      apiCalls,
    });
  } catch (error) {
    return errorResponse(error, apiCalls);
  }
}
