import { env } from "cloudflare:workers";

export type ApResolutionAction =
  | "CONFIRMED_DUPLICATE"
  | "NOT_DUPLICATE"
  | "REQUESTED_INFORMATION"
  | "APPROVED_VARIANCE"
  | "REQUESTED_AMOUNT_EXPLANATION"
  | "DISPUTED_BILL";

export type ApResolution = {
  billId: string;
  action: ApResolutionAction;
  note: string;
  matchingBillId: string | null;
  actor: string;
  updatedAt: string;
};

const createTableSql = `
  CREATE TABLE IF NOT EXISTS ap_resolutions (
    bill_id TEXT PRIMARY KEY NOT NULL,
    action TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    matching_bill_id TEXT,
    actor TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

async function ensureResolutionTable() {
  await env.DB.prepare(createTableSql).run();
}

export async function listApResolutions() {
  await ensureResolutionTable();
  const result = await env.DB.prepare(`
    SELECT
      bill_id AS billId,
      action,
      note,
      matching_bill_id AS matchingBillId,
      actor,
      updated_at AS updatedAt
    FROM ap_resolutions
  `).all<ApResolution>();
  return result.results || [];
}

export async function saveApResolution(input: {
  billId: string;
  action: ApResolutionAction;
  note: string;
  matchingBillId?: string | null;
  actor: string;
}) {
  await ensureResolutionTable();
  await env.DB.prepare(`
    INSERT INTO ap_resolutions (bill_id, action, note, matching_bill_id, actor, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(bill_id) DO UPDATE SET
      action = excluded.action,
      note = excluded.note,
      matching_bill_id = excluded.matching_bill_id,
      actor = excluded.actor,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    input.billId,
    input.action,
    input.note,
    input.matchingBillId || null,
    input.actor,
  ).run();

  return (await listApResolutions()).find((resolution) => resolution.billId === input.billId) || null;
}

export async function clearApResolution(billId: string) {
  await ensureResolutionTable();
  await env.DB.prepare("DELETE FROM ap_resolutions WHERE bill_id = ?").bind(billId).run();
}

/** Used by the demo reset. Drops every saved exception decision. */
export async function clearAllApResolutions() {
  await ensureResolutionTable();
  const result = await env.DB.prepare("DELETE FROM ap_resolutions").run();
  return Number(result.meta?.changes || 0);
}
