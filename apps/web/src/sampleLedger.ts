/**
 * Example receipts loaded when the server starts, so the proof page is
 * not empty after a restart. They are labeled as examples. They do not
 * use PayPal order ids. Live decisions from this session are appended
 * after them.
 */
import { appendLedgerEntry, type LedgerDecision, type LedgerEntry } from "./ledger.js";

export const SAMPLE_RECEIPT_LABEL = "Sample receipt (example data)";

const SAMPLE_QUOTE = "Sample receipt (example data). This is not a live payment.";

interface SampleRow {
  id: string;
  at: string;
  decision: LedgerDecision;
  outcome: string;
  purpose: string;
}

const SAMPLE_ROWS: readonly SampleRow[] = [
  {
    id: "sample-approve",
    at: "2026-11-09T12:00:00.000Z",
    decision: "approve",
    outcome: "Approve",
    purpose: "Approve example",
  },
  {
    id: "sample-reject",
    at: "2026-11-09T12:00:01.000Z",
    decision: "reject",
    outcome: "Reject",
    purpose: "Reject example",
  },
  {
    id: "sample-needs-a-look",
    at: "2026-11-09T12:00:02.000Z",
    decision: "needs-a-look",
    outcome: "Needs a look",
    purpose: "Needs a look example",
  },
];

export interface SampleReceiptView {
  id: string;
  sample: true;
  label: string;
  outcome: string;
  payee: string;
  amount: string;
  currency: string;
  purpose: string;
  orderId: null;
  captureId: null;
  capturedAt: null;
  quotes: string[];
}

function draftFor(row: SampleRow): { id: string; payee: string; amount: string; currency: string; purpose: string } {
  return {
    id: row.id,
    payee: SAMPLE_RECEIPT_LABEL,
    amount: "0.00",
    currency: "USD",
    purpose: row.purpose,
  };
}

export function sampleReceiptViews(): SampleReceiptView[] {
  return SAMPLE_ROWS.map((row) => ({
    id: row.id,
    sample: true as const,
    label: SAMPLE_RECEIPT_LABEL,
    outcome: row.outcome,
    payee: SAMPLE_RECEIPT_LABEL,
    amount: "0.00",
    currency: "USD",
    purpose: row.purpose,
    orderId: null,
    captureId: null,
    capturedAt: null,
    quotes: [SAMPLE_QUOTE],
  }));
}

export function sampleReceiptById(id: string): SampleReceiptView | null {
  return sampleReceiptViews().find((receipt) => receipt.id === id) ?? null;
}

/** A fresh chain. Each call returns new objects so one server cannot mutate another's seed. */
export function seedSampleLedger(): LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  for (const row of SAMPLE_ROWS) {
    const entry = appendLedgerEntry(entries, {
      at: row.at,
      decision: row.decision,
      draft: draftFor(row),
      quotes: [SAMPLE_QUOTE],
      paypalOrderId: null,
      paypalCaptureId: null,
    });
    entries.push({
      ...entry,
      sample: true,
      label: SAMPLE_RECEIPT_LABEL,
      outcome: row.outcome,
    });
  }
  return entries;
}
