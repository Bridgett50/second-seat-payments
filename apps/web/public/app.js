const $ = (selector) => document.querySelector(selector);
const homeSection = $("#home");
const transcriptPanel = $("#transcript-panel");
const transcriptTitle = $("#transcript-title");
const transcriptEl = $("#transcript");
const findButton = $("#find-payments");
const draftsSlot = $("#drafts-slot");
const pasteFind = $("#paste-find");
const pasteOwner = $("#paste-owner");
const pasteTranscript = $("#paste-transcript");
const results = $("#results");
const pageError = $("#page-error");
const paypalBanner = $("#paypal-banner");
const drafterNote = $("#drafter-note");

let selected = null;
let drafterMode = "recorded";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showError(message) {
  pageError.hidden = message.length === 0;
  pageError.textContent = message;
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || "The server sent a response that was not JSON." };
  }
}

function money(amount, currency) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function ctTime(date) {
  return `${new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }).format(date)} CT`;
}

function firstName(owner) {
  return String(owner || "The owner").trim().split(/\s+/)[0] || "The owner";
}

/* ---------- transcript lines ---------- */

function parseLines(transcript, owner) {
  const ownerName = String(owner || "").trim().toLowerCase();
  return String(transcript)
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const match = /^([^:]{1,120}):\s*(.*)$/.exec(line.trim());
      const speaker = match ? match[1].trim() : "";
      const text = match ? match[2] : line.trim();
      const name = speaker.replace(/\([^)]*\)/g, "").trim().toLowerCase();
      const isOwner = /\(owner\)/i.test(speaker) || (ownerName.length > 0 && name === ownerName);
      return { speaker, text, isOwner, raw: line.trim() };
    });
}

function lineOf(lines, quote) {
  const needle = String(quote).trim();
  return lines.findIndex((line) => line.raw.includes(needle) || line.text.includes(needle.replace(/^[^:]{1,120}:\s*/, "")));
}

/** Append text to a node, wrapping each listed phrase in a mark with the given class. */
function appendMarked(node, text, phrases) {
  const list = phrases.filter((item) => item.text && item.text.length > 0);
  let rest = String(text);
  while (rest.length > 0) {
    let best = null;
    for (const item of list) {
      const index = rest.indexOf(item.text);
      if (index >= 0 && (best === null || index < best.index || (index === best.index && item.text.length > best.item.text.length))) {
        best = { index, item };
      }
    }
    if (best === null) {
      node.append(rest);
      return;
    }
    if (best.index > 0) node.append(rest.slice(0, best.index));
    node.append(el("span", best.item.className, best.item.text));
    rest = rest.slice(best.index + best.item.text.length);
  }
}

function renderTranscript(transcript, owner) {
  transcriptEl.replaceChildren();
  for (const line of parseLines(transcript, owner)) {
    const row = el("div", line.isOwner ? "line owner" : "line");
    if (line.speaker) {
      row.append(el("span", "speaker", `${line.speaker}:`), " ", line.text);
    } else {
      row.append(line.text);
    }
    transcriptEl.append(row);
  }
}

/* ---------- views ---------- */

function showView(name) {
  homeSection.hidden = name !== "home";
  transcriptPanel.hidden = name !== "meeting";
  results.hidden = name !== "results";
  window.scrollTo(0, 0);
}

function resetDrafts() {
  draftsSlot.replaceChildren(el("div", "skeleton"), el("div", "skeleton faint"));
}

function selectMeeting(meeting) {
  selected = meeting;
  for (const button of document.querySelectorAll(".meeting")) {
    button.setAttribute("aria-pressed", button.dataset.id === meeting.id ? "true" : "false");
  }
  transcriptTitle.textContent = meeting.title;
  renderTranscript(meeting.transcript, meeting.owner);
  resetDrafts();
  results.replaceChildren();
  showError("");
  findButton.disabled = false;
  showView("meeting");
}

function meetingButton(meeting) {
  const button = el("button", "meeting");
  button.type = "button";
  button.dataset.id = meeting.id;
  button.setAttribute("aria-pressed", "false");
  button.append(el("span", "", meeting.title));
  button.append(el("small", "", meeting.kind === "stand-in" || meeting.handWritten ? "Stand-in example" : meeting.owner));
  button.addEventListener("click", () => selectMeeting(meeting));
  return button;
}

