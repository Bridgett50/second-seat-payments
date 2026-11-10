/**
 * Replay the saved live drafts and score them.
 * This path forces recorded mode, so a key in the environment is not used.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  checkDrafts,
  evaluateMeetings,
  findDrafts,
  type EvalReport,
  type EvalTrapInput,
} from "@second-seat/core";

interface MeetingFile {
  id: string;
  title: string;
  owner: string;
  transcript: string;
  set?: "stand-in" | "fraud-sample";
  correct: Array<{ payee: string; amount: string; currency: string }>;
  traps: Array<EvalTrapInput & { draftId?: string }>;
}

export interface RecordedEvalResult {
  mode: "recorded";
  model: string | null;
  meetingCount: number;
  report: EvalReport;
}

function loadMeetings(root: string): MeetingFile[] {
  const dir = path.join(root, "fixtures", "meetings");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(path.join(dir, name), "utf8")) as MeetingFile)
    .filter((meeting) => meeting.set !== "stand-in" && meeting.set !== "fraud-sample");
}

function trapInput(trap: MeetingFile["traps"][number]): EvalTrapInput {
  return {
    id: trap.id,
    expect: trap.expect,
    payee: trap.payee,
    amount: trap.amount,
    currency: trap.currency,
    kind: trap.kind,
    description: trap.description,
    ...(trap.quote !== undefined && trap.quote.length > 0 ? { quote: trap.quote } : {}),
    ...(trap.extraCopy === true ? { extraCopy: true } : {}),
  };
}

export async function runRecordedEval(root: string): Promise<RecordedEvalResult> {
  const meetings = loadMeetings(root);
  let model: string | null = null;
  const scored = [];
  for (const meeting of meetings) {
    const batch = await findDrafts(
      { fixtureId: meeting.id, transcript: meeting.transcript, owner: meeting.owner },
      { cwd: root, mode: "recorded", env: {} },
    );
    if (batch.mode !== "recorded") {
      throw new Error(`Recorded eval expected saved drafts for ${meeting.id}.`);
    }
    if (batch.model !== null) model = batch.model;
    const checks = checkDrafts({
      transcript: meeting.transcript,
      owner: meeting.owner,
      drafts: batch.drafts,
    });
    scored.push({
      id: meeting.id,
      title: meeting.title,
      correct: meeting.correct,
      traps: meeting.traps.map(trapInput),
      drafts: batch.drafts,
      checks,
    });
  }
  return {
    mode: "recorded",
    model,
    meetingCount: meetings.length,
    report: evaluateMeetings(scored),
  };
}
