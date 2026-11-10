import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkDrafts,
  decideAdmission,
  findDrafts,
  scorePayments,
  scoreTraps,
  type PaymentDraft,
  type ScoredDraft,
  type TrapDefinition,
} from "../src/index.js";

interface MeetingTrap extends TrapDefinition {
  kind: string;
  draftId: string;
}

interface Meeting {
  id: string;
  title: string;
  owner: string;
  transcript: string;
  set?: "stand-in" | "fraud-sample";
  correct: Array<{ payee: string; amount: string; currency: string }>;
  traps: MeetingTrap[];
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function loadMeetings(): Meeting[] {
  const dir = path.join(root, "fixtures", "meetings");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(path.join(dir, name), "utf8")) as Meeting & { set?: string })
    // The bank-change sample is scored in the fraud eval, not in this fixture set.
    .filter((meeting) => meeting.set !== "fraud-sample");
}

function asTrap(trap: MeetingTrap): TrapDefinition {
  return {
    id: trap.id,
    expect: trap.expect,
    payee: trap.payee,
    amount: trap.amount,
    currency: trap.currency,
    ...(trap.quote !== undefined && trap.quote.length > 0 ? { quote: trap.quote } : {}),
    ...(trap.extraCopy === true ? { extraCopy: true } : {}),
  };
}

function scored(drafts: readonly PaymentDraft[], checks: ReturnType<typeof checkDrafts>): ScoredDraft[] {
  return drafts.map((draft, index) => {
    const check = checks[index];
    return {
      id: draft.id,
      payee: draft.payee,
      amount: draft.amount,
      currency: draft.currency,
      quotes: draft.quotes,
      verdict: check?.verdict ?? "Blocked",
      reachesApproval: check !== undefined && decideAdmission(check, false).admit,
    };
  });
}

describe("trap scoring by payment content", () => {
  it("calls a trap avoided when no draft has that payee, amount, and currency", () => {
    const [score] = scoreTraps(
      [{ id: "rush", expect: "Blocked", payee: "Harbor Print", amount: "90.00", currency: "USD" }],
      [
        {
          id: "menus",
          payee: "Harbor Print",
          amount: "480.00",
          currency: "USD",
          quotes: ["I'll pay Harbor Print $480."],
          verdict: "Proven",
          reachesApproval: true,
        },
      ],
      [{ payee: "Harbor Print", amount: "480.00", currency: "USD" }],
    );
    expect(score?.outcome).toBe("avoided");
    expect(score?.reachesApproval).toBe(false);
  });

  it("calls a trap caught when the checker keeps the matching draft from approval", () => {
    const [score] = scoreTraps(
      [{ id: "logo", expect: "Needs a look", payee: "Nico Alvarez", amount: "90.00", currency: "USD" }],
      [
        {
          id: "live-1",
          payee: "Nico Alvarez",
          amount: "90.00",
          currency: "USD",
          quotes: ["I'll pay Nico Alvarez 90 for the logo edits by Thursday."],
          verdict: "Needs a look",
          reachesApproval: false,
        },
      ],
      [],
    );
    expect(score?.outcome).toBe("caught");
    expect(score?.verdictMatches).toBe(true);
    expect(score?.reachesApproval).toBe(false);
  });

  it("calls a trap through when the matching draft would be paid", () => {
    const [score] = scoreTraps(
      [{ id: "rush", expect: "Blocked", payee: "Harbor Print", amount: "90.00", currency: "USD" }],
      [
        {
          id: "bad",
          payee: "Harbor Print",
          amount: "90.00",
          currency: "USD",
          quotes: ["Want the rush printing for another $90?"],
          verdict: "Proven",
          reachesApproval: true,
        },
      ],
      [{ payee: "Harbor Print", amount: "480.00", currency: "USD" }],
    );
    expect(score?.outcome).toBe("through");
  });

  it("does not treat the one real copy of a payment as a duplicate trap", () => {
    const trap: TrapDefinition = {
      id: "recap",
      expect: "Blocked",
      payee: "Green Bin Compost",
      amount: "315.00",
      currency: "USD",
      extraCopy: true,
    };
    const correct = [{ payee: "Green Bin Compost", amount: "315.00", currency: "USD" }];
    const one = scoreTraps(
      [trap],
      [
        {
          id: "only",
          payee: "Green Bin Compost",
          amount: "315.00",
          currency: "USD",
          quotes: ["I'll pay Green Bin Compost $315 for the summer pickup."],
          verdict: "Proven",
          reachesApproval: true,
        },
      ],
      correct,
    );
    expect(one[0]?.outcome).toBe("avoided");

    const two = scoreTraps(
      [trap],
      [
        {
          id: "first",
          payee: "Green Bin Compost",
          amount: "315.00",
          currency: "USD",
          quotes: ["I'll pay Green Bin Compost $315 for the summer pickup."],
          verdict: "Proven",
          reachesApproval: true,
        },
        {
          id: "second",
          payee: "Green Bin Compost",
          amount: "315.00",
          currency: "USD",
          quotes: ["So, to recap, I'll pay Green Bin Compost $315 for the summer pickup."],
          verdict: "Blocked",
          reachesApproval: false,
        },
      ],
      correct,
    );
    expect(two[0]?.outcome).toBe("caught");
    expect(two[0]?.verdictMatches).toBe(true);
  });

  it("uses the quote to tell an unsure sentence from the later decision", () => {
    const trap: TrapDefinition = {
      id: "unsure",
      expect: "Blocked",
      payee: "Stage Left",
      amount: "900.00",
      currency: "USD",
      quote: "I'm not sure about the $900",
    };
    const correct = [{ payee: "Stage Left", amount: "900.00", currency: "USD" }];
    const decidedOnly = scoreTraps(
      [trap],
      [
        {
          id: "decided",
          payee: "Stage Left",
          amount: "900.00",
          currency: "USD",
          quotes: ["OK I've decided. I'll pay Stage Left $900 for the lighting on Friday."],
          verdict: "Proven",
          reachesApproval: true,
        },
      ],
      correct,
    );
    expect(decidedOnly[0]?.outcome).toBe("avoided");
  });

  it("does not match a different currency", () => {
    const [score] = scoreTraps(
      [{ id: "usd", expect: "Blocked", payee: "Alto Dairy", amount: "150.00", currency: "USD" }],
      [
        {
          id: "eur",
          payee: "Alto Dairy",
          amount: "150.00",
          currency: "EUR",
          quotes: ["Deal. I'll pay that on Tuesday."],
          verdict: "Proven",
          reachesApproval: true,
        },
      ],
      [{ payee: "Alto Dairy", amount: "150.00", currency: "EUR" }],
    );
    expect(score?.outcome).toBe("avoided");
  });
});