function pinnedCard(meeting) {
  const card = el("div", "pinned paper");
  card.append(el("p", "label", "Start here · live catch"));
  card.append(el("h2", "", "“Our bank changed”"));
  card.append(el("p", "", "A vendor asks to be paid at a new account. Watch what the AI drafts."));
  const go = el("button", "button primary", "Find payments →");
  go.type = "button";
  go.dataset.id = meeting.id;
  go.addEventListener("click", () => selectMeeting(meeting));
  card.append(go);
  return card;
}

function renderMeetings(payload) {
  const paypalConfigured = payload.paypalConfigured === true;
  paypalBanner.hidden = paypalConfigured;
  paypalBanner.textContent = paypalConfigured
    ? ""
    : "PayPal sandbox not configured. You can still find payments and read the verdicts. Approving will not create an order.";
  drafterMode = payload.drafter === "live" ? "live" : "recorded";
  const badge = payload.drafterBadge || "Recorded AI output";
  drafterNote.textContent =
    payload.liveAiPaused && payload.rateLimitNotice
      ? payload.rateLimitNotice
      : `Sample meetings use ${badge}. A pasted transcript uses Live AI only when an OpenAI key is set.`;

  const samples = payload.samples || [];
  const pinned = samples.find((meeting) => meeting.id === "00-harbor-bank-change");
  const rest = samples.filter((meeting) => meeting !== pinned && !meeting.handWritten);
  const clean = rest.filter((meeting) => (meeting.payments ?? 1) > 0);
  const traps = rest.filter((meeting) => meeting.payments === 0);
  const shown = [...clean.slice(0, 2), ...traps.slice(0, 2)];
  $("#pinned-slot").replaceChildren(...(pinned ? [pinnedCard(pinned)] : []));
  $("#clean-list").replaceChildren(...clean.slice(0, 2).map(meetingButton));
  $("#trap-list").replaceChildren(...traps.slice(0, 2).map(meetingButton));
  const others = samples.filter((meeting) => meeting !== pinned && !shown.includes(meeting));
  $("#meeting-list").replaceChildren(...others.map(meetingButton));
  $("#more-summary").textContent = `+ ${others.length} more meetings · Paste your own transcript`;
  const standin = payload.standIn;
  const slot = $("#standin-slot");
  slot.replaceChildren();
  if (standin) {
    slot.append(el("p", "standin-note", standin.note || "Hand-written example, not AI output."), meetingButton(standin));
  }
}

function tile(num, what, src, tone) {
  const node = el("div", `tile paper${tone ? ` ${tone}` : ""}`);
  node.append(el("div", "num", num), el("div", "what", what), el("div", "src", src));
  return node;
}

async function loadTiles() {
  const slot = $("#home-tiles");
  try {
    const [fraudResponse, evalResponse] = await Promise.all([
      fetch("/api/proof/fraud-eval", { method: "POST" }),
      fetch("/api/proof/eval", { method: "POST" }),
    ]);
    if (!fraudResponse.ok || !evalResponse.ok) return;
    const fraud = await readJson(fraudResponse);
    const main = await readJson(evalResponse);
    slot.replaceChildren(
      tile(String(fraud.report.aloneBad), "bad payments AI alone would send to approval", `Fraud eval · ${fraud.meetingCount} meetings`, "red"),
      tile(String(fraud.report.checkerBad), `got past the checker: ${fraud.report.checkerBad === 1 ? "an owner-agreed split payment" : "see Proof"}`, "Same meetings, with Second Seat", ""),
      tile(`${main.report.checkerCorrect}/${main.report.correctTotal}`, "real payments still approved", `Recorded eval · ${main.meetingCount} meetings, Nov 9`, "green"),
    );
  } catch {
    slot.replaceChildren();
  }
}

/* ---------- cards ---------- */

function modeLabel(payload) {
  if (payload.mode === "live") return `Drafted live by ${payload.model && payload.model.startsWith("gpt-4o-mini") ? "gpt-4o-mini" : payload.model || "the AI"}`;
  if (payload.mode === "recorded") return "Saved output from a live gpt-4o-mini run";
  return "Stand-in example · written by hand, not AI";
}

const MONEY_RE = /[$€£]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:euros?|dollars?)/i;

