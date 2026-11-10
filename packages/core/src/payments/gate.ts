/**
 * Approval gate for payment commitments.
 *
 * State machine:
 *
 *   propose -> pending_owner_approval --owner approve--> approved_for_checkout
 *                                     \-owner reject--> rejected (order cancelled)
 *
 * Invariants, mirroring the product's thesis:
 *
 * - Creating the PayPal order never commits anything. The order waits in
 *   `pending_owner_approval`; its checkout URL is stored, not acted on.
 * - Only an explicit owner decision moves a record out of pending, and a
 *   record can be decided exactly once.
 * - Rejection cancels the order through the port before the state flips,
 *   so a rejected commitment never leaves a live order behind.
 * - Every transition appends to an auditable approval log stamped with
 *   the mode ("demo" or "sandbox") that produced it.
 */
import { randomUUID } from "node:crypto";
import type { PayPalPort } from "./port.js";
import type {
  ApprovalLogEntry,
  PaymentCommitmentInput,
  PaymentRecord,
} from "./types.js";

export interface PaymentGateOptions {
  port: PayPalPort;
  /** Clock, injectable for tests. Defaults to the system clock. */
  now?: () => Date;
}

export interface PaymentGate {
  /** Create the PayPal order and hold the commitment for the owner. */
  propose(input: PaymentCommitmentInput, actor: string): Promise<PaymentRecord>;
  /** Owner approves: the record moves to the PayPal checkout step. */
  approve(id: string, actor: string): Promise<PaymentRecord>;
  /** Owner rejects: the order is cancelled and the rejection recorded. */
  reject(id: string, actor: string, note?: string): Promise<PaymentRecord>;
  get(id: string): PaymentRecord | null;
  list(): PaymentRecord[];
  /** A copy of the append-only approval log, in order. */
  approvalLog(): ApprovalLogEntry[];
}

const AMOUNT_PATTERN = /^\d+\.\d{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function validateCommitment(input: PaymentCommitmentInput): void {
  if (input.meetingId.trim().length === 0) {
    throw new Error("payment commitment requires a meetingId");
  }
  if (!AMOUNT_PATTERN.test(input.amount) || Number(input.amount) <= 0) {
    throw new Error(
      `payment commitment amount must be a positive decimal string with two fraction digits, got ${JSON.stringify(input.amount)}`,
    );
  }
  if (!CURRENCY_PATTERN.test(input.currency)) {
    throw new Error(
      `payment commitment currency must be a three-letter ISO code, got ${JSON.stringify(input.currency)}`,
    );
  }
  if (input.payee.trim().length === 0) {
    throw new Error("payment commitment requires a payee");
  }
  if (input.purpose.trim().length === 0) {
    throw new Error("payment commitment requires a purpose");
  }
}

export function createPaymentGate(options: PaymentGateOptions): PaymentGate {
  const port = options.port;
  const now = options.now ?? (() => new Date());
  const records = new Map<string, PaymentRecord>();
  const log: ApprovalLogEntry[] = [];

  function appendLog(
    entry: Omit<ApprovalLogEntry, "seq" | "at" | "mode">,
  ): void {
    log.push({
      ...entry,
      seq: log.length + 1,
      at: now().toISOString(),
      mode: port.mode,
    });
  }

  function requirePending(id: string): PaymentRecord {
    const record = records.get(id);
    if (record === undefined) {
      throw new Error(`unknown payment commitment: ${id}`);
    }
    if (record.status !== "pending_owner_approval") {
      throw new Error(
        `payment commitment ${id} is already decided (status: ${record.status})`,
      );
    }
    return record;
  }

  return {
    async propose(input, actor) {
      validateCommitment(input);
      const id = `pay_${randomUUID().slice(0, 8)}`;
      const order = await port.createOrder({ ...input, id });
      const record: PaymentRecord = {
        id,
        meetingId: input.meetingId,
        amount: input.amount,
        currency: input.currency,
        payee: input.payee,
        purpose: input.purpose,
        sourceSegmentId: input.sourceSegmentId ?? null,
        status: "pending_owner_approval",
        mode: port.mode,
        paypalOrderId: order.orderId,
        checkoutUrl: order.checkoutUrl,
        createdAt: now().toISOString(),
        decidedAt: null,
        decidedBy: null,
        decisionNote: null,
      };
      records.set(id, record);
      appendLog({
        actor,
        action: "proposed",
        commitmentId: id,
        meetingId: record.meetingId,
        amount: record.amount,
        currency: record.currency,
        payee: record.payee,
        paypalOrderId: record.paypalOrderId,
        detail: `PayPal order created and held in pending_owner_approval: ${record.purpose}`,
      });
      return record;
    },

    async approve(id, actor) {
      const record = requirePending(id);
      const decided: PaymentRecord = {
        ...record,
        status: "approved_for_checkout",
        decidedAt: now().toISOString(),
        decidedBy: actor,
      };
      records.set(id, decided);
      appendLog({
        actor,
        action: "owner_approved",
        commitmentId: id,
        meetingId: record.meetingId,
        amount: record.amount,
        currency: record.currency,
        payee: record.payee,
        paypalOrderId: record.paypalOrderId,
        detail: `Owner approved; the commitment moves to the PayPal approval/checkout step (${record.checkoutUrl ?? "no checkout URL returned"}). Capture happens only after checkout completes.`,
      });
      return decided;
    },

    async reject(id, actor, note) {
      const record = requirePending(id);
      const cancellation = await port.cancelOrder(record.paypalOrderId);
      const decided: PaymentRecord = {
        ...record,
        status: "rejected",
        decidedAt: now().toISOString(),
        decidedBy: actor,
        decisionNote: note ?? null,
      };
      records.set(id, decided);
      appendLog({
        actor,
        action: "owner_rejected",
        commitmentId: id,
        meetingId: record.meetingId,
        amount: record.amount,
        currency: record.currency,
        payee: record.payee,
        paypalOrderId: record.paypalOrderId,
        detail: `Owner rejected${note ? `: ${note}` : ""}. ${cancellation.detail}`,
      });
      return decided;
    },

    get(id) {
      return records.get(id) ?? null;
    },

    list() {
      return [...records.values()];
    },

    approvalLog() {
      return [...log];
    },
  };
}
