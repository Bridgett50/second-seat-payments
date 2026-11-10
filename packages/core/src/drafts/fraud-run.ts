/**
 * Load fixtures/fraud/meetings, get drafts (live or recorded), run the
 * real checker, and score the set. Recorded mode never calls OpenAI.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { checkDrafts } from "./checker.js";
import type { EvalTrapInput } from "./evaluate.js";
import { findDrafts } from "./finder.js";
import { scoreFraudSet, type FraudEvalReport, type FraudMeetingInput } from "./fraud-eval.js";
import type { ScorePayment } from "./score.js";

export interface FraudMeetingFile {
  id: string;
  title: string;
  category: string;
  owner: string;
  transcript: string;
  note?: string;
  correct: ScorePayment[];
  neutral?: ScorePayment[];
  traps: EvalTrapInput[];
}

export interface FraudRunResult {
  mode: "live" | "recorded";
  model: string | null;
  recordedAt: string | null;
  result: FraudEvalReport;
}

export function loadFraudMeetings(root: string): FraudMeetingFile[] {
  const dir = path.join(root, "fixtures", "fraud", "meetings");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(path.join(dir, name), "utf8")) as FraudMeetingFile);
}

export async function runFraudEval(
  root: string,
  mode: "live" | "recorded",
  env: Record<string, string | undefined> = {},
): Promise<FraudRunResult> {
  const cacheDir = path.join(root, "fixtures", "fraud", "cache");
  const meetings = loadFraudMeetings(root);
  const scored: FraudMeetingInput[] = [];
  let model: string | null = null;
  let recordedAt: string | null = null;
  for (const meeting of meetings) {
    const batch = await findDrafts(
      { fixtureId: meeting.id, transcript: meeting.transcript, owner: meeting.owner },
      { cwd: root, mode, env: mode === "recorded" ? {} : env, cacheDir },
    );
    if (batch.mode !== mode) throw new Error(`Fraud eval expected ${mode} drafts for ${meeting.id}.`);
    if (batch.model !== null) model = batch.model;
    if (mode === "recorded") {
      const saved = JSON.parse(readFileSync(path.join(cacheDir, `${meeting.id}.json`), "utf8")) as { recordedAt?: string };
      if (typeof saved.recordedAt === "string" && (recordedAt === null || saved.recordedAt > recordedAt)) {
        recordedAt = saved.recordedAt;
      }
    }
    const checks = checkDrafts({ transcript: meeting.transcript, owner: meeting.owner, drafts: batch.drafts });
    scored.push({
      id: meeting.id,
      title: meeting.title,
      category: meeting.category,
      correct: meeting.correct,
      traps: meeting.traps,
      ...(meeting.neutral !== undefined ? { neutral: meeting.neutral } : {}),
      drafts: batch.drafts,
      checks,
    });
  }
  return { mode, model, recordedAt, result: scoreFraudSet(scored) };
}