function namedPayee(quotes) {
  for (const quote of quotes) {
    const match = /\bpay\s+([A-Z][A-Za-z0-9'&.\-]*(?:\s+[A-Z][A-Za-z0-9'&.\-]*)*)/.exec(quote);
    if (match) return match[1].replace(/[.,]$/, "");
  }
  return null;
}

function failed(draft, word) {
  return (draft.steps || []).some((step) => !step.passed && step.rule.toLowerCase().includes(word));
}

function splitQuotes(payload, draft) {
  const lines = parseLines(payload.transcript, payload.owner);
  const owner = [];
  const vendor = [];
  for (const quote of draft.quotes || []) {
    const index = lineOf(lines, quote);
    const line = lines[index];
    const clean = String(quote).replace(/^[^:]{1,120}:\s*/, "");
    if (line && line.isOwner) owner.push({ text: clean, index });
    else vendor.push({ text: clean, index });
  }
  return { lines, owner, vendor };
}

function quoteBox(label, quotes, phrases) {
  const box = el("div", "quote");
  box.append(el("span", "label", label));
  quotes.forEach((quote, index) => {
    if (index > 0) box.append(" … ");
    box.append("“");
    appendMarked(box, quote, phrases);
    box.append("”");
  });
  return box;
}

function stepsDetails(draft, summaryText) {
  const details = el("details");
  details.append(el("summary", "", summaryText));
  const list = el("ol", "check-steps");
  for (const step of draft.steps || []) {
    const item = el("li");
    item.append(el("span", step.passed ? "step-pass" : "step-fail", step.passed ? "Pass" : "Fail"), step.rule);
    list.append(item);
  }
  details.append(list);
  return details;
}

function payeeLine(draft, strike) {
  const line = el("p", "payee-line");
  const tail = [draft.purpose, draft.due ? `due ${draft.due}` : ""].filter(Boolean).join(" · ");
  if (strike) line.append(el("s", "", draft.payee));
  else line.append(draft.payee);
  if (tail) line.append(` · ${tail}`);
  return line;
}

function amountLine(draft, strike) {
  const amount = el("p", "amount");
  const value = money(draft.amount, draft.currency);
  if (strike) amount.append(el("s", "", value));
  else amount.append(value);
  amount.append(el("span", "ccy", draft.currency));
  return amount;
}

function renderBlocked(payload, draft, card) {
  const first = firstName(payload.owner);
  const { lines, owner, vendor } = splitQuotes(payload, draft);
  const payeeFailed = failed(draft, "payee");
  const amountFailed = failed(draft, "amount");
  const head = el("div", "card-head");
  const left = el("div");
  left.append(el("p", "mode-badge", modeLabel(payload)), amountLine(draft, amountFailed && !payeeFailed), payeeLine(draft, payeeFailed));
  head.append(left, el("div", "stamp blocked", "BLOCKED"));
  card.append(head);

  const ownerNamed = namedPayee(owner.map((item) => item.text));
  let reason = draft.reasons?.[0] || "The checker could not prove this draft.";
  if (payeeFailed && ownerNamed && ownerNamed !== draft.payee) {
    reason = `${first} agreed to pay ${ownerNamed}. ${first}'s own words never name ${draft.payee}.`;
  } else if (amountFailed) {
    const said = owner.map((item) => MONEY_RE.exec(item.text)?.[0]).find(Boolean);
    if (said) reason = `The draft says ${money(draft.amount, draft.currency)}. ${first} said ${said}.`;
  }
  card.append(el("p", "reason", reason));
  card.append(el("p", "checker-says", `Checker: ${(draft.reasons || []).join(" ")}`));

  const ownerTexts = owner.map((item) => item.text);
  for (const item of vendor) {
    const next = lines[item.index + 1];
    if (next && next.isOwner && !ownerTexts.includes(next.text)) ownerTexts.push(next.text);
  }
  const quotes = el("div", vendor.length > 0 && ownerTexts.length > 0 ? "quotes" : "quotes single");
  if (vendor.length > 0) {
    quotes.append(quoteBox("Vendor said", vendor.map((item) => item.text), [{ text: draft.payee, className: "hl-red" }]));
  }
  if (ownerTexts.length > 0) {
    const ownerPhrases = ownerNamed ? [{ text: ownerNamed, className: "hl" }] : [];
    quotes.append(quoteBox("Owner said", ownerTexts, ownerPhrases));
  }
  if (quotes.childElementCount > 0) card.append(quotes);
  card.append(el("p", "no-approve", "No approve button. A blocked draft can't be paid."));
  card.append(stepsDetails(draft, `How this was checked (${(draft.steps || []).length} checks)`));
}

