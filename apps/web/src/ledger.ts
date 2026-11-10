/**
 * A hash-chained ledger of approve, reject, and capture decisions.
 * Each entry names the previous entry's SHA-256. Verify walks the chain
 * and recomputes every hash. Entries hold the draft, the quotes, the
 * decision, and PayPal ids. They do not hold secrets.
 */
import { createHash } from "node:crypto";

export const LEDGER_GENESIS = "0".repeat(64);

export type LedgerDecision = "approve" | "reject" | "capture";

export interface LedgerDraft {
  id: string;
  payee: string;
  amount: string;
  currency: string;
  purpose: string;
}

export interface LedgerEntry {
  seq: number;
  previousHash: string;
  at: string;
  decision: LedgerDecision;
  draft: LedgerDraft;
  quotes: string[];
  paypalOrderId: string | null;
  paypalCaptureId: string | null;
  hash: string;
}

export interface LedgerInput {
  at: string;
  decision: LedgerDecision;
  draft: LedgerDraft;
  quotes: readonly string[];
  paypalOrderId: string | null;
  paypalCaptureId: string | null;
}

export interface LedgerCheck {
  ok: boolean;
  checked: number;
  brokenAt: number | null;
}

function canonical(entry: Omit<LedgerEntry, "hash">): string {
  return JSON.stringify([
    entry.seq,
    entry.previousHash,
    entry.at,
    entry.decision,
    [entry.draft.id, entry.draft.payee, entry.draft.amount, entry.draft.currency, entry.draft.purpose],
    entry.quotes,
    entry.paypalOrderId,
    entry.paypalCaptureId,
  ]);
}

export function ledgerHash(entry: Omit<LedgerEntry, "hash">): string {
  return createHash("sha256").update(canonical(entry), "utf8").digest("hex");
}

export function appendLedgerEntry(previous: readonly LedgerEntry[], input: LedgerInput): LedgerEntry {
  const prior = previous[previous.length - 1];
  const body: Omit<LedgerEntry, "hash"> = {
    seq: previous.length + 1,
    previousHash: prior === undefined ? LEDGER_GENESIS : prior.hash,
    at: input.at,
    decision: input.decision,
    draft: {
      id: input.draft.id,
      payee: input.draft.payee,
      amount: input.draft.amount,
      currency: input.draft.currency,
      purpose: input.draft.purpose,
    },
    quotes: [...input.quotes],
    paypalOrderId: input.paypalOrderId,
    paypalCaptureId: input.paypalCaptureId,
  };
  return { ...body, hash: ledgerHash(body) };
}

/** Recompute every hash. The first entry must point at the genesis hash. */
export function verifyLedger(entries: readonly LedgerEntry[]): LedgerCheck {
  let previous = LEDGER_GENESIS;
  for (const entry of entries) {
    if (entry.previousHash !== previous) {
      return { ok: false, checked: entry.seq, brokenAt: entry.seq };
    }
    const { hash, ...body } = entry;
    if (hash !== ledgerHash(body)) {
      return { ok: false, checked: entry.seq, brokenAt: entry.seq };
    }
    previous = hash;
  }
  return { ok: true, checked: entries.length, brokenAt: null };
}