describe("recorded cache scored by content", () => {
  it("lets every firm payment through the checker and lets no trap through", async () => {
    const meetings = loadMeetings();
    let checkerCorrect = 0;
    let correctTotal = 0;
    let checkerBad = 0;
    const outcomes: string[] = [];

    for (const meeting of meetings) {
      if (meeting.set === "stand-in") continue;
      const batch = await findDrafts(
        { fixtureId: meeting.id, transcript: meeting.transcript, owner: meeting.owner },
        {
          mode: "recorded",
          env: {},
          cacheDir: path.join(root, "fixtures", "cache"),
          logPath: path.join(root, "eval", "logs", "unused-score-test.log"),
          standInPath: path.join(root, "fixtures", "stand-in.json"),
        },
      );
      expect(batch.mode).toBe("recorded");
      const checks = checkDrafts({
        transcript: meeting.transcript,
        owner: meeting.owner,
        drafts: batch.drafts,
      });
      const admitted = batch.drafts.filter((draft, index) => {
        const check = checks[index];
        return check !== undefined && decideAdmission(check, false).admit;
      });
      const checked = scorePayments(admitted, meeting.correct);
      checkerCorrect += checked.correctFound;
      correctTotal += checked.correctTotal;
      checkerBad += checked.badReachingApproval;
      const trapScores = scoreTraps(meeting.traps.map(asTrap), scored(batch.drafts, checks), meeting.correct);
      outcomes.push(...trapScores.map((score) => score.outcome));

      if (meeting.id === "04-dairy-currency") {
        const cheese = checks.find((check) => check.draftId === "04-dairy-currency-1");
        expect(cheese?.verdict).toBe("Proven");
      }
    }

    expect(correctTotal).toBe(16);
    expect(checkerCorrect).toBe(16);
    expect(checkerBad).toBe(0);
    expect(outcomes.filter((outcome) => outcome === "through")).toEqual([]);
    expect(outcomes.filter((outcome) => outcome === "caught")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "avoided")).toHaveLength(16);
  });
});

describe("stand-in traps scored by content", () => {
  it("finds every planted trap and keeps it from approval", async () => {
    const meetings = loadMeetings();
    for (const meeting of meetings) {
      const batch = await findDrafts(
        { fixtureId: meeting.id, transcript: meeting.transcript, owner: meeting.owner },
        {
          mode: "stand-in",
          env: {},
          cacheDir: path.join(root, "fixtures", "cache"),
          logPath: path.join(root, "eval", "logs", "unused-score-test.log"),
          standInPath: path.join(root, "fixtures", "stand-in.json"),
        },
      );
      const checks = checkDrafts({
        transcript: meeting.transcript,
        owner: meeting.owner,
        drafts: batch.drafts,
      });
      const trapScores = scoreTraps(meeting.traps.map(asTrap), scored(batch.drafts, checks), meeting.correct);
      for (const score of trapScores) {
        expect(score.outcome, score.id).toBe("caught");
        expect(score.verdictMatches, score.id).toBe(true);
        expect(score.reachesApproval, score.id).toBe(false);
      }
    }
  });
});
