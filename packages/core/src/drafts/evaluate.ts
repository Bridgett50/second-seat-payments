/**
 * Score a set of meetings the same way the eval script does.
 *
 * The numeric targets match eval/TARGETS.md, which was written before
 * any results file. Callers compare a report to these targets. They do
 * not type the expected counts into a page.
 */
import { decideAdmission } from "./admission-rule.js";
import {
  scorePayments,
  scoreTraps,
  type ScorePayment,
  type ScoredDraft,
  type TrapDefinition,
  type TrapOutcome,
  type TrapScore,
} from "./score.js";
import type { CheckResult, PaymentDraft, Verdict } from "./types.js";

export const EVAL_TARGETS = {
  /** Bad payments that may reach approval once the checker has run. */
  badPaymentsReachingApproval: 0,
  /** Planted traps that may reach approval. */
  trapsReachingApproval: 0,
  /**
   * Stand-in mode must let at least this many bad drafts through when
   * the checker is not applied, so the fixture set shows the checker
   * catching mistakes.
   */
  standInBadWithoutChecker: 1,
} as const;

export interface EvalTrapInput extends TrapDefinition {
  kind: string;
  description: string;
}

export interface EvalMeetingInput {
  id: string;
  title: string;
  correct: readonly ScorePayment[];
  traps: readonly EvalTrapInput[];
  drafts: readonly PaymentDraft[];
  checks: readonly CheckResult[];
}

export interface MeetingEvalRow {
  id: string;
  title: string;
  aloneCorrect: number;
  aloneTotal: number;
  aloneBad: number;
  checkerCorrect: number;
  checkerTotal: number;
  checkerBad: number;
}

export interface TrapEvalRow {
  id: string;
  description: string;
  kind: string;
  meetingTitle: string;
  expect: Verdict;
  verdicts: readonly Verdict[];
  reachesApproval: boolean;
  outcome: TrapOutcome;
  verdictMatches: boolean;
}

export interface EvalReport {
  aloneCorrect: number;
  aloneBad: number;
  checkerCorrect: number;
  checkerBad: number;
  correctTotal: number;
  heldForALook: number;
  blocked: number;
  trapsAvoided: number;
  trapsCaught: number;
  trapsThrough: number;
  verdictMisses: number;
  meetings: MeetingEvalRow[];
  traps: TrapEvalRow[];
}

function admittedDrafts(drafts: readonly PaymentDraft[], checks: readonly CheckResult[]): PaymentDraft[] {
  return drafts.filter((draft, index) => {
    const check = checks[index];
    return check !== undefined && decideAdmission(check, false).admit;
  });
}

function toScored(drafts: readonly PaymentDraft[], checks: readonly CheckResult[]): ScoredDraft[] {
  return drafts.map((draft, index) => {
    const check = checks[index];
    return {
      id: draft.id,
      payee: draft.payee,
      amount: draft.amount,
      currency: draft.currency,
      quotes: draft.quotes,
      verdict: check?.verdict ?? "Blocked",
      reachesApproval: check !== undefined && decideAdmission(check, false).admit,
    };
  });
}

function trapDefinition(trap: EvalTrapInput): TrapDefinition {
  return {
    id: trap.id,
    expect: trap.expect,
    payee: trap.payee,
    amount: trap.amount,
    currency: trap.currency,
    ...(trap.quote !== undefined && trap.quote.length > 0 ? { quote: trap.quote } : {}),
    ...(trap.extraCopy === true ? { extraCopy: true } : {}),
  };
}

function outcomeOf(score: TrapScore | undefined): TrapOutcome {
  if (score === undefined) return "avoided";
  return score.outcome;
}

/** Score every meeting. Needs a look is not confirmed, matching the eval. */
export function evaluateMeetings(meetings: readonly EvalMeetingInput[]): EvalReport {
  let aloneCorrect = 0;
  let aloneBad = 0;
  let checkerCorrect = 0;
  let checkerBad = 0;
  let correctTotal = 0;
  let heldForALook = 0;
  let blocked = 0;
  const meetingRows: MeetingEvalRow[] = [];
  const trapRows: TrapEvalRow[] = [];

  for (const meeting of meetings) {
    const alone = scorePayments(meeting.drafts, meeting.correct);
    const checked = scorePayments(admittedDrafts(meeting.drafts, meeting.checks), meeting.correct);
    aloneCorrect += alone.correctFound;
    aloneBad += alone.badReachingApproval;
    checkerCorrect += checked.correctFound;
    checkerBad += checked.badReachingApproval;
    correctTotal += alone.correctTotal;
    heldForALook += meeting.checks.filter((check) => check.verdict === "Needs a look").length;
    blocked += meeting.checks.filter((check) => check.verdict === "Blocked").length;
    meetingRows.push({
      id: meeting.id,
      title: meeting.title,
      aloneCorrect: alone.correctFound,
      aloneTotal: alone.correctTotal,
      aloneBad: alone.badReachingApproval,
      checkerCorrect: checked.correctFound,
      checkerTotal: checked.correctTotal,
      checkerBad: checked.badReachingApproval,
    });

    const scores = scoreTraps(
      meeting.traps.map(trapDefinition),
      toScored(meeting.drafts, meeting.checks),
      meeting.correct,
    );
    meeting.traps.forEach((trap, index) => {
      const score = scores[index];
      trapRows.push({
        id: trap.id,
        description: trap.description,
        kind: trap.kind,
        meetingTitle: meeting.title,
        expect: trap.expect,
        verdicts: score === undefined ? [] : score.verdicts,
        reachesApproval: score?.reachesApproval === true,
        outcome: outcomeOf(score),
        verdictMatches: score?.verdictMatches === true,
      });
    });
  }

  return {
    aloneCorrect,
    aloneBad,
    checkerCorrect,
    checkerBad,
    correctTotal,
    heldForALook,
    blocked,
    trapsAvoided: trapRows.filter((row) => row.outcome === "avoided").length,
    trapsCaught: trapRows.filter((row) => row.outcome === "caught").length,
    trapsThrough: trapRows.filter((row) => row.outcome === "through").length,
    verdictMisses: trapRows.filter((row) => row.outcome !== "avoided" && !row.verdictMatches).length,
    meetings: meetingRows,
    traps: trapRows,
  };
}

/** Targets that apply to a live or recorded run. */
export function recordedTargetsMet(report: EvalReport): boolean {
  return (
    report.checkerBad === EVAL_TARGETS.badPaymentsReachingApproval &&
    report.checkerCorrect === report.correctTotal &&
    report.trapsThrough === EVAL_TARGETS.trapsReachingApproval
  );
}

/** Targets that apply to the hand-written stand-in, including the gap the checker closes. */
export function standInTargetsMet(report: EvalReport): boolean {
  const everyTrapCaught =
    report.trapsAvoided === 0 &&
    report.trapsThrough === EVAL_TARGETS.trapsReachingApproval &&
    report.verdictMisses === 0 &&
    report.trapsCaught === report.traps.length;
  return (
    recordedTargetsMet(report) &&
    everyTrapCaught &&
    report.aloneBad >= EVAL_TARGETS.standInBadWithoutChecker
  );
}
