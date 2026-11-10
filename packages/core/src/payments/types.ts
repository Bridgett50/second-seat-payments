/**
 * Approval-gated payments: shared types.
 *
 * A payment commitment is something a meeting produced: an amount, a
 * payee, and a purpose. Second Seat may prepare the PayPal order, but the
 * order sits in `pending_owner_approval` until the owner personally
 * approves or rejects it. This mirrors the outgoing safeguard's rule for
 * messages: the twin drafts, only a person commits.
 */

/** Which PayPal environment produced an order: simulated demo or sandbox. */
export type PaymentMode = "demo" | "sandbox";

/**
 * One payment commitment extracted from a meeting record.
 * `amount` is a decimal string (e.g. "1250.00"), never a float, so money
 * is never rounded by binary arithmetic.
 */
export interface PaymentCommitmentInput {
  meetingId: string;
  amount: string;
  /** ISO 4217 code, e.g. "USD". */
  currency: string;
  payee: string;
  purpose: string;
  /** Transcript segment the commitment came from, when known. */
  sourceSegmentId?: string;
}

export type PaymentStatus =
  | "pending_owner_approval"
  | "approved_for_checkout"
  | "rejected";

/** A commitment plus its PayPal order and owner-decision state. */
export interface PaymentRecord {
  id: string;
  meetingId: string;
  amount: string;
  currency: string;
  payee: string;
  purpose: string;
  sourceSegmentId: string | null;
  status: PaymentStatus;
  /** Environment that created the PayPal order ("demo" or "sandbox"). */
  mode: PaymentMode;
  paypalOrderId: string;
  /**
   * PayPal approval/checkout URL for the order. It is only acted on after
   * the owner approves; while pending it is stored, never surfaced as an
   * instruction to pay.
   */
  checkoutUrl: string | null;
  /** ISO-8601 creation time. */
  createdAt: string;
  /** ISO-8601 decision time, once the owner decides. */
  decidedAt: string | null;
  /** Who decided ("owner" in the product; the actor passed to the gate). */
  decidedBy: string | null;
  /** The owner's rejection note, or the cancellation detail, when any. */
  decisionNote: string | null;
}

export type ApprovalAction = "proposed" | "owner_approved" | "owner_rejected";

/**
 * One append-only approval-log entry. Every state change writes one, with
 * the mode that produced it, so a demo entry can never be mistaken for a
 * sandbox entry after the fact.
 */
export interface ApprovalLogEntry {
  /** 1-based sequence number within the gate's log. */
  seq: number;
  /** ISO-8601 time of the state change. */
  at: string;
  /** Who acted: the proposer (e.g. "second-seat") or the owner. */
  actor: string;
  action: ApprovalAction;
  commitmentId: string;
  meetingId: string;
  amount: string;
  currency: string;
  payee: string;
  mode: PaymentMode;
  paypalOrderId: string;
  detail: string;
}
