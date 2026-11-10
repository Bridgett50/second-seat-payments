/**
 * Write BUILT_DURING_HACKATHON.md from the git log.
 * Run from the repository root: node scripts/write-timeline.mjs
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const log = execSync('git log --reverse --format=%H%x09%ad%x09%s --date=format:%Y-%m-%d', {
  encoding: "utf8",
}).trim();

const notes = {
  "64eeeb7": "The repository started, with the MIT license.",
  c6212cc: "The approval gate and the PayPal sandbox client came over from earlier work. See PRIOR_WORK.md.",
  daf4efd: "The checker started proving drafts before they can reach the approval gate, with the stand-in and the 15-meeting eval.",
  a3dff80: "The payments page went up: pick a meeting, find drafts, read Proven, Needs a look, or Blocked, and approve through the gate.",
  "77b7ad0":
    "The checker now rejects a draft with no verbatim quote, holds a meeting that talks to the system, and lists each rule as pass or fail. The proof page reruns the recorded eval. Approve, reject, and capture go on a hash-chained ledger.",
};

const byDay = new Map();
for (const line of log.split("\n")) {
  if (line.trim().length === 0) continue;
  const [hash, day, subject] = line.split("\t");
  const short = hash.slice(0, 7);
  if (!byDay.has(day)) byDay.set(day, []);
  byDay.get(day).push({ hash: short, subject: notes[short] ?? subject });
}

const lines = [
  "# Built from November 9, 2026",
  "",
  "This timeline is generated from the git log, starting November 9, 2026.",
  "Files copied from earlier work are listed in [PRIOR_WORK.md](PRIOR_WORK.md). They are not new work from these days.",
  "",
];

for (const [day, commits] of byDay) {
  lines.push(`## ${day}`);
  lines.push("");
  for (const commit of commits) {
    lines.push(`- ${commit.subject} (\`${commit.hash}\`)`);
  }
  lines.push("");
}

lines.push("The commit that adds this file records the timeline. It is one commit newer than the last line above.");
lines.push("");

writeFileSync("BUILT_DURING_HACKATHON.md", lines.join("\n"), "utf8");
console.log("Wrote BUILT_DURING_HACKATHON.md");
