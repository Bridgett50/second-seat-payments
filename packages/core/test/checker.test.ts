import { describe, expect, it } from "vitest";
import {
  admitDraftToGate,
  checkDraft,
  checkDrafts,
  createDemoPayPalPort,
  createPaymentGate,
  type PaymentDraft,
} from "../src/index.js";

function draft(overrides: Partial<PaymentDraft> & Pick<PaymentDraft, "id" | "payee" | "amount" | "quotes">): PaymentDraft {
  return {
    currency: "USD",
    purpose: "the work they agreed on",
    due: "Friday",
    ...overrides,
  };
}

function reasons(transcript: string, owner: string, item: PaymentDraft): string {
  return checkDraft({ transcript, owner, draft: item }).reasons.join(" ");
}

describe("checker trap: proven payment", () => {
  const transcript = [
    "Maya Chen (owner): I'll pay Harbor Print $480 on Friday for the spring menus.",
  ].join("\n");

  it("proves a payment the owner stated in dollars", () => {
    const item = draft({
      id: "menus",
      payee: "Harbor Print",
      amount: "480.00",
      quotes: ["I'll pay Harbor Print $480 on Friday for the spring menus."],
    });
    const result = checkDraft({ transcript, owner: "Maya Chen", draft: item });
    expect(result.verdict).toBe("Proven");
    expect(result.reasons[0]).toMatch(/Maya Chen/);
    expect(result.reasons[0]).toMatch(/480\.00 USD/);
  });
});

describe("checker trap: quote is not verbatim", () => {
  it("blocks a quote that was paraphrased", () => {
    const transcript = "Rosa Delgado (owner): I'll pay Ridge Roofing $1,200 for the shop roof repair.";
    const item = draft({
      id: "made-up",
      payee: "Ridge Roofing",
      amount: "1500.00",
      quotes: ["I'll pay Ridge Roofing $1,500 for the shop roof repair."],
    });
    const result = checkDraft({ transcript, owner: "Rosa Delgado", draft: item });
    expect(result.verdict).toBe("Blocked");
    expect(reasons(transcript, "Rosa Delgado", item)).toMatch(/word for word/);
  });
});

describe("checker trap: amount not in the transcript", () => {
  it("blocks a real quote paired with an amount nobody said", () => {
    const transcript = "Rosa Delgado (owner): I'll pay Ridge Roofing $1,200 for the shop roof repair.";
    const quote = "I'll pay Ridge Roofing $1,200 for the shop roof repair.";
    const item = draft({
      id: "wrong-amount",
      payee: "Ridge Roofing",
      amount: "1500.00",
      quotes: [quote],
    });
    const result = checkDraft({ transcript, owner: "Rosa Delgado", draft: item });
    expect(result.verdict).toBe("Blocked");
    expect(result.reasons.join(" ")).toMatch(/never mentions 1500\.00/);
  });
});

describe("checker trap: the other party proposed it and the owner said no", () => {
  const transcript = [
    "Jordan Lee (Northwind Studio): The full rebrand is $2,000 and we can start Monday.",
    "Helena Cruz (owner): I can't approve two thousand. Let's stop there.",
  ].join("\n");

  it("blocks the rejected proposal", () => {
    const item = draft({
      id: "rebrand",
      payee: "Northwind Studio",
      amount: "2000.00",
      quotes: ["The full rebrand is $2,000 and we can start Monday."],
    });
    const result = checkDraft({ transcript, owner: "Helena Cruz", draft: item });
    expect(result.verdict).toBe("Blocked");
    expect(result.reasons.join(" ")).toMatch(/turned this down/);
  });
});

