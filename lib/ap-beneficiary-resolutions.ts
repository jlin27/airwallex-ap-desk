import { env } from "cloudflare:workers";

export type ApBeneficiaryResolutionAction =
  | "MATCHED_BENEFICIARY"
  | "REQUESTED_BENEFICIARY_SETUP"
  | "INCORRECT_VENDOR";

export type ApBeneficiaryResolution = {
  billId: string;
  action: ApBeneficiaryResolutionAction;
  beneficiaryId: string | null;
  beneficiaryName: string | null;
  note: string;
  actor: string;
  updatedAt: string;
};

const createTableSql = `
  CREATE TABLE IF NOT EXISTS ap_beneficiary_resolutions (
    bill_id TEXT PRIMARY KEY NOT NULL,
    action TEXT NOT NULL,
    beneficiary_id TEXT,
    beneficiary_name TEXT,
    note TEXT NOT NULL DEFAULT '',
    actor TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

async function ensureTable() {
  await env.DB.prepare(createTableSql).run();
}

export async function listApBeneficiaryResolutions() {
  await ensureTable();
  const result = await env.DB.prepare(`
    SELECT
      bill_id AS billId,
      action,
      beneficiary_id AS beneficiaryId,
      beneficiary_name AS beneficiaryName,
      note,
      actor,
      updated_at AS updatedAt
    FROM ap_beneficiary_resolutions
  `).all<ApBeneficiaryResolution>();
  return result.results || [];
}

export async function saveApBeneficiaryResolution(input: {
  billId: string;
  action: ApBeneficiaryResolutionAction;
  beneficiaryId?: string | null;
  beneficiaryName?: string | null;
  note: string;
  actor: string;
}) {
  await ensureTable();
  await env.DB.prepare(`
    INSERT INTO ap_beneficiary_resolutions (
      bill_id, action, beneficiary_id, beneficiary_name, note, actor, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(bill_id) DO UPDATE SET
      action = excluded.action,
      beneficiary_id = excluded.beneficiary_id,
      beneficiary_name = excluded.beneficiary_name,
      note = excluded.note,
      actor = excluded.actor,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    input.billId,
    input.action,
    input.beneficiaryId || null,
    input.beneficiaryName || null,
    input.note,
    input.actor,
  ).run();

  return (await listApBeneficiaryResolutions()).find((resolution) => resolution.billId === input.billId) || null;
}

export async function clearApBeneficiaryResolution(billId: string) {
  await ensureTable();
  await env.DB.prepare("DELETE FROM ap_beneficiary_resolutions WHERE bill_id = ?").bind(billId).run();
}
