import { describe, expect, it } from "vitest";
import { appendLedgerEntry, verifyLedger } from "../src/ledger.js";
import { SAMPLE_RECEIPT_LABEL, sampleReceiptViews, seedSampleLedger } from "../src/sampleLedger.js";

describe("sample ledger", () => {
  it("chains labeled examples without PayPal ids, then accepts a live entry after them", () => {
    const seeded = seedSampleLedger();
    expect(seeded.map((entry) => entry.decision)).toEqual(["approve", "reject", "needs-a-look"]);
    expect(seeded.every((entry) => entry.sample === true && entry.label === SAMPLE_RECEIPT_LABEL)).toBe(true);
    expect(seeded.every((entry) => entry.paypalOrderId === null && entry.paypalCaptureId === null)).toBe(true);
    expect(JSON.stringify(seeded)).not.toMatch(/\b[A-Z0-9]{17}\b/);
    expect(verifyLedger(seeded)).toEqual({ ok: true, checked: seeded.length, brokenAt: null });

    const live = appendLedgerEntry(seeded, {
      at: "2026-11-10T03:00:00.000Z",
      decision: "approve",
      draft: {
        id: "draft-1",
        payee: "Harbor Print",
        amount: "480.00",
        currency: "USD",
        purpose: "Spring menus",
      },
      quotes: ["I'll pay Harbor Print $480 on Friday for the spring menus."],
      paypalOrderId: null,
      paypalCaptureId: null,
    });
    expect(live.sample).toBeUndefined();
    expect(live.previousHash).toBe(seeded[seeded.length - 1]?.hash);
    expect(verifyLedger([...seeded, live])).toEqual({ ok: true, checked: seeded.length + 1, brokenAt: null });
    expect(sampleReceiptViews().map((receipt) => receipt.outcome)).toEqual(["Approve", "Reject", "Needs a look"]);
    expect(sampleReceiptViews().every((receipt) => receipt.orderId === null && receipt.captureId === null)).toBe(true);
  });
});
