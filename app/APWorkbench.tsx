"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apQueueStatus, type ApQueueStatus } from "../lib/ap-case-status";

type RecommendationCode =
  | "READY_TO_VALIDATE"
  | "REVIEW_DUPLICATE"
  | "REVIEW_AMOUNT_CHANGE"
  | "MISSING_BENEFICIARY"
  | "BENEFICIARY_CURRENCY_MISMATCH"
  | "INSUFFICIENT_FUNDS"
  | "REQUEST_INFORMATION";

type Recommendation = {
  source: "AI_GATEWAY" | "SAFE_FALLBACK";
  model: string | null;
  fallbackReason?: string;
  recommendation: RecommendationCode;
  priority: "LOW" | "MEDIUM" | "HIGH";
  suggestedCategory: string;
  summary: string;
  reasons: string[];
  questionForSubmitter: string | null;
  requiresHuman: boolean;
  confidence: "LOW" | "MEDIUM" | "HIGH";
};

type Facts = {
  duplicateBillIds: string[];
  duplicateMatchReasons: string[];
  previousAmounts: number[];
  averagePreviousAmount: number | null;
  amountChangePercent: number | null;
  beneficiaryId: string | null;
  beneficiaryName: string | null;
  transferRouteAvailable: boolean;
  transferMethod: string | null;
  payoutCurrency: string | null;
  sourceCurrency: string | null;
  availableSourceBalance: number;
  requiredSourceAmount: number | null;
  fxRate: number | null;
  fxQuotedAt: string | null;
  hasSufficientBalance: boolean;
};

type BillCase = {
  id: string;
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
  facts: Facts;
  duplicateMatches: Array<{
    id: string;
    invoiceNumber: string;
    amount: number;
    currency: string;
    issuedDate: string;
    dueDate: string;
    status: string;
    matchType: "INVOICE_NUMBER" | "AMOUNT_AND_DATE";
    matchReason: string;
  }>;
  previousBills: Array<{
    id: string;
    invoiceNumber: string;
    amount: number;
    currency: string;
    issuedDate: string;
    status: string;
  }>;
  resolution: {
    billId: string;
    action: "CONFIRMED_DUPLICATE" | "NOT_DUPLICATE" | "REQUESTED_INFORMATION" | "APPROVED_VARIANCE" | "REQUESTED_AMOUNT_EXPLANATION" | "DISPUTED_BILL";
    note: string;
    matchingBillId: string | null;
    actor: string;
    updatedAt: string;
  } | null;
  beneficiaryResolution: {
    billId: string;
    action: "MATCHED_BENEFICIARY" | "REQUESTED_BENEFICIARY_SETUP" | "INCORRECT_VENDOR";
    beneficiaryId: string | null;
    beneficiaryName: string | null;
    note: string;
    actor: string;
    updatedAt: string;
  } | null;
  serverRecommendation: Recommendation;
};

type BeneficiaryOption = {
  id: string;
  name: string;
  transferMethod: string | null;
  payoutCurrency: string | null;
  bankCountry: string | null;
  routeAvailable: boolean;
};

type Workspace = {
  cases: BillCase[];
  beneficiaries: BeneficiaryOption[];
  summary: { open: number; needsAttention: number; ready: number; onHold: number; closed: number; totalValue: number };
  source: string;
  apiCalls: ApiCall[];
};

type ApiCall = {
  method: string;
  endpoint: string;
  status: number;
  durationMs: number;
  outcome: "SUCCESS" | "ERROR";
  occurredAt: string;
};

type LoggedApiCall = ApiCall & {
  key: string;
  operation: "REFRESH" | "SEED" | "ANALYZE" | "ASSISTANT" | "VALIDATE" | "RESOLVE" | "INTAKE";
};

type AssistantAnswer = {
  source: "AI_GATEWAY" | "SAFE_FALLBACK";
  model: string | null;
  fallbackReason?: string;
  answer: string;
  grounding: "VERIFIED_FACTS_ONLY" | "UNVERIFIED_CONTEXT_CONSIDERED";
  recommendation: RecommendationCode;
  requiresHuman: boolean;
  suggestedFollowUp: string | null;
};

type AssistantMessage = {
  id: string;
  role: "USER" | "ASSISTANT";
  text: string;
  label: string;
  source?: AssistantAnswer["source"];
};

type IntakeFieldStatus = "OK" | "MISSING" | "REJECTED";

type IntakeField<T> = { value: T | null; status: IntakeFieldStatus; detail: string };

type IntakeDraft = {
  vendor: IntakeField<string> & { vendorId: string | null; matchedVendorName: string | null };
  invoiceNumber: IntakeField<string>;
  amount: IntakeField<number>;
  currency: IntakeField<string>;
  dueDate: IntakeField<string>;
  description: IntakeField<string>;
  readyToCreate: boolean;
  blockers: string[];
  flaggedText: string | null;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  requiresFieldReview: boolean;
  injectionSuspected: boolean;
  source: "AI_GATEWAY" | "SAFE_FALLBACK";
  model: string | null;
  fallbackReason?: string;
  extractionNotes: string[];
};

type InboxMessage = {
  id: string;
  from: string;
  fromName: string;
  subject: string;
  receivedAt: string;
  attachment: string;
  invoiceNumber: string;
  filed: boolean;
  filedAs: { id: string; invoiceNumber: string } | null;
};

type ConfirmedIntake = {
  vendorName: string;
  invoiceNumber: string;
  amount: string;
  currency: string;
  dueDate: string;
  description: string;
};

const SAMPLE_INVOICE = `From: billing@northstarcloud.example
Subject: Invoice NC-1043 from Northstar Cloud

Hi Accounts Payable,

Please find the invoice for last month's usage below.

Vendor: Northstar Cloud
Invoice Number: NC-1043
Description: Cloud infrastructure subscription
Total Due: USD 142.00
Due Date: 2026-10-15

Thanks,
Northstar Cloud Billing`;

type ApAction = "reset_demo" | "validate" | "discard_intake_bill" | "confirm_duplicate" | "override_duplicate" | "request_information" | "approve_variance" | "request_amount_explanation" | "dispute_bill" | "match_beneficiary" | "request_beneficiary_setup" | "incorrect_vendor" | "clear_resolution" | "clear_beneficiary_resolution";

type AnalysisResult = {
  action: "ANALYZED";
  billId: string;
  agent: Recommendation;
};

type PayoutResult = {
  action: "VALIDATED";
  billId: string;
  airwallex: {
    status: "VALIDATED";
    transferAmount: number;
    transferCurrency: string;
    sourceCurrency: string;
    requiredSourceAmount: number | null;
    fxRate: number | null;
    fxQuotedAt: string | null;
    beneficiaryName: string;
  };
  message: string;
};

const recommendationLabels: Record<RecommendationCode, string> = {
  READY_TO_VALIDATE: "Ready to validate",
  REVIEW_DUPLICATE: "Possible duplicate",
  REVIEW_AMOUNT_CHANGE: "Amount changed",
  MISSING_BENEFICIARY: "Beneficiary missing",
  BENEFICIARY_CURRENCY_MISMATCH: "Currency mismatch",
  INSUFFICIENT_FUNDS: "Insufficient funds",
  REQUEST_INFORMATION: "Information needed",
};

type QueueFilter = "ALL" | ApQueueStatus;

const queueFilterLabels: Record<QueueFilter, string> = {
  ALL: "All",
  ATTENTION: "Needs attention",
  READY: "Ready",
  ON_HOLD: "On hold",
  CLOSED: "Closed",
};

const operationLabels: Record<LoggedApiCall["operation"], string> = {
  REFRESH: "Bill refresh",
  SEED: "Demo setup",
  ANALYZE: "Agent review",
  ASSISTANT: "Assistant question",
  VALIDATE: "Payout validation",
  RESOLVE: "Exception resolution",
  INTAKE: "Invoice intake",
};

const apiOperationByAction: Record<ApAction, LoggedApiCall["operation"]> = {
  reset_demo: "SEED",
  validate: "VALIDATE",
  discard_intake_bill: "INTAKE",
  confirm_duplicate: "RESOLVE",
  override_duplicate: "RESOLVE",
  request_information: "RESOLVE",
  approve_variance: "RESOLVE",
  request_amount_explanation: "RESOLVE",
  dispute_bill: "RESOLVE",
  match_beneficiary: "RESOLVE",
  request_beneficiary_setup: "RESOLVE",
  incorrect_vendor: "RESOLVE",
  clear_resolution: "RESOLVE",
  clear_beneficiary_resolution: "RESOLVE",
};

function tagApiCalls(calls: ApiCall[], operation: LoggedApiCall["operation"]) {
  const receivedAt = Date.now();
  return calls.map((call, index): LoggedApiCall => ({
    ...call,
    operation,
    key: `${call.occurredAt}-${call.method}-${call.endpoint}-${receivedAt}-${index}`,
  }));
}

const money = (value: number, currency = "USD") => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency,
  maximumFractionDigits: 2,
}).format(value);

