/**
 * Count correct and bad payments among the drafts that would be paid,
 * and match planted traps by the payment itself.
 *
 * A draft matches an answer-key payment when the payee, amount, and
 * currency are the same. Each answer-key payment can match one draft.
 * Any other draft that would still be paid is a bad payment.
 *
 * A trap matches the same way: payee, amount, and currency. Draft ids are
 * not used, so a live or recorded run is scored the same way as the
 * hand-written stand-in. When two traps share one amount, a quote
 * distinguishes them. A duplicate trap is an extra copy of a real payment.
 */
import type { Verdict } from "./types.js";
import { samePayment } from "./money.js";

export interface ScorePayment {
  payee: string;
  amount: string;
  currency: string;
}

export interface PaymentScore {
  correctFound: number;
  correctTotal: number;
  badReachingApproval: number;
}

export function scorePayments(
  drafts: readonly ScorePayment[],
  correct: readonly ScorePayment[],
): PaymentScore {
  const remaining = [...correct];
  let badReachingApproval = 0;
  for (const draft of drafts) {
    const index = remaining.findIndex((expected) => samePayment(draft, expected));
    if (index >= 0) remaining.splice(index, 1);
    else badReachingApproval += 1;
  }
  return {
    correctFound: correct.length - remaining.length,
    correctTotal: correct.length,
    badReachingApproval,
  };
}

/** How a trap turned out once drafts are matched by payee, amount, and currency. */
export type TrapOutcome = "avoided" | "caught" | "through";

export interface TrapDefinition {
  id: string;
  expect: Verdict;
  payee: string;
  amount: string;
  currency: string;
  /** When set, a draft matches only if one of its quotes contains this text. */
  quote?: string;
  /**
   * The trap is another copy of a payment that is also in the answer key.
   * The first copies, up to the number of correct payments, are the real
   * ones. Drafts after that are the trap.
   */
  extraCopy?: boolean;
}

export interface ScoredDraft extends ScorePayment {
  id: string;
  quotes: readonly string[];
  verdict: Verdict;
  reachesApproval: boolean;
}

export interface TrapScore {
  id: string;
  outcome: TrapOutcome;
  verdicts: Verdict[];
  reachesApproval: boolean;
  /** True when every matched draft has the verdict the trap asked for. */
  verdictMatches: boolean;
}

function quotesMatch(draft: ScoredDraft, quote: string): boolean {
  return draft.quotes.some((item) => item.includes(quote));
}

function toScore(trap: TrapDefinition, matched: readonly ScoredDraft[]): TrapScore {
  if (matched.length === 0) {
    return {
      id: trap.id,
      outcome: "avoided",
      verdicts: [],
      reachesApproval: false,
      verdictMatches: false,
    };
  }
  const reachesApproval = matched.some((draft) => draft.reachesApproval);
  return {
    id: trap.id,
    outcome: reachesApproval ? "through" : "caught",
    verdicts: matched.map((draft) => draft.verdict),
    reachesApproval,
    verdictMatches: matched.every((draft) => draft.verdict === trap.expect),
  };
}

/**
 * Score every trap from the drafts that were actually returned.
 * A trap the drafter never produced is "avoided". A trap it produced that
 * does not reach approval is "caught". A trap that reaches approval is
 * "through".
 */
export function scoreTraps(
  traps: readonly TrapDefinition[],
  drafts: readonly ScoredDraft[],
  correct: readonly ScorePayment[],
): TrapScore[] {
  const used = new Set<string>();
  const preliminary = traps.map((trap) => {
    const triple = drafts.filter((draft) => samePayment(draft, trap));
    let matched: ScoredDraft[];
    if (trap.extraCopy === true) {
      const correctCount = correct.filter((item) => samePayment(item, trap)).length;
      matched = triple.slice(correctCount);
    } else if (trap.quote !== undefined && trap.quote.length > 0) {
      matched = triple.filter((draft) => quotesMatch(draft, trap.quote ?? ""));
    } else {
      const alsoCorrect = correct.some((item) => samePayment(item, trap));
      matched = alsoCorrect ? [] : triple;
    }
    for (const draft of matched) used.add(draft.id);
    return { trap, matched };
  });

  return preliminary.map(({ trap, matched }) => {
    let found = matched;
    if (trap.extraCopy !== true && found.length === 0) {
      const alsoCorrect = correct.some((item) => samePayment(item, trap));
      if (!alsoCorrect) {
        found = drafts.filter((draft) => samePayment(draft, trap) && !used.has(draft.id));
        for (const draft of found) used.add(draft.id);
      }
    }
    return toScore(trap, found);
  });
}
