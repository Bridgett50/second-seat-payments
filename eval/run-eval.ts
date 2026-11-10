/**
 * Compare the drafter alone with the drafter plus the checker.
 *
 * `npm run eval` forces stand-in mode, so it runs with no API key.
 * `npm run eval:live` forces live mode and needs OPENAI_API_KEY.
 * Recorded mode replays fixtures/cache after a live run.
 * The results file names the mode. Stand-in drafts are not model output.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkDrafts,
  EVAL_TARGETS,
  evaluateMeetings,
  findDrafts,
  recordedTargetsMet,
  standInTargetsMet,
  type CheckResult,
  type DrafterMode,
  type EvalTrapInput,
  type PaymentDraft,
  type TrapOutcome,
} from "@second-seat/core";

interface Trap extends EvalTrapInput {
  draftId: string;
}

interface CorrectPayment {
  payee: string;
  amount: string;
  currency: string;
  purpose: string;
  due: string;
}

interface Meeting {
  id: string;
  title: string;
  owner: string;
  transcript: string;
  correct: CorrectPayment[];
  traps: Trap[];
  /** Hand-written meetings are not part of the recorded live replay. */
  set?: "stand-in" | "fraud-sample";
}

interface MeetingRow {
  meeting: Meeting;
  mode: DrafterMode;
  model: string | null;
  drafts: PaymentDraft[];
  checks: CheckResult[];
}

function findRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (
      existsSync(path.join(dir, "package.json")) &&
      existsSync(path.join(dir, "fixtures", "meetings"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error("Could not find the repository root from the eval script.");
    }
    dir = parent;
  }
}

const root = findRoot(path.dirname(fileURLToPath(import.meta.url)));

function loadMeetings(): Meeting[] {
  const dir = path.join(root, "fixtures", "meetings");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(path.join(dir, name), "utf8")) as Meeting);
}

function modeLabel(mode: DrafterMode): string {
  if (mode === "live") return "live";
  if (mode === "recorded") return "recorded";
  return "stand-in";
}

function modeParagraph(mode: DrafterMode, model: string | null): string {
  if (mode === "live") {
    return `Mode: live. These drafts came from a live OpenAI call${model ? ` (${model})` : ""}. The call log is local and is not committed. Saved copies are in fixtures/cache for a later recorded run.`;
  }
  if (mode === "recorded") {
    return `Mode: recorded (from live gpt-4o-mini run Nov 9). These drafts were replayed from fixtures/cache. This run did not call OpenAI. The saved copies were produced by an earlier live call${model ? ` (${model})` : ""}.`;
  }
  return "Mode: stand-in. These drafts were written by hand, including deliberate mistakes that mimic a sloppy reader. They are not model output, and no OpenAI call was made.";
}

function cell(value: string | number): string {
  return String(value).replace(/\|/g, "/");
}

function outcomeLabel(outcome: TrapOutcome): string {
  if (outcome === "avoided") return "avoided";
  if (outcome === "through") return "got through";
  return "checker caught";
}

function verdictCell(verdicts: readonly string[]): string {
  return verdicts.length === 0 ? "none" : verdicts.join(", ");
}

