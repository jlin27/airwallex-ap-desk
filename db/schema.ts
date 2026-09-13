import { sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const apResolutions = sqliteTable("ap_resolutions", {
  billId: text("bill_id").primaryKey(),
  action: text("action").notNull(),
  note: text("note").notNull().default(""),
  matchingBillId: text("matching_bill_id"),
  actor: text("actor").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const apBeneficiaryResolutions = sqliteTable("ap_beneficiary_resolutions", {
  billId: text("bill_id").primaryKey(),
  action: text("action").notNull(),
  beneficiaryId: text("beneficiary_id"),
  beneficiaryName: text("beneficiary_name"),
  note: text("note").notNull().default(""),
  actor: text("actor").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