const shortDate = (value: string) => {
  if (!value) return "Not provided";

  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T12:00:00Z`
    : value.includes(" ") && !value.endsWith("Z")
      ? `${value.replace(" ", "T")}Z`
      : value;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return "Not provided";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
};

function fundingSummary(facts: Facts) {
  if (!facts.sourceCurrency || facts.requiredSourceAmount === null) return "Checked after beneficiary matching";
  if (facts.sourceCurrency === facts.payoutCurrency) {
    return `${money(facts.availableSourceBalance, facts.sourceCurrency)} available in the ${facts.sourceCurrency} wallet`;
  }
  return `${money(facts.requiredSourceAmount, facts.sourceCurrency)} from ${facts.sourceCurrency} at ${facts.fxRate} — ${money(facts.availableSourceBalance, facts.sourceCurrency)} available`;
}

const ACTOR_NAME = "Demo operator";
const ACTOR_ROLE = "Unauthenticated session";

function fundingHeadline(airwallex: PayoutResult["airwallex"]) {
  const payout = money(airwallex.transferAmount, airwallex.transferCurrency);
  if (airwallex.sourceCurrency === airwallex.transferCurrency) {
    return `Funding ${payout} from the ${airwallex.sourceCurrency} wallet`;
  }
  return `Funding ${payout} from ${airwallex.sourceCurrency}`;
}

function fundingDetail(airwallex: PayoutResult["airwallex"], facts: Facts) {
  if (airwallex.sourceCurrency === airwallex.transferCurrency) {
    return `Same-currency funding — no conversion required. ${money(facts.availableSourceBalance, airwallex.sourceCurrency)} available.`;
  }
  const required = airwallex.requiredSourceAmount === null ? "—" : money(airwallex.requiredSourceAmount, airwallex.sourceCurrency);
  return `${required} at ${airwallex.fxRate}, quoted ${shortDate(airwallex.fxQuotedAt || "")}. ${money(facts.availableSourceBalance, airwallex.sourceCurrency)} available.`;
}

function decisionTrail(bill: BillCase, payout: PayoutResult) {
  const trail: Array<{ title: string; detail: string }> = [];
  if (bill.id) {
    trail.push({
      title: "Bill recorded in Airwallex",
      detail: `${bill.invoiceNumber || "This bill"} · ${bill.vendor} · ${money(bill.amount, bill.currency)}, due ${shortDate(bill.dueDate)}.`,
    });
  }
  if (bill.observedAmountChangePercent !== null && bill.observedAmountChangePercent >= 25) {
    trail.push({
      title: "Amount exception raised",
      detail: `${Math.round(bill.observedAmountChangePercent)}% above the prior average across ${bill.previousBills.length} bill${bill.previousBills.length === 1 ? "" : "s"}. Server blocked payout validation.`,
    });
  }
  if (bill.duplicateMatches.length) {
    trail.push({
      title: "Duplicate exception raised",
      detail: `${bill.duplicateMatches.length} matching vendor and invoice number found in Airwallex.`,
    });
  }
  for (const resolution of [bill.resolution, bill.beneficiaryResolution]) {
    if (!resolution) continue;
    trail.push({
      title: `Resolved by a person — ${resolution.action.replaceAll("_", " ").toLowerCase()}`,
      detail: `“${resolution.note}” — ${resolution.actor}, ${shortDate(resolution.updatedAt)}.`,
    });
  }
  trail.push({
    title: "Payout instructions validated",
    detail: `POST /api/v1/transfers/validate → ${payout.airwallex.status}. Beneficiary route and funding confirmed by Airwallex.`,
  });
  return trail;
}

/** Bills this session created by pasting an invoice can be withdrawn again. */
function selective(bill: BillCase) {
  return bill.arrivedByIntake;
}

/**
 * Splits a document so the flagged sentence can be marked in place. The quote comes back
 * as one line while the document may wrap it across several, so whitespace is matched
 * loosely rather than literally.
 */
function highlightParts(body: string, flagged: string | null) {
  const plain = [{ text: body, flagged: false }];
  if (!flagged) return plain;

  const pattern = flagged
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  const match = new RegExp(pattern, "i").exec(body);
  if (!match) return plain;

  return [
    { text: body.slice(0, match.index), flagged: false },
    { text: match[0], flagged: true },
    { text: body.slice(match.index + match[0].length), flagged: false },
  ].filter((part) => part.text.length > 0);
}

/**
 * The three shortcuts and the placeholder have to match the decision on screen:
 * "Why was this flagged?" is nonsense on a bill that passed every check.
 */
function assistantPromptsFor(code: RecommendationCode | undefined) {
  switch (code) {
    case "READY_TO_VALIDATE":
      return {
        placeholder: "Example: Anything about this vendor I should know before validating?",
        chips: [
          { label: "What was checked?", question: "Which checks did this bill pass, and what did each one verify?" },
          { label: "How is it funded?", question: "Which wallet funds this payout, and is any currency conversion involved?" },
          { label: "What does validating do?", question: "What happens when I validate this payout, and what does it not do?" },
        ],
      };
    case "REVIEW_DUPLICATE":
      return {
        placeholder: "Example: The vendor says the first invoice was cancelled. Is that enough?",
        chips: [
          { label: "Why was this flagged?", question: "Why was this bill flagged as a possible duplicate?" },
          { label: "How do the two compare?", question: "How does this bill differ from the one it matched?" },
          { label: "Draft a request", question: "Draft a request asking the submitter to confirm whether this is a resubmission." },
        ],
      };
    case "MISSING_BENEFICIARY":
      return {
        placeholder: "Example: Vendor Ops say the beneficiary was set up last week. Is that enough?",
        chips: [
          { label: "Why is it blocked?", question: "Why can this bill not be paid yet?" },
          { label: "What would unblock it?", question: "What exactly is needed to establish a payout route for this vendor?" },
          { label: "Draft a request", question: "Draft a request asking Vendor Operations to complete verified beneficiary setup." },
        ],
      };
    case "BENEFICIARY_CURRENCY_MISMATCH":
      return {
        placeholder: "Example: The vendor says they now invoice in USD. Is that enough?",
        chips: [
          { label: "What is the mismatch?", question: "Which currency is this bill in, and which currency is the beneficiary paid in?" },
          { label: "What would resolve it?", question: "What would resolve the currency mismatch on this bill?" },
          { label: "Draft a request", question: "Draft a request asking the vendor to confirm which currency they should be paid in." },
        ],
      };
    case "INSUFFICIENT_FUNDS":
      return {
        placeholder: "Example: Treasury say a top-up lands tomorrow. Is that enough?",
        chips: [
          { label: "How much is short?", question: "How much is needed, in which currency, and what is available?" },
          { label: "Could another wallet fund it?", question: "Could any other wallet fund this payout, and at what rate?" },
          { label: "Draft a request", question: "Draft a request asking Treasury to fund the wallet for this payout." },
        ],
      };
    case "REQUEST_INFORMATION":
      return {
        placeholder: "Example: The submitter says the PO number is on the attachment. Is that enough?",
        chips: [
          { label: "What is missing?", question: "What information is missing from this bill?" },
          { label: "Why does it matter?", question: "Why is the missing information needed before payment?" },
          { label: "Draft a request", question: "Draft a request asking the submitter for the missing invoice information." },
        ],
      };
    case "REVIEW_AMOUNT_CHANGE":
      return {
        placeholder: "Example: The submitter says usage increased after launch. Is that enough?",
        chips: [
          { label: "Why was this flagged?", question: "Why was this bill flagged for an amount change?" },
          { label: "What evidence would clear it?", question: "What evidence would clear this amount exception?" },
          { label: "Draft a request", question: "Draft a request asking the submitter to explain the increase." },
        ],
      };
    default:
      // A recommendation with no tailored prompts still gets questions that fit any bill.
      return {
        placeholder: "Example: Is there anything here I should check before deciding?",
        chips: [
          { label: "What was checked?", question: "Which checks ran on this bill, and what did each one find?" },
          { label: "What happens next?", question: "What is the safest next step for this bill, and why?" },
          { label: "Draft a request", question: "Draft a request for the submitter about this bill." },
        ],
      };
  }
}

function relativeTime(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "";
  const hours = Math.round((Date.now() - parsed) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "—";
}

type ReasonTone = "pass" | "blocked" | "review" | "unchecked";

const reasonIcons: Record<ReasonTone, string> = {
  pass: "✓",
  blocked: "×",
  review: "!",
  unchecked: "—",
};

function reasonTone(reason: string, bill: BillCase | null): ReasonTone {
  if (!bill) return "unchecked";

  const normalized = reason.toLowerCase();
  const facts = bill.facts;

  if (/fund|wallet|balance/.test(normalized)) {
    if (!facts.beneficiaryId || !facts.transferRouteAvailable || !facts.sourceCurrency) return "unchecked";
    return facts.hasSufficientBalance ? "pass" : "blocked";
  }

  if (/beneficiary|payout route|transfer route/.test(normalized)) {
    return facts.beneficiaryId && facts.transferRouteAvailable ? "pass" : "blocked";
  }

  if (/duplicate|matching (bill|invoice)/.test(normalized)) {
    return facts.duplicateBillIds.length > 0 ? "blocked" : "pass";
  }

  if (/amount|prior average|increase|variance/.test(normalized)) {
    return facts.amountChangePercent !== null && facts.amountChangePercent >= 25 ? "review" : "pass";
  }

  if (/invoice number|description|missing information/.test(normalized)) {
    return bill.invoiceNumber.trim() && bill.description.trim() ? "pass" : "blocked";
  }

  return "unchecked";
}

export default function APWorkbench() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [payout, setPayout] = useState<PayoutResult | null>(null);
  const [filter, setFilter] = useState<QueueFilter>("ALL");
  const [loading, setLoading] = useState("Connecting to Airwallex Sandbox…");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [apiActivity, setApiActivity] = useState<LoggedApiCall[]>([]);
  const [resolutionMode, setResolutionMode] = useState<"COMPARE" | "OVERRIDE" | "REQUEST" | "APPROVE_VARIANCE" | "REQUEST_AMOUNT" | "DISPUTE" | "MATCH_BENEFICIARY" | "REQUEST_BENEFICIARY" | "INCORRECT_VENDOR" | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [selectedBeneficiaryId, setSelectedBeneficiaryId] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [stage, setStage] = useState<"INTAKE" | "REVIEW" | "DECISION">("REVIEW");
  const [intakeText, setIntakeText] = useState("");
  const [intakeDraft, setIntakeDraft] = useState<IntakeDraft | null>(null);
  const [confirmed, setConfirmed] = useState<ConfirmedIntake | null>(null);
  const [fieldsReviewed, setFieldsReviewed] = useState(false);
  const [inbox, setInbox] = useState<InboxMessage[] | null>(null);
  const [sourceDoc, setSourceDoc] = useState<{ attachment: string | null; fromName: string | null; body: string } | null>(null);
  const [openMessageId, setOpenMessageId] = useState<string | null>(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [assistantQuestion, setAssistantQuestion] = useState("");
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [triageAnalyses, setTriageAnalyses] = useState<Record<string, AnalysisResult>>({});
  const [triageStatus, setTriageStatus] = useState<"IDLE" | "RUNNING" | "COMPLETE" | "ERROR">("IDLE");

  const refresh = useCallback(async (operation: LoggedApiCall["operation"] = "REFRESH") => {
    const response = await fetch("/api/ap", { cache: "no-store" });
    const body = await response.json();
    setApiActivity((current) => [...current, ...tagApiCalls(body.apiCalls || [], operation)].slice(-60));
    if (!response.ok) throw new Error(body.error || "Could not load Airwallex bills");
    setWorkspace(body);
    setSelectedId((current) => {
      if (body.cases.some((item: BillCase) => item.id === current)) return current;
      const preferred = body.cases.find((item: BillCase) => (
        !["CONFIRMED_DUPLICATE", "DISPUTED_BILL"].includes(item.resolution?.action || "")
        && item.beneficiaryResolution?.action !== "INCORRECT_VENDOR"
        && item.serverRecommendation.recommendation !== "READY_TO_VALIDATE"
      ));
      return preferred?.id || body.cases[0]?.id || null;
    });
    setAnalysis(null);

    setTriageStatus("RUNNING");
    try {
      const triageResponse = await fetch("/api/ap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "triage" }),
      });
      const triageBody = await triageResponse.json();
      setApiActivity((current) => [...current, ...tagApiCalls(triageBody.apiCalls || [], "ANALYZE")].slice(-60));
      if (!triageResponse.ok) throw new Error(triageBody.error || "Automatic triage failed");
      setTriageAnalyses(Object.fromEntries((triageBody.results as AnalysisResult[]).map((result) => [result.billId, result])));
      setTriageStatus("COMPLETE");
    } catch {
      setTriageAnalyses({});
      setTriageStatus("ERROR");
    }
  }, []);

  const loadInbox = useCallback(async () => {
    const response = await fetch("/api/ap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "inbox" }),
    });
    const body = await response.json();
    setApiActivity((current) => [...current, ...tagApiCalls(body.apiCalls || [], "INTAKE")].slice(-60));
    if (response.ok) setInbox(body.messages as InboxMessage[]);
  }, []);

  useEffect(() => {
    // Initial synchronization with the external Airwallex Sandbox.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh()
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load bills"))
      .finally(() => setLoading(""));
  }, [refresh]);

  async function post(action: ApAction, billId?: string, extra: { note?: string; matchingBillId?: string; beneficiaryId?: string } = {}) {
    const labels = {
      reset_demo: "Resetting the demo…",
      validate: "Validating payout with Airwallex…",
      discard_intake_bill: "Withdrawing the bill…",
      confirm_duplicate: "Saving duplicate decision…",
      override_duplicate: "Saving exception explanation…",
      request_information: "Saving information request…",
      approve_variance: "Saving variance approval…",
      request_amount_explanation: "Saving explanation request…",
      dispute_bill: "Saving dispute decision…",
      match_beneficiary: "Matching the approved beneficiary…",
      request_beneficiary_setup: "Saving beneficiary setup request…",
      incorrect_vendor: "Saving vendor correction…",
      clear_resolution: "Reopening exception…",
      clear_beneficiary_resolution: "Reopening beneficiary exception…",
    };
    setLoading(labels[action]);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/ap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(billId ? { billId } : {}), ...extra }),
      });
      const body = await response.json();
      setApiActivity((current) => [...current, ...tagApiCalls(body.apiCalls || [], apiOperationByAction[action])].slice(-60));
      if (!response.ok) throw new Error(body.error || "Action failed");
      if (action === "reset_demo") {
        setAssistantMessages([]);
        setNotice(body.message);
        setAnalysis(null);
        setPayout(null);
        setTriageAnalyses({});
        setIntakeDraft(null);
        setConfirmed(null);
        setSourceDoc(null);
        setInbox(null);
        setStage("REVIEW");
        await refresh();
      } else if (action === "validate") {
        setPayout(body);
        setStage("DECISION");
      } else {
        setAssistantMessages([]);
        setNotice(body.message);
        setResolutionMode(null);
        setResolutionNote("");
        setSelectedBeneficiaryId("");
        setAnalysis(null);
        setPayout(null);
        await refresh("RESOLVE");
        if (body.analysis) setAnalysis(body.analysis);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action failed");
    } finally {
      setLoading("");
    }
  }

  function openIntake() {
    setStage("INTAKE");
    if (inbox === null) loadInbox().catch(() => setInbox([]));
  }

  async function runIntake(messageId?: string) {
    setLoading(messageId ? "Reading the invoice…" : "Reading the pasted invoice…");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/ap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(messageId ? { action: "intake", messageId } : { action: "intake", documentText: intakeText }),
      });
      const body = await response.json();
      setApiActivity((current) => [...current, ...tagApiCalls(body.apiCalls || [], "INTAKE")].slice(-60));
      if (!response.ok) throw new Error(body.error || "Could not read the invoice");
      const draft = body.draft as IntakeDraft;
      setIntakeDraft(draft);
      setSourceDoc(body.sourceMessage || null);
      setOpenMessageId(messageId || null);
      setFieldsReviewed(false);
      setConfirmed({
        vendorName: draft.vendor.matchedVendorName || draft.vendor.value || "",
        invoiceNumber: draft.invoiceNumber.value || "",
        amount: draft.amount.value === null ? "" : String(draft.amount.value),
        currency: draft.currency.value || "",
        dueDate: draft.dueDate.value || "",
        description: draft.description.value || "",
      });
      setNotice(body.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the invoice");
    } finally {
      setLoading("");
    }
  }

  async function createBillFromIntake() {
    if (!confirmed) return;
    setLoading("Creating the bill in Airwallex…");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/ap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_bill_from_intake",
          confirmed: { ...confirmed, amount: Number(confirmed.amount) },
          extractionConfidence: intakeDraft?.confidence,
          fieldsReviewed,
          ...(openMessageId ? { messageId: openMessageId } : {}),
        }),
      });
      const body = await response.json();
      setApiActivity((current) => [...current, ...tagApiCalls(body.apiCalls || [], "INTAKE")].slice(-60));
      if (!response.ok) {
        if (body.draft) setIntakeDraft(body.draft as IntakeDraft);
        throw new Error(body.blockers?.join(" ") || body.error || "The bill could not be created");
      }
      setNotice(body.message);
      setIntakeDraft(null);
      setConfirmed(null);
      setFieldsReviewed(false);
      setIntakeText("");
      setSourceDoc(null);
      setOpenMessageId(null);
      setStage("REVIEW");
      await Promise.all([refresh("INTAKE"), loadInbox()]);
      setSelectedId(body.billId);
      setAnalysis(null);
      setPayout(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The bill could not be created");
    } finally {
      setLoading("");
    }
  }

  async function askAssistant(question: string, label = "Unverified context") {
    if (!selected || !currentAnalysis || !question.trim() || assistantLoading) return;
    const userMessage: AssistantMessage = {
      id: `user-${selected.id}-${assistantMessages.length}`,
      role: "USER",
      text: question.trim(),
      label,
    };
    setAssistantMessages((current) => [...current, userMessage]);
    setAssistantQuestion("");
    setAssistantLoading(true);
    setError("");
    try {
      const response = await fetch("/api/ap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assistant", billId: selected.id, question: question.trim() }),
      });
      const body = await response.json();
      setApiActivity((current) => [...current, ...tagApiCalls(body.apiCalls || [], "ASSISTANT")].slice(-60));
      if (!response.ok) throw new Error(body.error || "The assistant could not answer");
      const answer = body.answer as AssistantAnswer;
      setAssistantMessages((current) => [...current, {
        id: `assistant-${selected.id}-${current.length}`,
        role: "ASSISTANT",
        text: answer.answer,
        label: answer.grounding === "UNVERIFIED_CONTEXT_CONSIDERED" ? "Unverified context considered" : "Verified facts",
        source: answer.source,
      }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The assistant could not answer");
    } finally {
      setAssistantLoading(false);
    }
  }

  const openMessage = openMessageId ? (inbox || []).find((message) => message.id === openMessageId) || null : null;

  const confirmedComplete = Boolean(
    confirmed
    && confirmed.vendorName.trim()
    && confirmed.invoiceNumber.trim()
    && confirmed.currency.trim()
    && confirmed.dueDate.trim()
    && confirmed.description.trim()
    && Number(confirmed.amount) > 0,
  );

  const filteredCases = useMemo(() => {
    const cases = workspace?.cases || [];
    return filter === "ALL" ? cases : cases.filter((item) => apQueueStatus(item) === filter);
  }, [workspace, filter]);

  const selected = workspace?.cases.find((item) => item.id === selectedId) || filteredCases[0] || null;
  const assistantPrompts = assistantPromptsFor(selected?.serverRecommendation.recommendation);
  const currentAnalysis = analysis?.billId === selected?.id
    ? analysis
    : selected ? triageAnalyses[selected.id] || null : null;
  const currentPayout = payout?.billId === selected?.id ? payout : null;
  const recommendation = currentAnalysis?.agent;
  const triageResults = Object.values(triageAnalyses);
  const triageUsesLiveModel = triageResults.some((result) => result.agent.source === "AI_GATEWAY");
  const isReady = selected?.serverRecommendation.recommendation === "READY_TO_VALIDATE";
  const matchingBill = selected?.duplicateMatches[0] || null;
  const duplicateResolution = selected?.resolution && ["CONFIRMED_DUPLICATE", "NOT_DUPLICATE", "REQUESTED_INFORMATION"].includes(selected.resolution.action)
    ? selected.resolution
    : null;
  const amountResolution = selected?.resolution && ["APPROVED_VARIANCE", "REQUESTED_AMOUNT_EXPLANATION", "DISPUTED_BILL"].includes(selected.resolution.action)
    ? selected.resolution
    : null;
  const beneficiaryResolution = selected?.beneficiaryResolution || null;
  const duplicateCheckTone = duplicateResolution?.action === "NOT_DUPLICATE"
    ? "pass"
    : duplicateResolution?.action === "REQUESTED_INFORMATION"
      ? "warn"
      : selected?.duplicateMatches.length ? "fail" : "pass";
  const duplicateCheckText = duplicateResolution?.action === "CONFIRMED_DUPLICATE"
    ? `Confirmed by ${duplicateResolution.actor}`
    : duplicateResolution?.action === "NOT_DUPLICATE"
      ? `Cleared with explanation by ${duplicateResolution.actor}`
      : duplicateResolution?.action === "REQUESTED_INFORMATION"
        ? "Waiting for additional information"
        : selected?.duplicateMatches.length
          ? `${selected.duplicateMatches.length} matching bill found`
          : "No matching vendor and invoice number";
  const amountCheckTone = amountResolution?.action === "APPROVED_VARIANCE"
    ? "pass"
    : amountResolution?.action === "REQUESTED_AMOUNT_EXPLANATION"
      ? "warn"
      : selected?.observedAmountChangePercent !== null && selected?.observedAmountChangePercent >= 25 ? "warn" : "pass";
  const amountCheckText = amountResolution?.action === "APPROVED_VARIANCE"
    ? `${selected?.observedAmountChangePercent}% increase approved by ${amountResolution.actor}`
    : amountResolution?.action === "REQUESTED_AMOUNT_EXPLANATION"
      ? "Waiting for an explanation of the increase"
      : amountResolution?.action === "DISPUTED_BILL"
        ? `Disputed by ${amountResolution.actor}`
        : selected?.facts.averagePreviousAmount === null
          ? "No previous comparable bill"
          : `${selected?.observedAmountChangePercent}% vs ${money(selected?.facts.averagePreviousAmount || 0, selected?.currency)} prior average`;
  const beneficiaryCheckTone = selected?.facts.transferRouteAvailable
    ? "pass"
    : beneficiaryResolution?.action === "INCORRECT_VENDOR"
      ? "fail"
      : beneficiaryResolution?.action === "REQUESTED_BENEFICIARY_SETUP"
        ? "warn"
        : "warn";
  const beneficiaryCheckText = selected?.facts.transferRouteAvailable
    ? `${selected.facts.beneficiaryName} · ${selected.facts.sourceCurrency} funding`
    : beneficiaryResolution?.action === "INCORRECT_VENDOR"
      ? `Vendor correction requested by ${beneficiaryResolution.actor}`
      : beneficiaryResolution?.action === "REQUESTED_BENEFICIARY_SETUP"
        ? "Waiting for verified beneficiary setup"
        : beneficiaryResolution?.action === "MATCHED_BENEFICIARY"
          ? `${beneficiaryResolution.beneficiaryName} has no verified payout route`
          : "No verified payout route";
  const payoutBlockReason = recommendation?.recommendation === "REVIEW_DUPLICATE"
    ? "Payout validation is disabled until the possible duplicate is resolved."
    : recommendation?.recommendation === "REVIEW_AMOUNT_CHANGE"
      ? `Payout validation is disabled until finance reviews the ${selected?.observedAmountChangePercent}% increase.`
      : recommendation?.recommendation === "MISSING_BENEFICIARY"
        ? "Payout validation is disabled because this vendor has no verified beneficiary and payout route."
        : recommendation?.recommendation === "INSUFFICIENT_FUNDS"
          ? "Payout validation is disabled because the funding wallet has insufficient available balance."
          : recommendation?.recommendation === "REQUEST_INFORMATION"
            ? "Payout validation is disabled until the missing bill information is supplied."
            : "Resolve the exception before payout validation can run.";

  function chooseBill(id: string) {
    setSelectedId(id);
    setAnalysis(null);
    setPayout(null);
    setError("");
    setNotice("");
    setResolutionMode(null);
    setResolutionNote("");
    setSelectedBeneficiaryId("");
    setAssistantQuestion("");
    setAssistantMessages([]);
  }

  return (
    <div className={`apShell ${sidebarCollapsed ? "sidebarCollapsed" : ""}`}>
      <aside className="apSidebar">
        <div className="apBrandRow">
          <a className="apBrand" href="#top" aria-label="AP Desk home">
            <span className="apBrandMark">AP</span>
            <span className="brandName">AP Desk</span>
          </a>
          <button className="sidebarToggle" type="button" aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setSidebarCollapsed((current) => !current)}>{sidebarCollapsed ? "›" : "‹"}</button>
        </div>
        <div className="apSidebarFooter">
          <div className="sandboxBadge"><i /><span>Airwallex Sandbox</span></div>
          <div className="profileRow"><span>DO</span><div><strong>Demo operator</strong><small>Unauthenticated session</small></div></div>
        </div>
      </aside>

      <main className="apMain" id="top">
        <header className="apHeader">
          <div>
            <p className="eyebrow">Accounts payable</p>
            <h1>{stage === "INTAKE" ? "Intake" : stage === "DECISION" ? "Payout decision" : "Bill review"}</h1>
            <p>{stage === "INTAKE"
              ? "Invoices enter here. Nothing reaches Airwallex until the server validates it."
              : stage === "DECISION"
                ? "Every check passed and the decision is on the record. Money has not moved."
                : "AI reviews incoming bills, explains exceptions, and recommends the safest next step."}</p>
          </div>
          <div className="headerTools">
            <button className="dangerGhostButton" type="button" disabled={Boolean(loading)} onClick={() => setConfirmReset(true)}>Reset demo</button>
          </div>
        </header>

        {confirmReset && (
          <div className="confirmBar" role="alertdialog" aria-label="Confirm demo reset">
            <div>
              <strong>Reset the demo?</strong>
              <p>Clears every saved exception decision, marks the open demo and intake bills paid in Airwallex, and lays the scenarios out again. Retiring a bill cannot be undone.</p>
            </div>
            <div className="confirmActions">
              <button type="button" className="secondaryButton" onClick={() => setConfirmReset(false)}>Cancel</button>
              <button type="button" className="dangerButton" disabled={Boolean(loading)} onClick={() => { setConfirmReset(false); post("reset_demo"); }}>Reset demo</button>
            </div>
          </div>
        )}

        <nav className="flowRail" aria-label="Bill pipeline">
          <button type="button" className={`flowStep ${stage === "INTAKE" ? "active" : "done"}`} onClick={() => openIntake()}>
            <i>1</i>
            <span><strong>Intake</strong><small>Paste an invoice</small></span>
          </button>
          <span className="flowLine done" />
          <button type="button" className={`flowStep ${stage === "REVIEW" ? "active" : "todo"}`} onClick={() => setStage("REVIEW")}>
            <i>2</i>
            <span><strong>Review</strong><small>{workspace ? `${workspace.summary.open} open · ${workspace.summary.needsAttention} need attention` : "Loading"}</small></span>
          </button>
          <span className="flowLine" />
          <button type="button" className={`flowStep ${stage === "DECISION" ? "active" : payout ? "done" : "todo"}`} disabled={!payout} onClick={() => payout && setStage("DECISION")}>
            <i>3</i>
            <span><strong>Decision</strong><small>{payout ? "Cleared for payment" : "After exceptions clear"}</small></span>
          </button>
          <span className="railStatus">
            {triageStatus === "RUNNING" && <><i className="loader" />Triage running</>}
            {triageStatus === "COMPLETE" && <em className={triageUsesLiveModel ? "live" : "fallback"}>{triageUsesLiveModel ? "Live model" : "Safe fallback"}</em>}
            {triageStatus === "ERROR" && <em className="fallback">Server checks only</em>}
          </span>
        </nav>

        {stage === "INTAKE" && (
        <section className="intakePanel" aria-label="Invoice intake">
          <div className="intakeHeader">
            <div>
              <p className="eyebrow">Step 1 &middot; Intake</p>
              <h2>Invoices arriving in AP</h2>
              <p>Open a message and the agent reads it, proposing bill fields. Server code validates every field against live Airwallex vendors and balances before anything is created.</p>
            </div>
            <button className="secondaryButton" type="button" onClick={() => setStage("REVIEW")}>Skip to review</button>
          </div>

          <div className="intakeBody">
            {!pasteMode ? (
              <div className="inboxPane">
                <div className="inboxHeader">
                  <div>
                    <p className="eyebrow">ap@yourcompany.example</p>
                    <h3>Inbox</h3>
                  </div>
                  <span>{inbox ? `${inbox.filter((message) => !message.filed).length} unfiled` : "Loading"}</span>
                </div>
                <div className="inboxList">
                  {(inbox || []).map((message) => (
                    <button
                      key={message.id}
                      type="button"
                      className={`inboxRow ${message.filed ? "filed" : ""} ${openMessageId === message.id ? "open" : ""}`}
                      disabled={Boolean(loading)}
                      onClick={() => runIntake(message.id)}
                    >
                      <div className="inboxRowMain">
                        <strong>{message.fromName}</strong>
                        <span>{message.subject}</span>
                        <em>{message.attachment}</em>
                      </div>
                      <div className="inboxRowMeta">
                        <small>{relativeTime(message.receivedAt)}</small>
                        {message.filed && <i className="filedTag">Filed</i>}
                      </div>
                    </button>
                  ))}
                  {inbox?.length === 0 && <p className="inboxEmpty">No messages.</p>}
                </div>
                <p className="inboxNote">
                  A stand-in for the AP inbox a deployment would monitor. Real messages carry a PDF and an OCR step turns it into text &mdash; everything after that is the production path.{" "}
                  <button type="button" className="linkButton" onClick={() => setPasteMode(true)}>Paste text instead</button>
                </p>
              </div>
            ) : (
              <>
                <label className="intakeField" htmlFor="intakeText">
                  <span>Invoice email or document text</span>
                  <textarea
                    id="intakeText"
                    value={intakeText}
                    placeholder="Paste the full text of a vendor invoice or billing email…"
                    onChange={(event) => setIntakeText(event.target.value)}
                  />
                </label>
                <div className="intakeActions">
                  <button type="button" className="linkButton" onClick={() => { setPasteMode(false); setIntakeText(""); }}>Back to inbox</button>
                  <button type="button" className="linkButton" onClick={() => setIntakeText(SAMPLE_INVOICE)}>Use a sample invoice</button>
                  <button
                    className="primaryButton intakeRun"
                    type="button"
                    disabled={intakeText.trim().length < 20 || Boolean(loading)}
                    onClick={() => runIntake()}
                  >
                    Read invoice
                  </button>
                </div>
              </>
            )}

              {intakeDraft && confirmed && (
                <div className="intakeDraft">
                  <div className="intakeDraftHeader">
                    <h3>Proposed bill fields</h3>
                    <div className="draftTags">
                      <span className={`confidenceTag ${intakeDraft.confidence.toLowerCase()}`}>{intakeDraft.confidence} confidence</span>
                      <span className={`sourceTag ${intakeDraft.source === "AI_GATEWAY" ? "live" : "fallback"}`}>
                        {intakeDraft.source === "AI_GATEWAY" ? `Model: ${intakeDraft.model}` : "Deterministic extraction"}
                      </span>
                    </div>
                  </div>
                  {intakeDraft.fallbackReason && <p className="intakeHint">{intakeDraft.fallbackReason}</p>}

                  {intakeDraft.injectionSuspected && (
                    <div className="intakeWarning">
                      <strong>Instruction-like text reported in this document.</strong>
                      {intakeDraft.flaggedText && <blockquote>{intakeDraft.flaggedText}</blockquote>}
                      <p>It was read as data. This is a heuristic signal, not a control — the field checks below are what actually hold, whatever the document says.</p>
                    </div>
                  )}

                  {sourceDoc && (
                    <details className="sourceDoc" open>
                      <summary>
                        <span>Source document</span>
                        {sourceDoc.attachment && <em>{sourceDoc.attachment}</em>}
                      </summary>
                      <pre>{highlightParts(sourceDoc.body, intakeDraft.flaggedText).map((part, index) => (
                        part.flagged ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>
                      ))}</pre>
                      <p>Text the OCR step returned for this attachment. Every field above was read from it &mdash; check them against it.</p>
                    </details>
                  )}

                  <div className="intakeGrid">
                    {([
                      ["vendorName", "Vendor", intakeDraft.vendor],
                      ["invoiceNumber", "Invoice number", intakeDraft.invoiceNumber],
                      ["amount", "Amount", intakeDraft.amount],
                      ["currency", "Currency", intakeDraft.currency],
                      ["dueDate", "Due date", intakeDraft.dueDate],
                      ["description", "Description", intakeDraft.description],
                    ] as const).map(([key, label, field]) => (
                      <label key={key} className="intakeField">
                        <span>
                          {label}
                          <i className={`statusChip ${field.status.toLowerCase()}`}>{field.status === "OK" ? "Validated" : field.status === "MISSING" ? "Not found" : "Rejected"}</i>
                        </span>
                        <input
                          value={confirmed[key]}
                          onChange={(event) => setConfirmed((current) => current && { ...current, [key]: event.target.value })}
                        />
                        <small>{field.detail}</small>
                      </label>
                    ))}
                  </div>

                  {intakeDraft.blockers.length > 0 && (
                    <ul className="intakeBlockers">
                      {intakeDraft.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                    </ul>
                  )}

                  {openMessage?.filed && (
                    <div className="filedNotice">
                      <strong>Already filed as {openMessage.filedAs?.invoiceNumber || "a bill"}.</strong>
                      <p>This message has already produced a bill that is still open. Withdraw that bill from the review queue if you need to file it again.</p>
                    </div>
                  )}

                  {intakeDraft.requiresFieldReview && (
                    <label className="reviewGate">
                      <input type="checkbox" checked={fieldsReviewed} onChange={(event) => setFieldsReviewed(event.target.checked)} />
                      <span>
                        <strong>This extraction was low confidence.</strong>
                        I have checked every field above against the document.
                      </span>
                    </label>
                  )}

                  <div className="intakeActions">
                    <button type="button" className="linkButton" onClick={() => { setIntakeDraft(null); setConfirmed(null); setFieldsReviewed(false); setSourceDoc(null); }}>Discard draft</button>
                    <button
                      className="primaryButton intakeRun"
                      type="button"
                      disabled={!confirmedComplete || Boolean(openMessage?.filed) || (intakeDraft.requiresFieldReview && !fieldsReviewed) || Boolean(loading)}
                      onClick={() => createBillFromIntake()}
                    >
                      Create bill in Airwallex
                    </button>
                  </div>
                  <p className="intakeHint">Creating the bill only adds it to the review queue. It still passes every duplicate, amount, beneficiary, and funding check before any payout can be validated.</p>
                </div>
              )}
          </div>
        </section>
        )}

        {loading && <div className="inlineMessage"><span className="loader" />{loading}</div>}
        {error && <div className="inlineMessage error">{error}</div>}
        {notice && <div className="inlineMessage success">{notice}</div>}

        {stage === "REVIEW" && (<>
        <section className="summaryGrid" aria-label="Bill summary">
          <div><span>Open bills</span><strong>{workspace?.summary.open ?? "—"}</strong><small>From Airwallex</small></div>
          <div><span>Needs attention</span><strong>{workspace?.summary.needsAttention ?? "—"}</strong><small>Exceptions detected</small></div>
          <div><span>Ready to validate</span><strong>{workspace?.summary.ready ?? "—"}</strong><small>No blocking facts</small></div>
          <div><span>Open value</span><strong>{money(workspace?.summary.totalValue || 0)}</strong><small>Across currencies*</small></div>
        </section>

        <div className="workbench" id="bills">
          <section className="billQueue" aria-label="Bill queue">
            <div className="queueHeader">
              <div><p className="eyebrow">Inbox</p><h2>Bills to review</h2></div>
              <span>{filteredCases.length}</span>
            </div>
            <div className="filterTabs" role="tablist" aria-label="Filter bills">
              {(["ALL", "ATTENTION", "READY", "ON_HOLD", "CLOSED"] as const).map((value) => (
                <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
                  {queueFilterLabels[value]}
                </button>
              ))}
            </div>
            <div className="billList">
              {filteredCases.map((item) => {
                const code = item.serverRecommendation.recommendation;
                const queueStatus = apQueueStatus(item);
                const caseLabel = item.resolution?.action === "CONFIRMED_DUPLICATE"
                  ? "Duplicate confirmed"
                  : item.resolution?.action === "DISPUTED_BILL"
                    ? "Bill disputed"
                  : item.resolution?.action === "REQUESTED_INFORMATION"
                    ? "Waiting for information"
                    : item.resolution?.action === "REQUESTED_AMOUNT_EXPLANATION"
                      ? "Waiting for explanation"
                    : item.beneficiaryResolution?.action === "REQUESTED_BENEFICIARY_SETUP"
                      ? "Waiting for beneficiary"
                    : item.beneficiaryResolution?.action === "INCORRECT_VENDOR"
                      ? "Vendor correction needed"
                    : recommendationLabels[code];
                const caseTone = queueStatus === "CLOSED"
                  ? "closed"
                  : queueStatus === "ON_HOLD"
                    ? "hold"
                    : queueStatus === "READY" ? "ready" : "review";
                return (
                  <button key={item.id} className={`billRow ${selected?.id === item.id ? "selected" : ""}`} onClick={() => chooseBill(item.id)}>
                    <span className="vendorAvatar">{initials(item.vendor)}</span>
                    <span className="billRowMain"><strong>{item.vendor}</strong><small>{item.invoiceNumber || "Invoice number missing"} · Due {shortDate(item.dueDate)}</small><em className={`recommendationTag ${caseTone}`}>{caseLabel}</em></span>
                    <span className="billAmount">{money(item.amount, item.currency)}<small>{item.currency}</small></span>
                  </button>
                );
              })}
              {!filteredCases.length && !loading && <div className="emptyState"><strong>No bills in this view</strong><p>Generate the demo bills or choose another filter.</p></div>}
            </div>
          </section>

          <section className="billReview" id="review">
            {selected ? (
              <>
                <div className="reviewHeader">
                  <div>
                    <p className="eyebrow">Invoice {selected.invoiceNumber || "—"}</p>
                    <h2>{selected.vendor}</h2>
                    <p>{selected.description || "No description provided"}</p>
                    {selective(selected) && <button className="linkButton withdrawLink" type="button" disabled={Boolean(loading)} onClick={() => post("discard_intake_bill", selected.id)}>Withdraw this intake bill</button>}
                  </div>
                  <div className="reviewAmount"><span>Amount due</span><strong>{money(selected.amount, selected.currency)}</strong><small>Due {shortDate(selected.dueDate)}</small></div>
                </div>

                <div className="detailGrid">
                  <div><span>Bill status</span><strong>{selected.status.replaceAll("_", " ")}</strong></div>
                  <div><span>Issued</span><strong>{shortDate(selected.issuedDate)}</strong></div>
                  <div><span>Beneficiary</span><strong>{selected.facts.beneficiaryName || "Not matched"}</strong></div>
                  <div><span>Funding wallet</span><strong>{selected.facts.sourceCurrency || "Not determined"}</strong></div>
                </div>

                <div className="factsSection">
                  <div className="sectionTitle"><div><p className="eyebrow">Server checks</p><h3>Verified financial facts</h3></div><span className="livePill"><i /> Live API data</span></div>
                  <div className="factRows">
                    <div><span className={`factIcon ${duplicateCheckTone}`}>{duplicateCheckTone === "pass" ? "✓" : "!"}</span><p><strong>Duplicate check</strong><small>{duplicateCheckText}</small></p></div>
                    <div><span className={`factIcon ${amountCheckTone}`}>{amountCheckTone === "pass" ? "✓" : "!"}</span><p><strong>Amount history</strong><small>{amountCheckText}</small></p></div>
                    <div><span className={`factIcon ${beneficiaryCheckTone}`}>{beneficiaryCheckTone === "pass" ? "✓" : beneficiaryCheckTone === "neutral" ? "—" : "!"}</span><p><strong>Beneficiary and route</strong><small>{beneficiaryCheckText}</small></p></div>
                    <div><span className={selected.facts.hasSufficientBalance ? "factIcon pass" : "factIcon neutral"}>{selected.facts.hasSufficientBalance ? "✓" : "—"}</span><p><strong>Wallet funds</strong><small>{fundingSummary(selected.facts)}</small></p></div>
                  </div>
                </div>

                {(selected.previousBills || []).length > 0 && (
                  <div className="billHistorySection">
                    <div className="sectionTitle">
                      <div><p className="eyebrow">Vendor history</p><h3>Previous {selected.vendor} bills</h3></div>
                      <span className="historySource">Airwallex bills</span>
                    </div>
                    <div className="billHistoryTableWrap">
                      <table className="billHistoryTable">
                        <thead><tr><th>Invoice</th><th>Issued</th><th>Status</th><th>Amount</th></tr></thead>
                        <tbody>
                          {(selected.previousBills || []).map((bill) => (
                            <tr key={bill.id}>
                              <td>{bill.invoiceNumber || "—"}</td>
                              <td>{shortDate(bill.issuedDate)}</td>
                              <td>{bill.status.replaceAll("_", " ")}</td>
                              <td>{money(bill.amount, bill.currency)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {selected.observedAmountChangePercent !== null && <p className="historyNote">The current bill is {selected.observedAmountChangePercent}% above the calculated prior average.</p>}
                  </div>
                )}

                {matchingBill && (
                  <div className="resolutionSection">
                    <div className="sectionTitle">
                      <div><p className="eyebrow">Exception workflow</p><h3>Resolve possible duplicate</h3></div>
                      {duplicateResolution && <span className={`resolutionBadge ${duplicateResolution.action.toLowerCase()}`}>{duplicateResolution.action.replaceAll("_", " ")}</span>}
                    </div>

                    {matchingBill && (
                      <div className="matchSignal">
                        <span className={matchingBill.matchType === "INVOICE_NUMBER" ? "signalTag exact" : "signalTag likely"}>
                          {matchingBill.matchType === "INVOICE_NUMBER" ? "Invoice number match" : "Amount and date match"}
                        </span>
                        <p>{matchingBill.matchReason}</p>
                      </div>
                    )}

                    {duplicateResolution && (
                      <div className="resolutionRecord">
                        <span>Latest decision</span>
                        <strong>{duplicateCheckText}</strong>
                        <p>{duplicateResolution.note}</p>
                        <small>{shortDate(duplicateResolution.updatedAt)}</small>
                      </div>
                    )}

                    {duplicateResolution ? (
                      <div className="resolutionActions"><button className="reopenAction" disabled={Boolean(loading)} onClick={() => post("clear_resolution", selected.id)}>Reopen case</button></div>
                    ) : (
                      <div className="resolutionActions">
                        <button onClick={() => setResolutionMode(resolutionMode === "COMPARE" ? null : "COMPARE")}>View matching bill</button>
                        <button className="dangerAction" disabled={Boolean(loading)} onClick={() => post("confirm_duplicate", selected.id, { matchingBillId: matchingBill.id })}>Confirm duplicate</button>
                        <button onClick={() => { setResolutionMode("OVERRIDE"); setResolutionNote(""); }}>Not a duplicate</button>
                        <button onClick={() => { setResolutionMode("REQUEST"); setResolutionNote("Please confirm why two invoices with the same number were submitted and whether both should be paid."); }}>Request information</button>
                      </div>
                    )}

                    {resolutionMode === "COMPARE" && (
                      <div className="billComparison">
                        <div><span>Current bill</span><strong>{selected.invoiceNumber}</strong><p>{money(selected.amount, selected.currency)}</p><small>Issued {shortDate(selected.issuedDate)} · {selected.status.replaceAll("_", " ")}</small></div>
                        <b>matches</b>
                        <div><span>Existing bill</span><strong>{matchingBill.invoiceNumber}</strong><p>{money(matchingBill.amount, matchingBill.currency)}</p><small>Issued {shortDate(matchingBill.issuedDate)} · {matchingBill.status.replaceAll("_", " ")}</small></div>
                      </div>
                    )}

                    {(resolutionMode === "OVERRIDE" || resolutionMode === "REQUEST") && (
                      <div className="resolutionForm">
                        <label htmlFor="resolution-note">{resolutionMode === "OVERRIDE" ? "Why are both invoices legitimate?" : "What information do you need?"}</label>
                        <textarea id="resolution-note" value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} placeholder={resolutionMode === "OVERRIDE" ? "Example: The invoices cover two separate project phases." : "Write the question for the submitter or vendor."} />
                        <div><button onClick={() => { setResolutionMode(null); setResolutionNote(""); }}>Cancel</button><button className="primaryButton" disabled={resolutionNote.trim().length < 5 || Boolean(loading)} onClick={() => post(resolutionMode === "OVERRIDE" ? "override_duplicate" : "request_information", selected.id, { note: resolutionNote, matchingBillId: matchingBill.id })}>{resolutionMode === "OVERRIDE" ? "Clear duplicate flag" : "Save information request"}</button></div>
                        {resolutionMode === "REQUEST" && <small>This saves a pending request in the case record; it does not send an email.</small>}
                      </div>
                    )}
                  </div>
                )}

                {selected.observedAmountChangePercent !== null && selected.observedAmountChangePercent >= 25 && (
                  <div className="resolutionSection amountResolutionSection">
                    <div className="sectionTitle">
                      <div><p className="eyebrow">Exception workflow</p><h3>Resolve amount change</h3></div>
                      {amountResolution && <span className={`resolutionBadge ${amountResolution.action.toLowerCase()}`}>{amountResolution.action.replaceAll("_", " ")}</span>}
                    </div>

                    {amountResolution && (
                      <div className="resolutionRecord">
                        <span>Latest decision</span>
                        <strong>{amountCheckText}</strong>
                        <p>{amountResolution.note}</p>
                        <small>{shortDate(amountResolution.updatedAt)}</small>
                      </div>
                    )}

                    {amountResolution ? (
                      <div className="resolutionActions amountActions"><button className="reopenAction" disabled={Boolean(loading)} onClick={() => post("clear_resolution", selected.id)}>Reopen case</button></div>
                    ) : (
                      <div className="resolutionActions amountActions">
                        <button className="approveAction" disabled={Boolean(loading)} onClick={() => { setResolutionMode("APPROVE_VARIANCE"); setResolutionNote(""); }}>Approve variance</button>
                        <button disabled={Boolean(loading)} onClick={() => { setResolutionMode("REQUEST_AMOUNT"); setResolutionNote(`Please explain the ${selected.observedAmountChangePercent}% increase and attach the contract, renewal notice, or other supporting documentation.`); }}>Request explanation</button>
                        <button className="dangerAction" disabled={Boolean(loading)} onClick={() => { setResolutionMode("DISPUTE"); setResolutionNote("The invoice amount does not match the agreed pricing and requires correction."); }}>Dispute bill</button>
                      </div>
                    )}

                    {["APPROVE_VARIANCE", "REQUEST_AMOUNT", "DISPUTE"].includes(resolutionMode || "") && (
                      <div className="resolutionForm">
                        <label htmlFor="amount-resolution-note">{resolutionMode === "APPROVE_VARIANCE" ? "Approval reason or reference" : resolutionMode === "REQUEST_AMOUNT" ? "What explanation do you need?" : "Why is the bill being disputed?"}</label>
                        <textarea id="amount-resolution-note" value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} placeholder={resolutionMode === "APPROVE_VARIANCE" ? "Example: Renewal approved by the infrastructure budget owner." : "Add context for the audit trail."} />
                        <div><button onClick={() => { setResolutionMode(null); setResolutionNote(""); }}>Cancel</button><button className="primaryButton" disabled={resolutionNote.trim().length < 5 || Boolean(loading)} onClick={() => post(resolutionMode === "APPROVE_VARIANCE" ? "approve_variance" : resolutionMode === "REQUEST_AMOUNT" ? "request_amount_explanation" : "dispute_bill", selected.id, { note: resolutionNote })}>{resolutionMode === "APPROVE_VARIANCE" ? "Approve variance" : resolutionMode === "REQUEST_AMOUNT" ? "Save explanation request" : "Mark bill disputed"}</button></div>
                        {resolutionMode === "REQUEST_AMOUNT" && <small>This saves a pending request in the case record; it does not send an email.</small>}
                      </div>
                    )}
                  </div>
                )}

                {(selected.serverRecommendation.recommendation === "MISSING_BENEFICIARY" || beneficiaryResolution) && (
                  <div className="resolutionSection beneficiaryResolutionSection">
                    <div className="sectionTitle">
                      <div><p className="eyebrow">Exception workflow</p><h3>Resolve beneficiary</h3></div>
                      {beneficiaryResolution && <span className={`resolutionBadge ${beneficiaryResolution.action.toLowerCase()}`}>{beneficiaryResolution.action.replaceAll("_", " ")}</span>}
                    </div>

                    {beneficiaryResolution && (
                      <div className="resolutionRecord">
                        <span>Latest decision</span>
                        <strong>{beneficiaryResolution.action === "REQUESTED_BENEFICIARY_SETUP" ? "Assigned to Vendor Operations" : beneficiaryCheckText}</strong>
                        <p>{beneficiaryResolution.note}</p>
                        <small>{shortDate(beneficiaryResolution.updatedAt)}</small>
                      </div>
                    )}

                    {beneficiaryResolution?.action === "REQUESTED_BENEFICIARY_SETUP" && (
                      <div className="handoffDetails" aria-label="Beneficiary setup handoff">
                        <div><span>Owner</span><strong>Vendor Operations</strong></div>
                        <div><span>Status</span><strong>Awaiting vendor submission</strong></div>
                        <div><span>Next step</span><strong>Verify beneficiary in Airwallex</strong></div>
                        <p>Vendor Operations contacts the vendor using the verified contact on file and directs them to the company&apos;s secure vendor-onboarding process. This demo does not send a message or collect bank details.</p>
                      </div>
                    )}

                    {beneficiaryResolution ? (
                      <div className="resolutionActions beneficiaryActions"><button className="reopenAction" disabled={Boolean(loading)} onClick={() => post("clear_beneficiary_resolution", selected.id)}>Reopen beneficiary case</button></div>
                    ) : (
                      <div className="resolutionActions beneficiaryActions">
                        <button className="approveAction" disabled={Boolean(loading)} onClick={() => { setResolutionMode("MATCH_BENEFICIARY"); setSelectedBeneficiaryId(""); setResolutionNote(""); }}>Match existing beneficiary</button>
                        <button disabled={Boolean(loading)} onClick={() => { setResolutionMode("REQUEST_BENEFICIARY"); setResolutionNote("Vendor Operations to contact the vendor using the verified contact on file and request payment details through the approved secure onboarding process."); }}>Assign setup to Vendor Ops</button>
                        <button className="dangerAction" disabled={Boolean(loading)} onClick={() => { setResolutionMode("INCORRECT_VENDOR"); setResolutionNote("The bill appears to be assigned to the wrong vendor and requires correction before payment review."); }}>Incorrect vendor</button>
                      </div>
                    )}

                    {resolutionMode === "MATCH_BENEFICIARY" && (
                      <div className="resolutionForm">
                        <label htmlFor="beneficiary-select">Approved Airwallex beneficiary</label>
                        <select id="beneficiary-select" value={selectedBeneficiaryId} onChange={(event) => setSelectedBeneficiaryId(event.target.value)}>
                          <option value="">Select a beneficiary</option>
                          {(workspace?.beneficiaries || []).map((beneficiary) => (
                            <option key={beneficiary.id} value={beneficiary.id}>{beneficiary.name}{beneficiary.routeAvailable ? ` · ${beneficiary.transferMethod} · ${beneficiary.payoutCurrency}` : " · no usable payout route"}</option>
                          ))}
                        </select>
                        <p className="formGuidance">Only match after confirming this beneficiary belongs to the vendor. Bank details remain in Airwallex.</p>
                        <div><button onClick={() => { setResolutionMode(null); setSelectedBeneficiaryId(""); }}>Cancel</button><button className="primaryButton" disabled={!selectedBeneficiaryId || Boolean(loading)} onClick={() => post("match_beneficiary", selected.id, { beneficiaryId: selectedBeneficiaryId })}>Match and recheck</button></div>
                      </div>
                    )}

                    {(resolutionMode === "REQUEST_BENEFICIARY" || resolutionMode === "INCORRECT_VENDOR") && (
                      <div className="resolutionForm">
                        <label htmlFor="beneficiary-resolution-note">{resolutionMode === "REQUEST_BENEFICIARY" ? "Internal handoff note" : "What needs to be corrected?"}</label>
                        <textarea id="beneficiary-resolution-note" value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} />
                        <div><button onClick={() => { setResolutionMode(null); setResolutionNote(""); }}>Cancel</button><button className="primaryButton" disabled={resolutionNote.trim().length < 5 || Boolean(loading)} onClick={() => post(resolutionMode === "REQUEST_BENEFICIARY" ? "request_beneficiary_setup" : "incorrect_vendor", selected.id, { note: resolutionNote })}>{resolutionMode === "REQUEST_BENEFICIARY" ? "Assign to Vendor Ops" : "Flag vendor correction"}</button></div>
                        {resolutionMode === "REQUEST_BENEFICIARY" && <small>This creates an internal handoff only. Vendor Operations must use a verified contact and secure onboarding channel; no email or bank details are handled by this demo.</small>}
                      </div>
                    )}
                  </div>
                )}

              </>
            ) : <div className="emptyReview"><strong>Select a bill to review</strong><p>Airwallex bill details and verified exception facts will appear here.</p></div>}
          </section>

          <aside className="agentPanel" aria-label="Agent recommendation">
            <div className="agentPanelHeader">
              <p className="eyebrow">AP exception agent</p>
              {recommendation && <span className={recommendation.source === "AI_GATEWAY" ? "modelBadge live" : "modelBadge"}>{recommendation.source === "AI_GATEWAY" ? "Live model" : "Safe fallback"}</span>}
            </div>
            {!currentAnalysis ? (
              <div className="agentStart">
                <span className="agentGlyph">✦</span>
                {selected && apQueueStatus(selected) === "CLOSED" ? (
                  <>
                    <h2>This case is closed</h2>
                    <p>A person confirmed the exception, so the agent has nothing left to explain. Reopen the case to review it again. You remain in control of payment.</p>
                  </>
                ) : selected && apQueueStatus(selected) === "ON_HOLD" ? (
                  <>
                    <h2>Waiting on someone</h2>
                    <p>This case is on hold pending information or a correction. Server code decides the outcome; the model explains it. You remain in control of payment.</p>
                  </>
                ) : (
                  <>
                    <h2>Waiting for triage</h2>
                    <p>Every open bill is reviewed automatically after each Airwallex refresh. Server code decides the outcome; the model explains it. You remain in control of payment.</p>
                  </>
                )}
              </div>
            ) : (
              <div className="agentResult">
                <span className={`decisionPill ${recommendation?.recommendation === "READY_TO_VALIDATE" ? "ready" : "review"}`}>{recommendation && recommendationLabels[recommendation.recommendation]}</span>
                <h2>{recommendation?.summary}</h2>
                <p className="decisionSource">Server decision · explained by the {recommendation?.source === "AI_GATEWAY" ? "model" : "fallback"} · {recommendation?.confidence.toLowerCase()} confidence · <span className="decisionCategory">{recommendation?.suggestedCategory.replaceAll("_", " ").toLowerCase()}</span></p>
                <ul>{recommendation?.reasons.map((reason) => {
                  const tone = reasonTone(reason, selected);
                  return <li className={`reasonItem ${tone}`} key={reason}><span aria-hidden="true">{reasonIcons[tone]}</span>{reason}</li>;
                })}</ul>
                {recommendation?.source === "SAFE_FALLBACK" && <p className="fallbackText">Live model reasoning was unavailable. The same server-established facts and safety gates remain in force.</p>}

                <section className="assistantSection" aria-label="Ask about this bill">
                  {assistantMessages.length > 0 && (
                  <div className="assistantMessages" aria-live="polite">
                    {assistantMessages.map((message) => (
                      <div className={`assistantMessage ${message.role === "USER" ? "user" : "assistant"}`} key={message.id}>
                        <div>
                          <strong>{message.role === "USER" ? "You" : "AI assistant"}</strong>
                          <span className={message.label.toLowerCase().includes("unverified") ? "unverified" : ""}>{message.label}</span>
                          {message.source && <em className={message.source === "AI_GATEWAY" ? "live" : ""}>{message.source === "AI_GATEWAY" ? "Live model" : "Safe fallback"}</em>}
                        </div>
                        <p>{message.text}</p>
                      </div>
                    ))}
                  </div>
                  )}
                  {assistantLoading && <div className="assistantThinking"><span className="loader" />Reviewing the current bill facts…</div>}

                  <form className="assistantComposer" onSubmit={(event) => { event.preventDefault(); askAssistant(assistantQuestion); }}>
                    <p className="assistantLead">Ask the agent about {selected?.vendor || "this bill"}</p>
                    <div className="assistantPrompts" aria-label="Suggested questions">
                      {assistantPrompts.chips.map((chip) => (
                        <button key={chip.label} type="button" disabled={assistantLoading} onClick={() => askAssistant(chip.question, "Question")}>{chip.label}</button>
                      ))}
                    </div>
                    <label className="visuallyHidden" htmlFor="assistant-question">Ask a question or add context</label>
                    <textarea
                      id="assistant-question"
                      rows={2}
                      maxLength={1000}
                      value={assistantQuestion}
                      onChange={(event) => setAssistantQuestion(event.target.value)}
                      placeholder={assistantPrompts.placeholder}
                    />
                    <div><small>Anything entered here is treated as unverified.</small><button className="primaryButton" type="submit" disabled={assistantQuestion.trim().length < 2 || assistantLoading}>Ask assistant</button></div>
                  </form>
                </section>
              </div>
            )}

            <div className="payoutAction">
              {currentPayout ? (
                <button className="secondaryButton fullWidth" type="button" onClick={() => setStage("DECISION")}>View decision record</button>
              ) : (
                <button className="primaryButton" disabled={!isReady || Boolean(loading)} onClick={() => selected && post("validate", selected.id)}>Validate payout with Airwallex</button>
              )}
              {!isReady && <p className="actionNote">{payoutBlockReason}</p>}
            </div>
          </aside>
        </div>
        </>)}

        {stage === "DECISION" && currentPayout && selected && (
          <section className="decisionStage" aria-label="Payout decision record">
            <div className="decisionCard">
              <div className="decisionHero">
                <span>Airwallex response &middot; {currentPayout.airwallex.status}</span>
                <h2>{selected.invoiceNumber || "This bill"} is cleared for payment</h2>
                <p>Airwallex accepted these payout instructions against the live beneficiary and funding route. No transfer was created &mdash; releasing it is a separate, human act outside this prototype.</p>
              </div>

              <div className="payoutGrid">
                <div>
                  <span>Beneficiary</span>
                  <strong>{currentPayout.airwallex.beneficiaryName}</strong>
                  <small>{selected.facts.transferMethod} &middot; {currentPayout.airwallex.transferCurrency} account</small>
                </div>
                <div>
                  <span>Payout</span>
                  <strong>{money(currentPayout.airwallex.transferAmount, currentPayout.airwallex.transferCurrency)}</strong>
                  <small>Reference {selected.invoiceNumber.slice(0, 35) || "—"}</small>
                </div>
                <div>
                  <span>Cleared by</span>
                  <strong>{ACTOR_NAME}</strong>
                  <small>{ACTOR_ROLE}</small>
                </div>
              </div>

              <div className="fundingStrip">
                <div>
                  <strong>{fundingHeadline(currentPayout.airwallex)}</strong>
                  <small>{fundingDetail(currentPayout.airwallex, selected.facts)}</small>
                </div>
                <span className="fxTag">{currentPayout.airwallex.sourceCurrency === currentPayout.airwallex.transferCurrency ? "No FX needed" : `FX ${currentPayout.airwallex.fxRate}`}</span>
              </div>

              <div className="trailSection">
                <div className="sectionTitle">
                  <div><p className="eyebrow">Audit trail</p><h3>How this bill got here</h3></div>
                  <span className="livePill"><i /> Live API data</span>
                </div>
                <div className="trailList">
                  {decisionTrail(selected, currentPayout).map((entry, index, all) => (
                    <div className="trailItem" key={entry.title}>
                      <div className="trailMark"><i>{index === all.length - 1 ? "✓" : index + 1}</i>{index < all.length - 1 && <b />}</div>
                      <div className="trailBody"><strong>{entry.title}</strong><p>{entry.detail}</p></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="sideRail">
              <div className="railCard">
                <div className="railHead"><h3>What did not happen</h3></div>
                <div className="boundaryRow"><i>✗</i><div><strong>No transfer was created</strong><small>Validation confirms the instructions are payable. It does not queue, schedule, or send them.</small></div></div>
                <div className="boundaryRow"><i>✗</i><div><strong>No funds left the wallet</strong><small>The {currentPayout.airwallex.sourceCurrency} balance is unchanged.</small></div></div>
                <div className="boundaryRow"><i>✗</i><div><strong>The model approved nothing</strong><small>Every state change on this bill was made by server code or by a person, on the record.</small></div></div>
              </div>
              <div className="nextCard">
                <h3>Releasing payment</h3>
                <p>Creating the transfer is the only step that moves money, and it is deliberately absent from this prototype. The decision record above is what a person would hand to whoever releases it.</p>
                <div className="nextActions">
                  <button className="secondaryButton fullWidth" type="button" onClick={() => setStage("REVIEW")}>Return to the queue</button>
                </div>
              </div>
            </div>
          </section>
        )}

        <section className="apiActivity" id="audit" aria-labelledby="api-activity-title">
          <div className="apiActivityHeader">
            <div>
              <p className="eyebrow">Integration transparency</p>
              <h2 id="api-activity-title">Live Airwallex API activity</h2>
              <p>Calls appear here after every refresh, triage run, and payout validation. Credentials and record IDs stay on the server.</p>
            </div>
            <div className="apiActivityActions">
              {auditOpen && apiActivity.length > 0 && <button onClick={() => setApiActivity([])}>Clear log</button>}
              <span className={`livePill ${loading ? "calling" : ""}`}><i /> {loading ? "Request active" : "Live log"}</span>
              <button
                className="auditToggle"
                type="button"
                aria-expanded={auditOpen}
                aria-controls="api-activity-list"
                onClick={() => setAuditOpen((current) => !current)}
              >
                {auditOpen ? "Hide" : "Show"} {apiActivity.length} call{apiActivity.length === 1 ? "" : "s"}
                <svg viewBox="0 0 24 24" aria-hidden="true" className={auditOpen ? "flip" : ""}><path d="m6 9 6 6 6-6" /></svg>
              </button>
            </div>
          </div>

          {auditOpen && (
          <div className="apiCallList" id="api-activity-list">
            {loading && (
              <div className="apiCallRow pendingCall" aria-live="polite">
                <span className="callPulse" />
                <code>Waiting for Airwallex responses…</code>
                <p>The server is recording the endpoint, result, and timing for each call.</p>
                <span className="callStatus available">In progress</span>
              </div>
            )}
            {[...apiActivity].reverse().map((call) => (
              <div className="apiCallRow" key={call.key}>
                <span className={`methodChip ${call.method.toLowerCase()}`}>{call.method}</span>
                <code>{call.endpoint}</code>
                <p><strong>{operationLabels[call.operation]}</strong><span>{new Date(call.occurredAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })} · {call.durationMs} ms</span></p>
                <span className={`callStatus ${call.outcome === "SUCCESS" ? "complete" : "error"}`}>
                  {call.status || "Network error"}
                </span>
              </div>
            ))}
            {!apiActivity.length && !loading && (
              <div className="apiLogEmpty">
                <strong>No calls recorded yet</strong>
                <p>Refresh Airwallex or run an agent review to populate the live log.</p>
              </div>
            )}
          </div>
          )}
        </section>
        <p className="currencyNote">* Open value is a simple display total and does not convert currencies.</p>
      </main>
    </div>
  );
}