async function main(): Promise<void> {
  const requested = (process.env.DRAFTER_MODE ?? "auto").trim().toLowerCase();
  const meetings = loadMeetings().filter((meeting) => {
    // The bank-change sample is scored in the fraud eval (eval/fraud), not here.
    if (meeting.set === "fraud-sample") return false;
    if (meeting.set === "stand-in" && (requested === "recorded" || requested === "live")) return false;
    return true;
  });
  const rows: MeetingRow[] = [];
  for (const meeting of meetings) {
    const batch = await findDrafts(
      { fixtureId: meeting.id, transcript: meeting.transcript, owner: meeting.owner },
      { cwd: root },
    );
    const checks = checkDrafts({
      transcript: meeting.transcript,
      owner: meeting.owner,
      drafts: batch.drafts,
    });
    rows.push({ meeting, mode: batch.mode, model: batch.model, drafts: batch.drafts, checks });
  }

  const modes = new Set(rows.map((row) => row.mode));
  const mode = modes.size === 1 ? [...modes][0] ?? "stand-in" : "stand-in";
  const model = rows.find((row) => row.model !== null)?.model ?? null;
  const report = evaluateMeetings(
    rows.map((row) => ({
      id: row.meeting.id,
      title: row.meeting.title,
      correct: row.meeting.correct,
      traps: row.meeting.traps,
      drafts: row.drafts,
      checks: row.checks,
    })),
  );
  const {
    aloneCorrect,
    aloneBad,
    checkerCorrect,
    checkerBad,
    correctTotal,
    heldForALook: held,
    blocked,
    trapsAvoided: avoided,
    trapsCaught: caught,
    trapsThrough: through,
  } = report;
  const targetsMet = mode === "stand-in" ? standInTargetsMet(report) : recordedTargetsMet(report);

  const meetingLines = [
    "| Meeting | AI alone correct | AI alone bad | AI + checker correct | AI + checker bad |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  for (const row of report.meetings) {
    meetingLines.push(
      `| ${cell(row.title)} | ${row.aloneCorrect}/${row.aloneTotal} | ${row.aloneBad} | ${row.checkerCorrect}/${row.checkerTotal} | ${row.checkerBad} |`,
    );
  }
  const trapLines = [
    "| Trap | Kind | Meeting | Expected | Checker | Reaches approval | Outcome |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const trap of report.traps) {
    trapLines.push(
      `| ${cell(trap.description)} | ${cell(trap.kind)} | ${cell(trap.meetingTitle)} | ${trap.expect} | ${verdictCell(trap.verdicts)} | ${trap.reachesApproval ? "yes" : "no"} | ${outcomeLabel(trap.outcome)} |`,
    );
  }

  const lines = [
    "# Eval results",
    "",
    modeParagraph(mode, model),
    "",
    "AI alone means every draft the drafter returned would be offered for approval. AI plus checker means only a Proven draft is offered. Needs a look stays back unless the owner confirms that draft, and this run does not confirm any. Blocked drafts are never offered.",
    "",
    "## Totals",
    "",
    "| | AI alone | AI plus checker |",
    "| --- | ---: | ---: |",
    `| Correct payments that reach approval | ${aloneCorrect}/${correctTotal} | ${checkerCorrect}/${correctTotal} |`,
    `| Bad payments that would reach approval | ${aloneBad} | ${checkerBad} |`,
    "",
    `Drafts held for a look: ${held}. Drafts blocked: ${blocked}.`,
    "",
    "## Per meeting",
    "",
    ...meetingLines,
    "",
    "## Per trap",
    "",
    mode === "stand-in"
      ? "These traps were written into the stand-in drafts on purpose. They are not AI output. A trap is matched by payee, amount, and currency."
      : "Traps are matched by payee, amount, and currency, not by stand-in draft ids. Avoided means the drafter never produced that payment. Checker caught means it did, and the checker kept it from approval. Got through means it would reach approval.",
    "",
    "| | Count |",
    "| --- | ---: |",
    mode === "stand-in"
      ? `| Planted traps the checker kept from approval | ${caught} |`
      : `| Traps the AI avoided on its own | ${avoided} |`,
    mode === "stand-in"
      ? `| Planted traps that reached approval | ${through} |`
      : `| Traps the AI fell for that the checker caught | ${caught} |`,
    mode === "stand-in"
      ? `| Planted traps the scorer could not find | ${avoided} |`
      : `| Traps that got through | ${through} |`,
    "",
    ...trapLines,
    "",
    "## Against the targets",
    "",
    `- Bad payments reaching approval with the checker: ${checkerBad}. Target: ${EVAL_TARGETS.badPaymentsReachingApproval}. ${checkerBad === EVAL_TARGETS.badPaymentsReachingApproval ? "Met." : "Not met."}`,
    `- Firm answer-key payments reaching approval with the checker: ${checkerCorrect}/${correctTotal}. Target: all of them. ${checkerCorrect === correctTotal ? "Met." : "Not met."}`,
    mode === "stand-in"
      ? `- Planted traps kept from approval with the expected verdict: ${caught - report.verdictMisses} of ${report.traps.length}. ${standInTargetsMet(report) ? "Met." : "Not met."}`
      : `- Traps that got through: ${through}. Target: ${EVAL_TARGETS.trapsReachingApproval}. ${through === EVAL_TARGETS.trapsReachingApproval ? "Met." : "Not met."}`,
    mode === "stand-in"
      ? `- Stand-in drafts that would reach approval with no checker, and should not: ${aloneBad}. Target: more than ${EVAL_TARGETS.standInBadWithoutChecker - 1}, so the fixture set shows the checker catching mistakes. ${aloneBad >= EVAL_TARGETS.standInBadWithoutChecker ? "Met." : "Not met."}`
      : "- The stand-in gap target applies to stand-in mode only. This file is a live or recorded run.",
    "",
    targetsMet ? "Targets for this run: met." : "Targets for this run: not met.",
    "",
  ];

  const outPath = path.join(root, "eval", "RESULTS.md");
  writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`${modeLabel(mode)} results written to eval/RESULTS.md`);
  console.log(`AI alone: ${aloneCorrect}/${correctTotal} correct, ${aloneBad} bad`);
  console.log(`AI plus checker: ${checkerCorrect}/${correctTotal} correct, ${checkerBad} bad`);
  if (checkerBad > EVAL_TARGETS.badPaymentsReachingApproval || !targetsMet) {
    process.exitCode = 1;
  }
}

await main();
