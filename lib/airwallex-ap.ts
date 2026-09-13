const BASE_URL = "https://api.sandbox.airwallex.com";

// Airwallex response shapes vary by resource and API version.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AirwallexJson = Record<string, any>;

export type AirwallexApiCall = {
  method: string;
  endpoint: string;
  status: number;
  durationMs: number;
  outcome: "SUCCESS" | "ERROR";
  occurredAt: string;
};

export type AirwallexApiTrace = AirwallexApiCall[];

const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

function safeEndpoint(path: string) {
  return path.replace(uuidPattern, ":record_id");
}

function traceCall(
  trace: AirwallexApiTrace | undefined,
  method: string,
  path: string,
  status: number,
  startedAt: number,
) {
  trace?.push({
    method,
    endpoint: safeEndpoint(path),
    status,
    durationMs: Math.max(0, Date.now() - startedAt),
    outcome: status >= 200 && status < 300 ? "SUCCESS" : "ERROR",
    occurredAt: new Date().toISOString(),
  });
}

export class AirwallexApiError extends Error {
  status: number;
  code: string | null;
  details: unknown;

  constructor(path: string, status: number, body: AirwallexJson) {
    super(body.message || body.code || `Airwallex ${path} returned HTTP ${status}`);
    this.name = "AirwallexApiError";
    this.status = status;
    this.code = body.code || null;
    this.details = body.details || body.errors || null;
  }
}

export async function authenticateAirwallex(trace?: AirwallexApiTrace) {
  const clientId = process.env.AIRWALLEX_CLIENT_ID;
  const apiKey = process.env.AIRWALLEX_API_KEY;
  if (!clientId || !apiKey) throw new Error("Missing Airwallex Sandbox credentials");

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/api/v1/authentication/login`, {
      method: "POST",
      headers: { "x-client-id": clientId, "x-api-key": apiKey },
      cache: "no-store",
    });
  } catch (error) {
    traceCall(trace, "POST", "/api/v1/authentication/login", 0, startedAt);
    throw error;
  }
  traceCall(trace, "POST", "/api/v1/authentication/login", response.status, startedAt);
  const body = await response.json() as AirwallexJson;
  if (!response.ok || !body.token) throw new AirwallexApiError("authentication/login", response.status, body);
  return body.token as string;
}

export async function airwallexRequest(
  token: string,
  path: string,
  init: RequestInit = {},
  trace?: AirwallexApiTrace,
) {
  const method = String(init.method || "GET").toUpperCase();
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      cache: "no-store",
    });
  } catch (error) {
    traceCall(trace, method, path, 0, startedAt);
    throw error;
  }
  traceCall(trace, method, path, response.status, startedAt);
  const text = await response.text();
  let body: AirwallexJson = {};
  if (text) {
    try {
      body = JSON.parse(text) as AirwallexJson;
    } catch {
      body = { message: text };
    }
  }
  if (!response.ok) throw new AirwallexApiError(path, response.status, body);
  return body;
}

export async function getCurrentAccount(token: string, trace?: AirwallexApiTrace) {
  return airwallexRequest(token, "/api/v1/account", {}, trace);
}

export async function listBills(token: string, trace?: AirwallexApiTrace) {
  const body = await airwallexRequest(token, "/api/v1/spend/bills?page_size=100", {}, trace);
  return (body.items || []) as AirwallexJson[];
}

export async function getBill(token: string, billId: string, trace?: AirwallexApiTrace) {
  return airwallexRequest(token, `/api/v1/spend/bills/${encodeURIComponent(billId)}`, {}, trace);
}

export async function listVendors(token: string, trace?: AirwallexApiTrace) {
  const body = await airwallexRequest(token, "/api/v1/spend/vendors?page_size=100", {}, trace);
  return (body.items || []) as AirwallexJson[];
}

export async function listBeneficiaries(token: string, trace?: AirwallexApiTrace) {
  const body = await airwallexRequest(token, "/api/v1/beneficiaries?page_num=0&page_size=100", {}, trace);
  return (body.items || []) as AirwallexJson[];
}

export async function listBalances(token: string, trace?: AirwallexApiTrace) {
  const body = await airwallexRequest(token, "/api/v1/balances/current", {}, trace);
  return (Array.isArray(body) ? body : []) as AirwallexJson[];
}

export async function listTransfers(token: string, trace?: AirwallexApiTrace) {
  const body = await airwallexRequest(token, "/api/v1/transfers?page_num=0&page_size=100", {}, trace);
  return (body.items || []) as AirwallexJson[];
}

export async function validateTransfer(token: string, payload: AirwallexJson, trace?: AirwallexApiTrace) {
  return airwallexRequest(token, "/api/v1/transfers/validate", {
    method: "POST",
    body: JSON.stringify(payload),
  }, trace);
}

export async function createVendor(token: string, payload: AirwallexJson, trace?: AirwallexApiTrace) {
  return airwallexRequest(token, "/api/v1/spend/vendors/create", {
    method: "POST",
    body: JSON.stringify(payload),
  }, trace);
}

export async function createBill(token: string, payload: AirwallexJson, trace?: AirwallexApiTrace) {
  return airwallexRequest(token, "/api/v1/spend/bills/create", {
    method: "POST",
    body: JSON.stringify(payload),
  }, trace);
}

export async function markBillPaid(token: string, billId: string, trace?: AirwallexApiTrace) {
  return airwallexRequest(token, `/api/v1/spend/bills/${encodeURIComponent(billId)}/mark_as_paid`, {
    method: "POST",
    body: "{}",
  }, trace);
}

/**
 * A payout route read from the beneficiary record itself, rather than inferred from
 * whether a transfer happened to have been sent to this beneficiary before.
 */
export type PayoutRoute = {
  beneficiaryId: string;
  displayName: string;
  transferMethods: string[];
  payoutCurrency: string | null;
  bankCountryCode: string | null;
};

export function readPayoutRoute(record: AirwallexJson): PayoutRoute | null {
  const beneficiaryId = String(record.id || record.beneficiary_id || "");
  if (!beneficiaryId) return null;

  const details = record.beneficiary || {};
  const bank = details.bank_details || {};
  // Most sandbox beneficiaries carry no nickname, so fall back to the account name
  // rather than dropping the record from the picker entirely.
  const displayName = String(
    record.nickname
      || bank.account_name
      || details.company_name
      || [details.first_name, details.last_name].filter(Boolean).join(" ")
      || "",
  ).trim();
  if (!displayName) return null;

  return {
    beneficiaryId,
    displayName,
    transferMethods: Array.isArray(record.transfer_methods)
      ? record.transfer_methods.map(String).filter(Boolean)
      : [],
    payoutCurrency: String(bank.account_currency || "").toUpperCase() || null,
    bankCountryCode: String(bank.bank_country_code || "") || null,
  };
}

export function chooseTransferMethod(route: PayoutRoute) {
  return route.transferMethods.includes("LOCAL") ? "LOCAL" : route.transferMethods[0] || null;
}

export async function getCurrentFxRate(
  token: string,
  buyCurrency: string,
  sellCurrency: string,
  buyAmount: number,
  trace?: AirwallexApiTrace,
) {
  const query = new URLSearchParams({
    buy_currency: buyCurrency,
    sell_currency: sellCurrency,
    buy_amount: String(buyAmount),
  });
  return airwallexRequest(token, `/api/v1/fx/rates/current?${query}`, {}, trace);
}
