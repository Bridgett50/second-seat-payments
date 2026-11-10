/**
 * Hand a checked draft to the approval gate, or hold it back.
 *
 * Proven drafts may be proposed. Needs a look may be proposed only after
 * the owner explicitly confirms that draft. Blocked drafts are never
 * proposed, confirmation or not. The quote is stored on the payment as
 * its receipt.
 */
import type { PaymentGate } from "../payments/gate.js";
import type { PaymentCommitmentInput, PaymentRecord } from "../payments/types.js";
import { decideAdmission } from "./admission-rule.js";
import { normalizeAmount, normalizeCurrency } from "./money.js";
import type { CheckResult, PaymentDraft } from "./types.js";

export interface AdmitInput {
  gate: PaymentGate;
  meetingId: string;
  draft: PaymentDraft;
  check: CheckResult;
  /** True only when the owner has confirmed this specific "Needs a look" draft. */
  ownerConfirmedLook?: boolean;
  actor?: string;
}

export type AdmitResult =
  | { admitted: false; explanation: string }
  | { admitted: true; explanation: string; record: PaymentRecord };

export function receiptPurpose(draft: PaymentDraft): string {
  const parts = [draft.purpose.trim() || "Payment agreed in the meeting"];
  if (draft.due.trim().length > 0) parts.push(`Due ${draft.due.trim()}.`);
  const quote = draft.quotes.map((item) => item.trim()).find((item) => item.length > 0);
  if (quote !== undefined) parts.push(`Receipt: "${quote}"`);
  return parts.join(" ");
}

export async function admitDraftToGate(input: AdmitInput): Promise<AdmitResult> {
  const decision = decideAdmission(input.check, input.ownerConfirmedLook === true);
  if (!decision.admit) {
    return { admitted: false, explanation: decision.explanation };
  }

  const amount = normalizeAmount(input.draft.amount);
  const currency = normalizeCurrency(input.draft.currency);
  if (amount === null || currency === null || input.draft.payee.trim().length === 0) {
    return {
      admitted: false,
      explanation: "This draft is not a payable amount, so it cannot reach the approval gate.",
    };
  }

  const commitment: PaymentCommitmentInput = {
    meetingId: input.meetingId,
    amount,
    currency,
    payee: input.draft.payee.trim(),
    purpose: receiptPurpose(input.draft),
    ...(input.draft.id.trim().length > 0 ? { sourceSegmentId: input.draft.id } : {}),
  };
  const record = await input.gate.propose(commitment, input.actor ?? "second-seat");
  return { admitted: true, explanation: decision.explanation, record };
}