function renderProvenOrLook(payload, draft, card) {
  const first = firstName(payload.owner);
  const proven = draft.verdict === "Proven";
  const head = el("div", "card-head");
  const left = el("div");
  left.append(el("p", "mode-badge", modeLabel(payload)), amountLine(draft, false), payeeLine(draft, false));
  head.append(left, el("div", proven ? "stamp proven" : "stamp look", proven ? "PROVEN" : "NEEDS A LOOK"));
  card.append(head);
  if (!proven) card.append(el("p", "reason", draft.reasons?.[0] || "This draft needs a look."));

  const { owner, vendor } = splitQuotes(payload, draft);
  const said = owner.map((item) => item.text);
  const amountText = said.map((text) => MONEY_RE.exec(text)?.[0]).find(Boolean);
  const phrases = [{ text: draft.payee, className: "hl" }, ...(amountText ? [{ text: amountText, className: "hl" }] : [])];
  const quotes = el("div", "quotes single");
  if (said.length > 0) quotes.append(quoteBox(`${first}'s own words`, said, phrases));
  const extra = [...vendor.map((item) => item.text), ...(draft.evidenceQuotes || []).filter((quote) => !(draft.quotes || []).includes(quote))];
  if (extra.length > 0) quotes.append(quoteBox("The checker also used", extra, phrases));
  card.append(quotes);

  const steps = draft.steps || [];
  const passed = steps.filter((step) => step.passed).length;
  card.append(
    stepsDetails(
      draft,
      proven
        ? `${passed} of ${steps.length} checks passed: amount said word for word · payee named by the owner · nothing later cancels it`
        : `How this was checked (${passed} of ${steps.length} passed)`,
    ),
  );

  const status = el("p", "card-error");
  status.hidden = true;
  const actions = el("div", "actions");
  let confirm = null;
  if (!proven) {
    const label = el("label", "confirm");
    confirm = el("input");
    confirm.type = "checkbox";
    confirm.id = `confirm-${draft.id}`;
    const text = el("span", "", "I looked at this draft and I want to pay it.");
    text.id = `confirm-text-${draft.id}`;
    label.htmlFor = confirm.id;
    label.append(confirm, text);
    actions.append(label);
  }
  const approve = el("button", "primary approve", `Approve ${money(draft.amount, draft.currency)}`);
  approve.type = "button";
  if (confirm) {
    approve.disabled = true;
    confirm.addEventListener("change", () => {
      approve.disabled = !confirm.checked;
    });
  }
  const reject = el("button", "secondary", "Reject");
  reject.type = "button";
  approve.addEventListener("click", () => {
    void decide(payload, draft, confirm ? confirm.checked : false, false, status, actions);
  });
  reject.addEventListener("click", () => {
    void decide(payload, draft, false, true, status, actions);
  });
  actions.append(approve, reject);
  card.append(actions, status);
}

function renderDraft(payload, draft) {
  const tone = draft.verdict === "Blocked" ? "blocked" : draft.verdict === "Proven" ? "proven" : "look";
  const card = el("article", `card ${tone}`);
  if (draft.verdict === "Blocked") renderBlocked(payload, draft, card);
  else renderProvenOrLook(payload, draft, card);
  return card;
}

function renderResults(payload) {
  results.replaceChildren();
  const head = el("div", "results-head");
  const back = el("button", "linklike", "← Back to the transcript");
  back.type = "button";
  back.addEventListener("click", () => showView("meeting"));
  const home = el("button", "linklike back-home", "All meetings");
  home.type = "button";
  home.addEventListener("click", () => showView("home"));
  head.append(back, home);
  if (payload.rateLimitNotice) {
    const notice = el("p", "banner", payload.rateLimitNotice);
    notice.setAttribute("role", "status");
    head.append(notice);
  } else if (payload.liveFallback && payload.note) {
    const note = el("p", "fallback-note", payload.note);
    note.setAttribute("role", "status");
    head.append(note);
  } else if (payload.mode === "stand-in" && payload.note) {
    head.append(el("p", "note", payload.note));
  }
  results.append(head);
  if (payload.drafts.length === 0) {
    results.append(el("p", "empty", "No payments were found in this meeting."));
  }
  for (const draft of payload.drafts) results.append(renderDraft(payload, draft));
  showView("results");
}

