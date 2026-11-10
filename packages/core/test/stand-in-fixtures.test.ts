import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkDrafts,
  decideAdmission,
  findDrafts,
  scorePayments,
  type PaymentDraft,
} from "../src/index.js";

interface Trap {
  id: string;
  kind: string;
  description: string;
  draftId: string;
  expect: "Proven" | "Needs a look" | "Blocked";
}

interface Meeting {
  id: string;
  title: string;
  owner: string;
  transcript: string;
  correct: Array<{ payee: string; amount: string; currency: string }>;
  traps: Trap[];
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const meetingDir = path.join(root, "fixtures", "meetings");

function loadMeetings(): Meeting[] {
  return readdirSync(meetingDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(path.join(meetingDir, name), "utf8")) as Meeting & { set?: string })
    // The bank-change sample is scored in the fraud eval, not in this fixture set.
    .filter((meeting) => meeting.set !== "fraud-sample");
}

describe("stand-in fixtures", () => {
  const meetings = loadMeetings();

  it("covers about 15 made-up meetings", () => {
    expect(meetings.length).toBeGreaterThanOrEqual(15);
  });

  it("keeps every firm payment and blocks every planted trap", async () => {
    let aloneBad = 0;
    let checkerBad = 0;
    let checkerCorrect = 0;
    let correctTotal = 0;

    for (const meeting of meetings) {
      const batch = await findDrafts(
        { fixtureId: meeting.id, transcript: meeting.transcript, owner: meeting.owner },
        {
          mode: "stand-in",
          env: {},
          standInPath: path.join(root, "fixtures", "stand-in.json"),
          cacheDir: path.join(root, "fixtures", "cache"),
          logPath: path.join(root, "eval", "logs", "unused-test.log"),
        },
      );
      expect(batch.mode).toBe("stand-in");
      expect(batch.model).toBeNull();

      const fabricated = new Set(
        meeting.traps.filter((trap) => trap.kind === "fabricated-quote").map((trap) => trap.draftId),
      );
      for (const draft of batch.drafts) {
        for (const quote of draft.quotes) {
          if (fabricated.has(draft.id)) {
            expect(meeting.transcript.includes(quote), draft.id).toBe(false);
          } else {
            expect(meeting.transcript.includes(quote), `${draft.id} quote`).toBe(true);
          }
        }
      }

      const checks = checkDrafts({
        transcript: meeting.transcript,
        owner: meeting.owner,
        drafts: batch.drafts,
      });
      const admitted = batch.drafts.filter((draft, index) => {
        const check = checks[index];
        return check !== undefined && decideAdmission(check, false).admit;
      });
      const alone = scorePayments(batch.drafts, meeting.correct);
      const checked = scorePayments(admitted, meeting.correct);
      aloneBad += alone.badReachingApproval;
      checkerBad += checked.badReachingApproval;
      checkerCorrect += checked.correctFound;
      correctTotal += checked.correctTotal;

      expect(checked.correctFound, meeting.id).toBe(meeting.correct.length);
      expect(checked.badReachingApproval, meeting.id).toBe(0);

      for (const trap of meeting.traps) {
        const check = checks.find((item) => item.draftId === trap.draftId);
        expect(check, trap.id).toBeDefined();
        expect(check?.verdict, `${meeting.id} ${trap.id}`).toBe(trap.expect);
        const draft = batch.drafts.find((item) => item.id === trap.draftId);
        expect(draft).toBeDefined();
        const wouldAdmit = check !== undefined && decideAdmission(check, false).admit;
        expect(wouldAdmit, trap.id).toBe(false);
      }
    }

    expect(correctTotal).toBeGreaterThan(0);
    expect(checkerCorrect).toBe(correctTotal);
    expect(checkerBad).toBe(0);
    expect(aloneBad).toBeGreaterThan(0);
  });

  it("does not let a blocked draft through just because its id was confirmed", () => {
    const draft: PaymentDraft = {
      id: "nope",
      payee: "Northwind Studio",
      amount: "2000.00",
      currency: "USD",
      purpose: "Rebrand",
      due: "Monday",
      quotes: ["The full rebrand is $2,000 and we can start Monday."],
    };
    const [check] = checkDrafts({
      transcript: loadMeetings().find((meeting) => meeting.id === "07-rebrand-rejected")?.transcript ?? "",
      owner: "Helena Cruz",
      drafts: [draft],
    });
    expect(check?.verdict).toBe("Blocked");
    expect(decideAdmission(check ?? { draftId: "nope", verdict: "Blocked", reasons: ["no"], steps: [] }, true).admit).toBe(
      false,
    );
  });
});
