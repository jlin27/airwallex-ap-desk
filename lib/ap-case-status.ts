export type ApQueueStatus = "ATTENTION" | "READY" | "ON_HOLD" | "CLOSED";

type QueueableCase = {
  resolution: { action: string } | null;
  beneficiaryResolution: { action: string } | null;
  serverRecommendation: { recommendation: string };
};

const HOLD_RESOLUTIONS = new Set([
  "DISPUTED_BILL",
  "REQUESTED_INFORMATION",
  "REQUESTED_AMOUNT_EXPLANATION",
]);

const HOLD_BENEFICIARY_RESOLUTIONS = new Set([
  "REQUESTED_BENEFICIARY_SETUP",
  "INCORRECT_VENDOR",
]);

export function apQueueStatus(item: QueueableCase): ApQueueStatus {
  if (item.resolution?.action === "CONFIRMED_DUPLICATE") return "CLOSED";

  if (
    HOLD_RESOLUTIONS.has(item.resolution?.action || "")
    || HOLD_BENEFICIARY_RESOLUTIONS.has(item.beneficiaryResolution?.action || "")
  ) {
    return "ON_HOLD";
  }

  return item.serverRecommendation.recommendation === "READY_TO_VALIDATE"
    ? "READY"
    : "ATTENTION";
}