describe("checker trap: the owner agrees to the other party's price", () => {
  const transcript = [
    "Ben Cho (Alto Dairy): The cheese delivery comes to €150.",
    "Lila Nguyen (owner): Deal. I'll pay that on Tuesday.",
  ].join("\n");

  it("proves the price the owner accepted", () => {
    const item = draft({
      id: "cheese",
      payee: "Alto Dairy",
      amount: "150.00",
      currency: "EUR",
      quotes: ["The cheese delivery comes to €150."],
    });
    const result = checkDraft({ transcript, owner: "Lila Nguyen", draft: item });
    expect(result.verdict).toBe("Proven");
    expect(result.reasons.join(" ")).toMatch(/agreed to pay it/);
  });
});

describe("checker trap: renegotiated amount", () => {
  const transcript = [
    "Elena Vasquez (owner): I'll pay Moss Plumbing $650 for the sink install.",
    "Elena Vasquez (owner): Yes, skip the disposal. I'll pay Moss Plumbing $500.",
  ].join("\n");

  it("blocks the old amount and proves the new one", () => {
    const oldAmount = draft({
      id: "old",
      payee: "Moss Plumbing",
      amount: "650.00",
      quotes: ["I'll pay Moss Plumbing $650 for the sink install."],
    });
    const newAmount = draft({
      id: "new",
      payee: "Moss Plumbing",
      amount: "500.00",
      quotes: ["I'll pay Moss Plumbing $500."],
    });
    const [oldResult, newResult] = checkDrafts({
      transcript,
      owner: "Elena Vasquez",
      drafts: [oldAmount, newAmount],
    });
    expect(oldResult?.verdict).toBe("Blocked");
    expect(oldResult?.reasons.join(" ")).toMatch(/later changed this to 500\.00 USD/);
    expect(newResult?.verdict).toBe("Proven");
  });
});

describe("checker trap: wrong payee", () => {
  it("blocks a payee the quote never names", () => {
    const transcript =
      "Owen Blake (owner): I'll pay Lena's Flowers $220 for the Saturday centerpieces.";
    const item = draft({
      id: "landlord",
      payee: "Oak Street Properties",
      amount: "220.00",
      quotes: ["I'll pay Lena's Flowers $220 for the Saturday centerpieces."],
    });
    const result = checkDraft({ transcript, owner: "Owen Blake", draft: item });
    expect(result.verdict).toBe("Blocked");
    expect(result.reasons.join(" ")).toMatch(/does not name Oak Street Properties/);
  });
});

describe("checker trap: hypothetical maybe next month", () => {
  it("blocks a payment the owner only floated", () => {
    const transcript =
      "Ava Brooks (owner): Maybe next month we could pay Bright Frame $300 if wedding season picks up.";
    const item = draft({
      id: "maybe",
      payee: "Bright Frame",
      amount: "300.00",
      quotes: ["Maybe next month we could pay Bright Frame $300 if wedding season picks up."],
    });
    const result = checkDraft({ transcript, owner: "Ava Brooks", draft: item });
    expect(result.verdict).toBe("Blocked");
    expect(result.reasons.join(" ")).toMatch(/only a maybe/);
  });
});

describe("checker trap: duplicate mention", () => {
  const transcript = [
    "Nina Patel (owner): I'll pay Green Bin Compost $315 for the summer pickup.",
    "Nina Patel (owner): So, to recap, I'll pay Green Bin Compost $315 for the summer pickup.",
  ].join("\n");

  it("proves the payment once and blocks the second copy", () => {
    const first = draft({
      id: "first",
      payee: "Green Bin Compost",
      amount: "315.00",
      quotes: ["I'll pay Green Bin Compost $315 for the summer pickup."],
    });
    const second = draft({
      id: "second",
      payee: "Green Bin Compost",
      amount: "315.00",
      quotes: ["So, to recap, I'll pay Green Bin Compost $315 for the summer pickup."],
    });
    const [kept, copy] = checkDrafts({
      transcript,
      owner: "Nina Patel",
      drafts: [first, second],
    });
    expect(kept?.verdict).toBe("Proven");
    expect(copy?.verdict).toBe("Blocked");
    expect(copy?.reasons.join(" ")).toMatch(/pay twice/);
  });
});

