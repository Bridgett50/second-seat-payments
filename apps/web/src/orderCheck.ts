/**
 * Decide the next step from a status PayPal returned on a fetched order.
 * "Captured" is allowed only when that fetched status is COMPLETED.
 */

export type CaptureStep = "already-complete" | "capture" | "stop";

export function nextCaptureStep(status: string): CaptureStep {
  const normalized = status.trim().toUpperCase();
  if (normalized === "COMPLETED") return "already-complete";
  if (normalized === "APPROVED") return "capture";
  return "stop";
}

export function verifiedCaptured(status: string): boolean {
  return status.trim().toUpperCase() === "COMPLETED";
}
