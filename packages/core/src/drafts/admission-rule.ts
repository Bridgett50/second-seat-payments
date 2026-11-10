/**
 * The rule between the checker and the approval gate.
 * Kept separate so tests can judge the rule without building a gate.
 */
import type { CheckResult } from "./types.js";

export interface AdmissionDecision {
  admit: boolean;
  explanation: string;
}

export function decideAdmission(
  check: CheckResult,
  ownerConfirmedLook = false,
): AdmissionDecision {
  if (check.verdict === "Proven") {
    return {
      admit: true,
      explanation: "Proven from the transcript, so it can go to the approval gate.",
    };
  }
  if (check.verdict === "Needs a look" && ownerConfirmedLook) {
    return {
      admit: true,
      explanation: "The owner confirmed this draft after the checker asked for a look.",
    };
  }
  if (check.verdict === "Needs a look") {
    return {
      admit: false,
      explanation: "Needs a look, and the owner has not confirmed it.",
    };
  }
  return {
    admit: false,
    explanation: "Blocked drafts never reach the approval gate.",
  };
}
