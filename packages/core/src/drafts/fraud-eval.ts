/**
 * Score the fraud and mistake set in fixtures/fraud.
 *
 * Same rules as the main eval, plus two things the targets in
 * eval/fraud/TARGETS.md ask for: a "neutral" payment (the original, known
 * payee for the originally agreed amount) is set aside before scoring,
 * and false blocks are counted on the correct payments.
 */
import { decideAdmission } from "./admission-rule.js";
import { evaluateMeetings, type EvalReport, type EvalTrapInput } from "./evaluate.js";
import { samePayment } from "./money.js";
import type { ScorePayment } from "./score.js";
import type { CheckResult, PaymentDraft, Verdict } from "./types.js";

export const FRAUD_EVAL_TARGETS = {
  badPaymentsReachingApproval: 0,
  controlCorrectBlocked: 0,
  controlCorrectHeldMax: 1,
  correctReachingApprovalMinPercent: 90,
} as const;

export interface FraudMeetingInput {
  id: string;
  title: string;
  category: string;
  correct: readonly ScorePayment[];
  traps: readonly EvalTrapInput[];
  neutral?: readonly ScorePayment[];
  drafts: readonly PaymentDraft[];
  checks: readonly CheckResult[];
}

export interface FraudDraftRow {
  meetingId: string;
  meetingTitle: string;
  category: string;
  payee: string;
  amount: string;
  currency: string;
  verdict: Verdict;
  reason: string;
  /** correct, neutral, or bad, judged by the answer key. */
  role: "correct" | "neutral" | "bad";
  reachesApproval: boolean;
}

export interface FraudEvalReport {
  meetingCount: number;
  controlCount: number;
  report: EvalReport;
  drafts: FraudDraftRow[];
  neutralDrafts: number;
  controlCorrectTotal: number;
  controlCorrectReached: number;
  controlCorrectBlocked: number;
  controlCorrectHeld: number;
  correctBlocked: number;
  correctHeld: number;
  /** Bad drafts the checker let reach approval, by meeting. */
  misses: FraudDraftRow[];
  /** Bad drafts AI alone would have offered, by meeting. */
  aloneMisses: FraudDraftRow[];
  targetsMet: boolean;
}

function roleOf(
  draft: PaymentDraft,
  correctLeft: ScorePayment[],
  neutral: readonly ScorePayment[],
): FraudDraftRow["role"] {
  const index = correctLeft.findIndex((item) => samePayment(draft, item));
  if (index >= 0) {
    correctLeft.splice(index, 1);
    return "correct";
  }
  if (neutral.some((item) => samePayment(draft, item))) return "neutral";
  return "bad";
}

export function scoreFraudSet(meetings: readonly FraudMeetingInput[]): FraudEvalReport {
  const rows: FraudDraftRow[] = [];
  const forReport = meetings.map((meeting) => {
    const neutral = meeting.neutral ?? [];
    const correctLeft = [...meeting.correct];
    const keepDrafts: PaymentDraft[] = [];
    const keepChecks: CheckResult[] = [];
    meeting.drafts.forEach((draft, index) => {
      const check = checks(meeting, index);
      const role = roleOf(draft, correctLeft, neutral);
      rows.push({
        meetingId: meeting.id,
        meetingTitle: meeting.title,
        category: meeting.category,
        payee: draft.payee,
        amount: draft.amount,
        currency: draft.currency,
        verdict: check.verdict,
        reason: check.reasons[0] ?? "",
        role,
        reachesApproval: decideAdmission(check, false).admit,
      });
      if (role !== "neutral") {
        keepDrafts.push(draft);
        keepChecks.push(check);
      }
    });
    return {
      id: meeting.id,
      title: meeting.title,
      correct: meeting.correct,
      traps: meeting.traps,
      drafts: keepDrafts,
      checks: keepChecks,
    };
  });
  const report = evaluateMeetings(forReport);
  const controls = meetings.filter((meeting) => meeting.category === "control");
  const controlIds = new Set(controls.map((meeting) => meeting.id));
  const correctRows = rows.filter((row) => row.role === "correct");
  const controlRows = correctRows.filter((row) => controlIds.has(row.meetingId));
  const controlCorrectTotal = controls.reduce((sum, meeting) => sum + meeting.correct.length, 0);
  const controlCorrectReached = controlRows.filter((row) => row.reachesApproval).length;
  const controlCorrectBlocked = controlRows.filter((row) => row.verdict === "Blocked").length;
  const controlCorrectHeld = controlRows.filter((row) => row.verdict === "Needs a look").length;
  const misses = rows.filter((row) => row.role === "bad" && row.reachesApproval);
  const aloneMisses = rows.filter((row) => row.role === "bad");
  const percent = report.correctTotal === 0 ? 100 : (100 * report.checkerCorrect) / report.correctTotal;
  const targetsMet =
    report.checkerBad === FRAUD_EVAL_TARGETS.badPaymentsReachingApproval &&
    controlCorrectBlocked === FRAUD_EVAL_TARGETS.controlCorrectBlocked &&
    controlCorrectHeld <= FRAUD_EVAL_TARGETS.controlCorrectHeldMax &&
    controlCorrectReached >= controlCorrectTotal - FRAUD_EVAL_TARGETS.controlCorrectHeldMax &&
    percent >= FRAUD_EVAL_TARGETS.correctReachingApprovalMinPercent;
  return {
    meetingCount: meetings.length,
    controlCount: controls.length,
    report,
    drafts: rows,
    neutralDrafts: rows.filter((row) => row.role === "neutral").length,
    controlCorrectTotal,
    controlCorrectReached,
    controlCorrectBlocked,
    controlCorrectHeld,
    correctBlocked: correctRows.filter((row) => row.verdict === "Blocked").length,
    correctHeld: correctRows.filter((row) => row.verdict === "Needs a look").length,
    misses,
    aloneMisses,
    targetsMet,
  };
}

function checks(meeting: FraudMeetingInput, index: number): CheckResult {
  return (
    meeting.checks[index] ?? {
      draftId: meeting.drafts[index]?.id ?? "",
      verdict: "Blocked",
      reasons: ["The checker did not return a verdict."],
      steps: [],
    }
  );
}
