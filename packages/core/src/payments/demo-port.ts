/**
 * Demo PayPal port: simulates the PayPal sandbox end to end with no
 * network and no credentials, so the approval-gated flow can be run and
 * judged anywhere. It implements the same port contract and drives the
 * same state machine and approval log as the real sandbox client; only
 * the order ids, URLs, and details differ, and all three are stamped
 * DEMO so a simulated entry can never be mistaken for a real one:
 *
 * - order ids are prefixed `DEMO-ORDER-`;
 * - the checkout URL is on `demo.invalid`, a TLD that can never resolve;
 * - the port's mode is "demo", which the gate stamps on every log entry.
 */
import { randomUUID } from "node:crypto";
import type { CreatedOrder, PayPalPort } from "./port.js";
import type { PaymentCommitmentInput } from "./types.js";

export function createDemoPayPalPort(): PayPalPort {
  const orders = new Map<string, { cancelled: boolean }>();
  let counter = 0;
  return {
    mode: "demo",
    async createOrder(
      commitment: PaymentCommitmentInput & { id: string },
    ): Promise<CreatedOrder> {
      counter += 1;
      const orderId = `DEMO-ORDER-${counter}-${randomUUID().slice(0, 8).toUpperCase()}`;
      orders.set(orderId, { cancelled: false });
      void commitment;
      return {
        orderId,
        checkoutUrl: `https://demo.invalid/paypal/checkout?token=${orderId}`,
      };
    },
    async cancelOrder(orderId: string): Promise<{ detail: string }> {
      const order = orders.get(orderId);
      if (order === undefined) {
        return {
          detail: `DEMO cancellation: order ${orderId} was not created by this demo port; nothing to cancel.`,
        };
      }
      order.cancelled = true;
      return {
        detail: `DEMO cancellation: simulated PayPal sandbox order ${orderId} cancelled; no real order exists and no money was ever held.`,
      };
    },
  };
}
