import { describe, expect, it } from "vitest";
import {
  createDemoPayPalPort,
  createPaymentGate,
  type PayPalPort,
} from "../src/index.js";

const commitment = {
  meetingId: "meeting-2026-11-06-standup",
  amount: "1250.00",
  currency: "USD",
  payee: "Apex Venue Rentals",
  purpose: "Deposit for the December showcase venue",
  sourceSegmentId: "t-12:40",
};

describe("approval-gated payments (demo mode)", () => {
  it("holds a proposed commitment in pending_owner_approval with a demo order", async () => {
    const gate = createPaymentGate({ port: createDemoPayPalPort() });
    const record = await gate.propose(commitment, "second-seat");
    expect(record.status).toBe("pending_owner_approval");
    expect(record.mode).toBe("demo");
    expect(record.paypalOrderId.startsWith("DEMO-ORDER-")).toBe(true);
    expect(record.checkoutUrl).toContain("demo.invalid");
    expect(record.decidedBy).toBeNull();
  });

  it("writes a proposed entry to the approval log, stamped with the mode", async () => {
    const gate = createPaymentGate({ port: createDemoPayPalPort() });
    const record = await gate.propose(commitment, "second-seat");
    const log = gate.approvalLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      seq: 1,
      actor: "second-seat",
      action: "proposed",
      commitmentId: record.id,
      meetingId: commitment.meetingId,
      amount: "1250.00",
      currency: "USD",
      payee: "Apex Venue Rentals",
      mode: "demo",
      paypalOrderId: record.paypalOrderId,
    });
  });

  it("moves to approved_for_checkout only on an explicit owner approve", async () => {
    const gate = createPaymentGate({ port: createDemoPayPalPort() });
    const record = await gate.propose(commitment, "second-seat");
    const approved = await gate.approve(record.id, "owner");
    expect(approved.status).toBe("approved_for_checkout");
    expect(approved.decidedBy).toBe("owner");
    expect(approved.decidedAt).not.toBeNull();
    const log = gate.approvalLog();
    expect(log.map((e) => e.action)).toEqual(["proposed", "owner_approved"]);
    expect(log[1]?.mode).toBe("demo");
  });

  it("reject cancels the order and records the rejection", async () => {
    const gate = createPaymentGate({ port: createDemoPayPalPort() });
    const record = await gate.propose(commitment, "second-seat");
    const rejected = await gate.reject(record.id, "owner", "Amount not agreed");
    expect(rejected.status).toBe("rejected");
    expect(rejected.decidedBy).toBe("owner");
    expect(rejected.decisionNote).toContain("Amount not agreed");
    const log = gate.approvalLog();
    expect(log.map((e) => e.action)).toEqual(["proposed", "owner_rejected"]);
    expect(log[1]?.detail).toContain("DEMO");
  });

  it("refuses to decide a commitment twice", async () => {
    const gate = createPaymentGate({ port: createDemoPayPalPort() });
    const record = await gate.propose(commitment, "second-seat");
    await gate.reject(record.id, "owner");
    await expect(gate.approve(record.id, "owner")).rejects.toThrow(/already/);
    await expect(gate.reject(record.id, "owner")).rejects.toThrow(/already/);
  });

  it("refuses unknown ids and invalid amounts", async () => {
    const gate = createPaymentGate({ port: createDemoPayPalPort() });
    await expect(gate.approve("pay_missing", "owner")).rejects.toThrow(/unknown/);
    await expect(
      gate.propose({ ...commitment, amount: "0.00" }, "second-seat"),
    ).rejects.toThrow(/amount/);
    await expect(
      gate.propose({ ...commitment, amount: "12.5" }, "second-seat"),
    ).rejects.toThrow(/amount/);
    await expect(
      gate.propose({ ...commitment, payee: "  " }, "second-seat"),
    ).rejects.toThrow(/payee/);
  });
});

describe("approval log mode labelling", () => {
  it("stamps entries with the port's mode, so sandbox is never read as demo", async () => {
    const sandboxStub: PayPalPort = {
      mode: "sandbox",
      async createOrder() {
        return { orderId: "8AB12345CD678901E", checkoutUrl: "https://www.sandbox.paypal.com/checkoutnow?token=8AB12345CD678901E" };
      },
      async cancelOrder() {
        return { detail: "stub cancellation" };
      },
    };
    const gate = createPaymentGate({ port: sandboxStub });
    const record = await gate.propose(commitment, "second-seat");
    expect(record.mode).toBe("sandbox");
    expect(gate.approvalLog()[0]?.mode).toBe("sandbox");
  });
});
