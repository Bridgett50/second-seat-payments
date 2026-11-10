/**
 * Count correct and bad payments among the drafts that would be paid.
 *
 * A draft matches an answer-key payment when the payee, amount, and
 * currency are the same. Each answer-key payment can match one draft.
 * Any other draft that would still be paid is a bad payment.
 */
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
