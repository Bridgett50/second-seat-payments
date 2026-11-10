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
  EVAL_TARGETS,
  evaluateMeetings,
  findDrafts,
  FRAUD_EVAL_TARGETS,
  loadFraudMeetings,
  runFraudEval,
  scoreFraudSet,
  receiptPurpose,
  recordedTargetsMet,
  samePayment,
  scorePayments,
  scoreTraps,
  standInTargetsMet,
  DEFAULT_OPENAI_MODEL,
} from "./drafts/index.js";
export type {
  AdmitResult,
  CheckResult,
  CheckStep,
  DraftBatch,
  DrafterMode,
  EvalMeetingInput,
  EvalReport,
  EvalTrapInput,
  FraudDraftRow,
  FraudEvalReport,
  FraudMeetingFile,
  FraudMeetingInput,
  FraudRunResult,
  MeetingEvalRow,
  PaymentDraft,
  ScoredDraft,
  StandInLibrary,
  TrapDefinition,
  TrapEvalRow,
  TrapOutcome,
  TrapScore,
  Verdict,
} from "./drafts/index.js";