/* ---------- approve moment ---------- */

function approveMoment(payload, draft) {
  const overlay = el("div", "approve-overlay");
  overlay.setAttribute("role", "status");
  const panel = el("div", "approve-panel");
  panel.append(el("p", "label", `Approved by ${payload.owner || "the owner"} · ${ctTime(new Date())}`));
  panel.append(el("h2", "", "Opening PayPal…"));
  const order = el("p");
  order.append("Order for ", el("strong", "", `${money(draft.amount, draft.currency)} ${draft.currency}`), `${draft.purpose ? `, ${draft.purpose}` : ""}.`);
  panel.append(order, el("p", "", "PayPal sandbox: the test merchant receives it. No real money moves."));
  if (draft.quotes?.[0]) panel.append(el("div", "quote", `“${String(draft.quotes[0]).replace(/^[^:]{1,120}:\s*/, "")}”`));
  panel.append(el("p", "after", "Logged to the decision chain before PayPal opens. After you pay, Second Seat captures the order and asks PayPal for its status before it shows a receipt."));
  overlay.append(panel);
  document.body.append(overlay);
}

async function decide(payload, draft, confirmLook, isReject, status, actions) {
  showError("");
  status.hidden = true;
  const response = await fetch(isReject ? "/api/reject" : "/api/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ findId: payload.findId, draftId: draft.id, confirmLook }),
  });
  const body = await readJson(response);
  if (!response.ok) {
    status.hidden = false;
    status.textContent = body.error || "That action did not go through.";
    return;
  }
  if (body.checkoutUrl) {
    approveMoment(payload, draft);
    window.setTimeout(() => {
      window.location.href = body.checkoutUrl;
    }, 1600);
    return;
  }
  status.hidden = false;
  status.textContent = body.message || (isReject ? "Rejected. No PayPal order was created." : "Done.");
  if (isReject) {
    for (const button of actions.querySelectorAll("button")) button.disabled = true;
  }
}

/* ---------- find ---------- */

function showLoading(transcript, owner) {
  const count = parseLines(transcript, owner).length;
  const card = el("div", "loading");
  card.append(
    el("strong", "", drafterMode === "live" ? `gpt-4o-mini is reading ${count} lines…` : "Loading the saved gpt-4o-mini drafts…"),
    el("p", "", `Next: every draft is checked against ${firstName(owner)}'s own words.`),
  );
  draftsSlot.replaceChildren(card, el("div", "skeleton"), el("div", "skeleton faint"));
}

async function findPayments(body, owner, transcript) {
  showError("");
  findButton.disabled = true;
  pasteFind.disabled = true;
  if (body.meetingId) showLoading(transcript, owner);
  const response = await fetch("/api/find", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await readJson(response);
  findButton.disabled = false;
  pasteFind.disabled = false;
  if (!response.ok) {
    resetDrafts();
    showError(payload.error || "Could not find payments.");
    return;
  }
  if (!selected || selected.id !== payload.meetingId) {
    transcriptTitle.textContent = payload.title || "Transcript";
    renderTranscript(payload.transcript, payload.owner);
  }
  renderResults(payload);
}

findButton.addEventListener("click", () => {
  if (!selected) {
    showError("Pick a meeting first.");
    return;
  }
  void findPayments({ meetingId: selected.id }, selected.owner, selected.transcript);
});

pasteFind.addEventListener("click", () => {
  selected = null;
  void findPayments({ owner: pasteOwner.value, transcript: pasteTranscript.value, title: "Pasted transcript" });
});

for (const button of document.querySelectorAll(".back-home")) {
  button.addEventListener("click", () => showView("home"));
}

fetch("/api/meetings")
  .then(readJson)
  .then((payload) => {
    if (!payload.samples) {
      showError(payload.error || "Could not load the sample meetings.");
      return;
    }
    renderMeetings(payload);
  })
  .catch(() => {
    showError("Could not load the sample meetings.");
  });

void loadTiles();