describe("checker trap: currency mixup", () => {
  it("blocks dollars when the quote is in euros", () => {
    const transcript = "Lila Nguyen (owner): I'll pay Alto Dairy €150 for the cheese delivery.";
    const item = draft({
      id: "mixup",
      payee: "Alto Dairy",
      amount: "150.00",
      currency: "USD",
      quotes: ["I'll pay Alto Dairy €150 for the cheese delivery."],
    });
    const result = checkDraft({ transcript, owner: "Lila Nguyen", draft: item });
    expect(result.verdict).toBe("Blocked");
    expect(result.reasons.join(" ")).toMatch(/in EUR, not USD/);
  });
});

describe("checker trap: cancelled later", () => {
  const transcript = [
    "Jonah Blake (owner): I'll pay Peak Hall $800 as the deposit for the June recital.",
    "Jonah Blake (owner): I'll pay Metro Print $60 for the programs.",
    "Jonah Blake (owner): Actually, cancel the Peak Hall deposit. The recital moved to the school gym.",
  ].join("\n");

  it("blocks the cancelled deposit and keeps the other payment", () => {
    const deposit = draft({
      id: "hall",
      payee: "Peak Hall",
      amount: "800.00",
      quotes: ["I'll pay Peak Hall $800 as the deposit for the June recital."],
    });
    const programs = draft({
      id: "programs",
      payee: "Metro Print",
      amount: "60.00",
      quotes: ["I'll pay Metro Print $60 for the programs."],
    });
    const [hall, print] = checkDrafts({
      transcript,
      owner: "Jonah Blake",
      drafts: [deposit, programs],
    });
    expect(hall?.verdict).toBe("Blocked");
    expect(hall?.reasons.join(" ")).toMatch(/cancelled/);
    expect(print?.verdict).toBe("Proven");
  });
});

describe("checker trap: a count or a date is not a price", () => {
  it("blocks 15 boxes being read as $15", () => {
    const transcript = "Rosa Delgado (owner): We need 15 boxes from Boxdrop for the move.";
    const item = draft({
      id: "boxes",
      payee: "Boxdrop",
      amount: "15.00",
      quotes: ["We need 15 boxes from Boxdrop for the move."],
    });
    const result = checkDraft({ transcript, owner: "Rosa Delgado", draft: item });
    expect(result.verdict).toBe("Blocked");
    expect(result.reasons.join(" ")).toMatch(/not as a price/);
  });

  it("blocks the 12th being read as $12", () => {
    const transcript = "Rosa Delgado (owner): They can start on the 12th.";
    const item = draft({
      id: "date",
      payee: "Ridge Roofing",
      amount: "12.00",
      quotes: ["They can start on the 12th."],
    });
    const result = checkDraft({ transcript, owner: "Rosa Delgado", draft: item });
    expect(result.verdict).toBe("Blocked");
    expect(result.reasons.join(" ")).toMatch(/not as a price/);
  });
});

describe("checker: currency never stated", () => {
  it("asks for a look instead of guessing dollars", () => {
    const transcript =
      "Helen Cho (owner): I'll pay Nico Alvarez 90 for the logo edits by Thursday.";
    const item = draft({
      id: "logo",
      payee: "Nico Alvarez",
      amount: "90.00",
      quotes: ["I'll pay Nico Alvarez 90 for the logo edits by Thursday."],
    });
    const result = checkDraft({ transcript, owner: "Helen Cho", draft: item });
    expect(result.verdict).toBe("Needs a look");
    expect(result.reasons.join(" ")).toMatch(/never names a currency/);
  });
});

