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
  decideAdmission,
  findDrafts,
  scorePayments,
  type CheckResult,
  type DrafterMode,
  type PaymentDraft,
} from "@second-seat/core";

interface Trap {
  id: string;
  kind: string;
  description: string;
  draftId: string;
  expect: "Proven" | "Needs a look" | "Blocked";
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
    return `Mode: recorded. These drafts were replayed from fixtures/cache. This run did not call OpenAI. The saved copies were produced by an earlier live call${model ? ` (${model})` : ""}.`;
  }
  return "Mode: stand-in. These drafts were written by hand, including deliberate mistakes that mimic a sloppy reader. They are not model output, and no OpenAI call was made.";
}

function admittedDrafts(row: MeetingRow): PaymentDraft[] {
  return row.drafts.filter((draft, index) => {
    const check = row.checks[index];
    return check !== undefined && decideAdmission(check, false).admit;
  });
}

function cell(value: string | number): string {
  return String(value).replace(/\|/g, "/");
}

async function main(): Promise<void> {
  const meetings = loadMeetings();
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

  let aloneCorrect = 0;
  let aloneBad = 0;
  let checkerCorrect = 0;
  let checkerBad = 0;
  let correctTotal = 0;
  let held = 0;
  let blocked = 0;
  let trapMisses = 0;

  const meetingLines = [
    "| Meeting | AI alone correct | AI alone bad | AI + checker correct | AI + checker bad |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  const trapLines = [
    "| Trap | Kind | Meeting | Expected | Checker | Reaches approval | Met |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const row of rows) {
    const alone = scorePayments(row.drafts, row.meeting.correct);
    const checked = scorePayments(admittedDrafts(row), row.meeting.correct);
    aloneCorrect += alone.correctFound;
    aloneBad += alone.badReachingApproval;
    checkerCorrect += checked.correctFound;
    checkerBad += checked.badReachingApproval;
    correctTotal += alone.correctTotal;
    held += row.checks.filter((check) => check.verdict === "Needs a look").length;
    blocked += row.checks.filter((check) => check.verdict === "Blocked").length;
    meetingLines.push(
      `| ${cell(row.meeting.title)} | ${alone.correctFound}/${alone.correctTotal} | ${alone.badReachingApproval} | ${checked.correctFound}/${checked.correctTotal} | ${checked.badReachingApproval} |`,
    );

    for (const trap of row.meeting.traps) {
      const check = row.checks.find((item) => item.draftId === trap.draftId);
      const verdict = check?.verdict ?? "missing";
      const reaches = check !== undefined && decideAdmission(check, false).admit;
      const met = verdict === trap.expect && !reaches;
      if (!met) trapMisses += 1;
      trapLines.push(
        `| ${cell(trap.description)} | ${cell(trap.kind)} | ${cell(row.meeting.title)} | ${trap.expect} | ${verdict} | ${reaches ? "yes" : "no"} | ${met ? "yes" : "no"} |`,
      );
    }
  }

  const correctMet = checkerCorrect === correctTotal;
  const badMet = checkerBad === 0;
  const aloneShowsGap = aloneBad > 0 || mode !== "stand-in";
  const targetsMet = correctMet && badMet && trapMisses === 0 && (mode !== "stand-in" || aloneBad > 0);

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
    ...trapLines,
    "",
    "## Against the targets",
    "",
    `- Bad payments reaching approval with the checker: ${checkerBad}. Target: 0. ${badMet ? "Met." : "Not met."}`,
    `- Firm answer-key payments reaching approval with the checker: ${checkerCorrect}/${correctTotal}. Target: all of them. ${correctMet ? "Met." : "Not met."}`,
    `- Planted traps caught (verdict matches the fixture, and the draft does not reach approval): ${rows.reduce((sum, row) => sum + row.meeting.traps.length, 0) - trapMisses} of ${rows.reduce((sum, row) => sum + row.meeting.traps.length, 0)}. ${trapMisses === 0 ? "Met." : "Not met."}`,
    mode === "stand-in"
      ? `- Stand-in drafts that would reach approval with no checker, and should not: ${aloneBad}. Target: more than 0, so the fixture set shows the checker catching mistakes. ${aloneShowsGap ? "Met." : "Not met."}`
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
  if (mode === "stand-in" && !targetsMet) {
    process.exitCode = 1;
  }
}

await main();
