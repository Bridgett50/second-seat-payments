/**
 * Public entry for this package. It re-exports the approval gate, the
 * payment finder, and the deterministic checker.
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
export {
  admitDraftToGate,
  checkDraft,
  checkDrafts,
  decideAdmission,
  findDrafts,
  receiptPurpose,
  samePayment,
  scorePayments,
  DEFAULT_OPENAI_MODEL,
} from "./drafts/index.js";
export type {
  AdmitResult,
  CheckResult,
  DraftBatch,
  DrafterMode,
  PaymentDraft,
  StandInLibrary,
  Verdict,
} from "./drafts/index.js";