describe("checker: weak acknowledgement", () => {
  it("asks for a look when the owner only says okay", () => {
    const transcript = [
      "Sam Ruiz (Poster Shop): The posters are $40.",
      "Helen Cho (owner): Okay.",
    ].join("\n");
    const item = draft({
      id: "posters",
      payee: "Poster Shop",
      amount: "40.00",
      quotes: ["The posters are $40."],
    });
    const result = checkDraft({ transcript, owner: "Helen Cho", draft: item });
    expect(result.verdict).toBe("Needs a look");
    expect(result.reasons.join(" ")).toMatch(/not a clear yes/);
  });
});

describe("checker trap: unsure quote, firm quote later", () => {
  const transcript = [
    "Chris Paul (owner): I'm not sure about the $900 lighting package from Stage Left.",
    "Chris Paul (owner): OK I've decided. I'll pay Stage Left $900 for the lighting on Friday.",
  ].join("\n");

  it("blocks the unsure sentence and proves the decision", () => {
    const unsure = draft({
      id: "unsure",
      payee: "Stage Left",
      amount: "900.00",
      quotes: ["I'm not sure about the $900 lighting package from Stage Left."],
    });
    const firm = draft({
      id: "firm",
      payee: "Stage Left",
      amount: "900.00",
      quotes: ["I'll pay Stage Left $900 for the lighting on Friday."],
    });
    const [first, second] = checkDrafts({
      transcript,
      owner: "Chris Paul",
      drafts: [unsure, firm],
    });
    expect(first?.verdict).toBe("Blocked");
    expect(first?.reasons.join(" ")).toMatch(/only a maybe/);
    expect(second?.verdict).toBe("Proven");
  });
});

describe("checker: spoken amounts and you", () => {
  it("proves an amount spoken in words", () => {
    const transcript =
      "Maya Chen (owner): I'll pay Harbor Print four hundred eighty dollars for the menus.";
    const item = draft({
      id: "words",
      payee: "Harbor Print",
      amount: "480.00",
      quotes: ["I'll pay Harbor Print four hundred eighty dollars for the menus."],
    });
    expect(checkDraft({ transcript, owner: "Maya Chen", draft: item }).verdict).toBe("Proven");
  });

  it("treats you as the other person in the conversation", () => {
    const transcript = [
      "Priya Shah (Folding Co.): The chair rental for Saturday is ready.",
      "Helen Cho (owner): I'll pay you $275 tomorrow for the chair rental.",
    ].join("\n");
    const item = draft({
      id: "chairs",
      payee: "Folding Co.",
      amount: "275.00",
      due: "tomorrow",
      quotes: ["I'll pay you $275 tomorrow for the chair rental."],
    });
    const result = checkDraft({ transcript, owner: "Helen Cho", draft: item });
    expect(result.verdict).toBe("Proven");
    expect(result.reasons.join(" ")).toMatch(/you/);
  });

  it("does not treat a bystander as the person being paid", () => {
    const transcript = [
      "Helen Cho (owner): The Grand Hotel called about parking, but that is separate.",
      "Priya Shah (Folding Co.): The chair rental for Saturday is ready.",
      "Helen Cho (owner): I'll pay you $275 tomorrow for the chair rental.",
    ].join("\n");
    const item = draft({
      id: "hotel",
      payee: "The Grand Hotel",
      amount: "275.00",
      quotes: ["I'll pay you $275 tomorrow for the chair rental."],
    });
    const result = checkDraft({ transcript, owner: "Helen Cho", draft: item });
    expect(result.verdict).toBe("Blocked");
    expect(result.reasons.join(" ")).toMatch(/does not name The Grand Hotel/);
  });
});

