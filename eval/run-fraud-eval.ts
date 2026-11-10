/**
 * Fraud and mistake eval. Targets are in eval/fraud/TARGETS.md, written
 * before the first run.
 *
 * `npm run eval:fraud:live` calls the real drafter (needs OPENAI_API_KEY)
 * and saves drafts to fixtures/fraud/cache. `npm run eval:fraud` replays
 * that cache without calling OpenAI.
 */
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FRAUD_EVAL_TARGETS, runFraudEval, type FraudDraftRow } from "@second-seat/core";

function findRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(path.join(dir, "package.json")) && existsSync(path.join(dir, "fixtures", "fraud"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("Could not find the repository root.");
    dir = parent;
  }
}

const root = findRoot(path.dirname(fileURLToPath(import.meta.url)));
const cell = (value: string | number): string => String(value).replace(/\|/g, "/");
const money = (row: FraudDraftRow): string => `${row.amount} ${row.currency}`;

async function main(): Promise<void> {
  const mode = (process.env.DRAFTER_MODE ?? "recorded").trim().toLowerCase() === "live" ? "live" : "recorded";
  const run = await runFraudEval(root, mode, process.env);
  const r = run.result;
  const rep = r.report;
  const head =
    mode === "live"
      ? `Mode: live. Drafts came from a live OpenAI call (${run.model ?? "unknown model"}) through the app's real drafter, then the real checker. Saved to fixtures/fraud/cache.`
      : `Mode: recorded. Drafts replayed from fixtures/fraud/cache, which an earlier live call (${run.model ?? "unknown model"}) produced${run.recordedAt ? ` on ${run.recordedAt.slice(0, 10)}` : ""}. This run did not call OpenAI.`;
  const pct = rep.correctTotal === 0 ? 100 : Math.round((100 * rep.checkerCorrect) / rep.correctTotal);
  const draftLines = [
    "| Meeting | Category | Draft | Role | Checker | Reaches approval with checker |",
    "| --- | --- | --- | --- | --- | --- |",
    ...r.drafts.map(
      (row) =>
        `| ${cell(row.meetingTitle)} | ${row.category} | ${cell(row.payee)} ${money(row)} | ${row.role} | ${row.verdict} | ${row.reachesApproval ? "yes" : "no"} |`,
    ),
  ];
  const noDraft = r.report.meetings.filter((m) => !r.drafts.some((d) => d.meetingId === m.id)).map((m) => m.title);
  const missLines =
    r.misses.length === 0
      ? ["None. No bad payment reached approval with the checker."]
      : r.misses.map((row) => `- ${row.meetingTitle}: ${row.payee} ${money(row)} was ${row.verdict}. ${row.reason}`);
  const aloneLines =
    r.aloneMisses.length === 0
      ? ["None."]
      : r.aloneMisses.map((row) => `- ${row.meetingTitle}: ${row.payee} ${money(row)} (checker: ${row.verdict})`);
  const correctMissed = r.drafts.filter((row) => row.role === "correct" && !row.reachesApproval);
  const t1 = rep.checkerBad === FRAUD_EVAL_TARGETS.badPaymentsReachingApproval;
  const t3a = r.controlCorrectBlocked === 0 && r.controlCorrectHeld <= FRAUD_EVAL_TARGETS.controlCorrectHeldMax;
  const t3b = pct >= FRAUD_EVAL_TARGETS.correctReachingApprovalMinPercent;
  const lines = [
    "# Fraud and mistake eval: results",
    "",
    head,
    "",
    "Run history, including the first live run and the one checker fix made after it, is in eval/fraud/RUNS.md.",
    "",
    `${r.meetingCount} meetings: ${r.meetingCount - r.controlCount} with fraud or mistakes, ${r.controlCount} clean controls. Targets were committed before this run (eval/fraud/TARGETS.md).`,
    "",
    "## Totals",
    "",
    "| | AI alone | AI plus checker |",
    "| --- | ---: | ---: |",
    `| Bad payments that would reach approval | ${rep.aloneBad} | ${rep.checkerBad} |`,
    `| Correct payments that reach approval | ${rep.aloneCorrect}/${rep.correctTotal} | ${rep.checkerCorrect}/${rep.correctTotal} |`,
    `| Control payments that reach approval | ${r.controlCorrectTotal}/${r.controlCorrectTotal} offered | ${r.controlCorrectReached}/${r.controlCorrectTotal} |`,
    "",
    `Neutral drafts set aside (original payee, original amount): ${r.neutralDrafts}. Correct payments blocked: ${r.correctBlocked}. Correct payments held as Needs a look: ${r.correctHeld}.`,
    "",
    "## Bad payments the checker let through",
    "",
    ...missLines,
    "",
    "## Bad payments AI alone would have offered",
    "",
    ...aloneLines,
    "",
    "## Correct payments that did not reach approval (false blocks or holds)",
    "",
    ...(correctMissed.length === 0
      ? ["None."]
      : correctMissed.map((row) => `- ${row.meetingTitle}: ${row.payee} ${money(row)} was ${row.verdict}. ${row.reason}`)),
    ...(rep.correctTotal - rep.aloneCorrect > 0
      ? ["", `The drafter never produced ${rep.correctTotal - rep.aloneCorrect} correct payment(s), so they could not reach approval either way.`]
      : []),
    "",
    "## Every draft",
    "",
    ...draftLines,
    "",
    noDraft.length > 0 ? `Meetings where the drafter returned nothing: ${noDraft.join("; ")}.` : "",
    "",
    "## Against the targets",
    "",
    `- 1. Bad payments reaching approval with the checker: ${rep.checkerBad}. Target: 0. ${t1 ? "Met." : "Not met."}`,
    `- 2. AI alone bad payments: ${rep.aloneBad}. No target; the probe predicted at least 2.`,
    `- 3. Controls: ${r.controlCorrectReached}/${r.controlCorrectTotal} reach approval, ${r.controlCorrectBlocked} blocked, ${r.controlCorrectHeld} held. Target: none blocked, at most 1 held. ${t3a ? "Met." : "Not met."} All meetings: ${pct}% of correct payments reach approval. Target: at least 90%. ${t3b ? "Met." : "Not met."}`,
    "- 4. Every miss is listed above.",
    "",
    r.targetsMet ? "Targets for this run: met." : "Targets for this run: not met.",
    "",
  ];
  writeFileSync(path.join(root, "eval", "fraud", "RESULTS.md"), lines.join("\n"), "utf8");
  writeFileSync(
    path.join(root, "eval", "fraud", "results.json"),
    `${JSON.stringify({ mode, model: run.model, recordedAt: run.recordedAt, ...r }, null, 2)}\n`,
    "utf8",
  );
  console.log(`${mode}: AI alone bad ${rep.aloneBad}, AI+checker bad ${rep.checkerBad}, correct ${rep.checkerCorrect}/${rep.correctTotal}, controls ${r.controlCorrectReached}/${r.controlCorrectTotal}`);
}

await main();
