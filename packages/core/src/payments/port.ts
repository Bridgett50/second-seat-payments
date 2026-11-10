/**
 * PayPal port for approval-gated payments (injected, like the T2 meeting
 * connector port). Core defines the contract and the state machine; the
 * host wires in a concrete implementation:
 *
 * - `createDemoPayPalPort` (this package): simulates the PayPal sandbox
 *   end to end with no network and no credentials.
 * - `createPayPalSandboxPort` (`apps/web`): the real PayPal Checkout REST
 *   client for the sandbox environment, credentials from the environment.
 *
 * Core itself never fetches: its dependency guard forbids network calls
 * in `src`, so all HTTP lives behind this port in the host app.
 */
import type { PaymentCommitmentInput, PaymentMode } from "./types.js";

export interface CreatedOrder {
  /** PayPal order id (demo ids are prefixed `DEMO-ORDER-`). */
  orderId: string;
  /** PayPal approval/checkout URL for the order, when the API returns one. */
  checkoutUrl: string | null;
}

export interface PayPalPort {
  /** Environment this port talks to; stamped on every record and log entry. */
  readonly mode: PaymentMode;
  /**
   * Create a PayPal order for the commitment. The order is created only;
   * creating it never captures money, and the gate holds it in
   * `pending_owner_approval` until the owner decides.
   */
  createOrder(commitment: PaymentCommitmentInput & { id: string }): Promise<CreatedOrder>;
  /**
   * Cancel an order the owner rejected. Returns a human-readable detail
   * for the approval log. An order that was never approved or captured
   * can never charge anyone; cancellation records that it is abandoned.
   */
  cancelOrder(orderId: string): Promise<{ detail: string }>;
}