describe("checker: two real payments", () => {
  it("proves both when they are different payees", () => {
    const transcript = [
      "Bea Ortiz (owner): I'll pay Mill & Rye $540 for the flour delivery.",
      "Bea Ortiz (owner): I'll pay Sweet Stamp $88 for the labels.",
    ].join("\n");
    const flour = draft({
      id: "flour",
      payee: "Mill & Rye",
      amount: "540.00",
      quotes: ["I'll pay Mill & Rye $540 for the flour delivery."],
    });
    const labels = draft({
      id: "labels",
      payee: "Sweet Stamp",
      amount: "88.00",
      quotes: ["I'll pay Sweet Stamp $88 for the labels."],
    });
    const results = checkDrafts({ transcript, owner: "Bea Ortiz", drafts: [flour, labels] });
    expect(results.map((item) => item.verdict)).toEqual(["Proven", "Proven"]);
  });
});

describe("approval gate admission", () => {
  const transcript = "Maya Chen (owner): I'll pay Harbor Print $480 on Friday for the spring menus.";
  const proven = draft({
    id: "menus",
    payee: "Harbor Print",
    amount: "480.00",
    purpose: "Spring menus",
    due: "Friday",
    quotes: ["I'll pay Harbor Print $480 on Friday for the spring menus."],
  });

  it("sends a proven draft to the gate and keeps the quote as the receipt", async () => {
    const gate = createPaymentGate({ port: createDemoPayPalPort() });
    const check = checkDraft({ transcript, owner: "Maya Chen", draft: proven });
    const admitted = await admitDraftToGate({
      gate,
      meetingId: "meeting-menus",
      draft: proven,
      check,
    });
    expect(admitted.admitted).toBe(true);
    if (!admitted.admitted) return;
    expect(admitted.record.status).toBe("pending_owner_approval");
    expect(admitted.record.purpose).toContain("Receipt:");
    expect(admitted.record.purpose).toContain(proven.quotes[0]);
    expect(admitted.record.amount).toBe("480.00");
    expect(gate.approvalLog().map((entry) => entry.action)).toEqual(["proposed"]);
  });

  it("holds a needs-a-look draft until the owner confirms it", async () => {
    const lookTranscript =
      "Helen Cho (owner): I'll pay Nico Alvarez 90 for the logo edits by Thursday.";
    const item = draft({
      id: "logo",
      payee: "Nico Alvarez",
      amount: "90.00",
      quotes: ["I'll pay Nico Alvarez 90 for the logo edits by Thursday."],
    });
    const check = checkDraft({ transcript: lookTranscript, owner: "Helen Cho", draft: item });
    expect(check.verdict).toBe("Needs a look");

    const held = createPaymentGate({ port: createDemoPayPalPort() });
    const without = await admitDraftToGate({
      gate: held,
      meetingId: "meeting-logo",
      draft: item,
      check,
    });
    expect(without.admitted).toBe(false);
    expect(held.list()).toHaveLength(0);

    const confirmed = createPaymentGate({ port: createDemoPayPalPort() });
    const withConfirm = await admitDraftToGate({
      gate: confirmed,
      meetingId: "meeting-logo",
      draft: item,
      check,
      ownerConfirmedLook: true,
    });
    expect(withConfirm.admitted).toBe(true);
    expect(confirmed.list()).toHaveLength(1);
    expect(confirmed.list()[0]?.status).toBe("pending_owner_approval");
  });

  it("never sends a blocked draft, even if someone tries to confirm it", async () => {
    const blocked = draft({
      id: "made-up",
      payee: "Ridge Roofing",
      amount: "1500.00",
      quotes: ["I'll pay Ridge Roofing $1,500 today."],
    });
    const check = checkDraft({ transcript, owner: "Maya Chen", draft: blocked });
    expect(check.verdict).toBe("Blocked");
    const gate = createPaymentGate({ port: createDemoPayPalPort() });
    const result = await admitDraftToGate({
      gate,
      meetingId: "meeting-menus",
      draft: blocked,
      check,
      ownerConfirmedLook: true,
    });
    expect(result.admitted).toBe(false);
    expect(result.explanation).toMatch(/never reach/);
    expect(gate.list()).toHaveLength(0);
    expect(gate.approvalLog()).toHaveLength(0);
  });
});
