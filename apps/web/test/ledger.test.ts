import { describe, expect, it } from "vitest";
import { appendLedgerEntry, LEDGER_GENESIS, verifyLedger, type LedgerEntry } from "../src/ledger.js";

function input(decision: "approve" | "reject" | "capture", quote: string) {
  return {
    at: "2026-11-10T03:00:00.000Z",
    decision,
    draft: {
      id: "draft-1",
      payee: "Harbor Print",
      amount: "480.00",
      currency: "USD",
      purpose: "Spring menus",
    },
    quotes: [quote],
    paypalOrderId: "ORDER-1",
    paypalCaptureId: decision === "capture" ? "CAP-1" : null,
  };
}

describe("decision ledger", () => {
  it("chains each entry to the hash of the previous one", () => {
    const first = appendLedgerEntry([], input("approve", "I'll pay Harbor Print $480 on Friday for the spring menus."));
    const second = appendLedgerEntry([first], input("capture", "I'll pay Harbor Print $480 on Friday for the spring menus."));
    expect(first.previousHash).toBe(LEDGER_GENESIS);
    expect(first.hash).toHaveLength(64);
    expect(second.previousHash).toBe(first.hash);
    expect(second.seq).toBe(2);
    expect(verifyLedger([first, second])).toEqual({ ok: true, checked: 2, brokenAt: null });
  });

  it("fails verification when a quote is changed after the hash was written", () => {
    const first = appendLedgerEntry([], input("approve", "I'll pay Harbor Print $480 on Friday for the spring menus."));
    const tampered: LedgerEntry = {
      ...first,
      quotes: ["I'll pay Harbor Print $999 on Friday for the spring menus."],
    };
    const check = verifyLedger([tampered]);
    expect(check.ok).toBe(false);
    expect(check.brokenAt).toBe(1);
  });

  it("does not put a secret in the entry", () => {
    const secret = "sk-live-DO-NOT-LEAK";
    const entry = appendLedgerEntry([], input("approve", "I'll pay Harbor Print $480."));
    expect(JSON.stringify(entry)).not.toContain(secret);
    expect(entry.draft.payee).toBe("Harbor Print");
    expect(entry.quotes[0]).toContain("$480");
  });
});
