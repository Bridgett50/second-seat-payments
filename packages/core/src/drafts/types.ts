/**
 * Payment drafts proposed from a meeting, and the checker's verdict.
 *
 * A draft is a suggestion: who to pay, how much, and the exact words it
 * came from. The checker decides whether those words actually prove it.
 * Only a proven draft, or one the owner has explicitly confirmed after a
 * look, may be handed to the approval gate.
 */

/** Who produced a batch of drafts. */
export type DrafterMode = "live" | "recorded" | "stand-in";

/**
 * One proposed payment. `amount` is a decimal string such as "480.00".
 * `quotes` are copied word for word from the transcript.
 */
export interface PaymentDraft {
  id: string;
  payee: string;
  amount: string;
  /** ISO 4217 code, such as "USD". */
  currency: string;
  /** What the payment is for, in plain words. */
  purpose: string;
  /** When it is due, or an empty string when the meeting never said. */
  due: string;
  quotes: string[];
}

/** The only three answers the checker is allowed to give. */
export type Verdict = "Proven" | "Needs a look" | "Blocked";

export interface CheckResult {
  draftId: string;
  verdict: Verdict;
  /** Plain-English reasons for the verdict. There is always at least one. */
  reasons: string[];
  /**
   * Extra transcript lines the checker used, when the draft's own quotes
   * are not the whole story. The payments page highlights these too.
   */
  evidenceQuotes?: string[];
}

/** A batch of drafts, labeled with the mode that produced it. */
export interface DraftBatch {
  mode: DrafterMode;
  /**
   * The model that wrote the drafts on a live call. Recorded mode keeps
   * that same model name so a replay is not mistaken for a new call.
   * The stand-in has no model, so this is null.
   */
  model: string | null;
  fixtureId: string;
  drafts: PaymentDraft[];
}

/** Hand-written drafts, keyed by fixture id. Used only in stand-in mode. */
export type StandInLibrary = Record<string, PaymentDraft[]>;
