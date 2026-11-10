/**
 * Public entry for this package. It re-exports the approval gate for the
 * copied tests and the PayPal sandbox client.
 */
export {
  createDemoPayPalPort,
  createPaymentGate,
} from "./payments/index.js";
export type {
  ApprovalAction,
  ApprovalLogEntry,
  CreatedOrder,
  PayPalPort,
  PaymentCommitmentInput,
  PaymentGate,
  PaymentGateOptions,
  PaymentMode,
  PaymentRecord,
  PaymentStatus,
} from "./payments/index.js";
