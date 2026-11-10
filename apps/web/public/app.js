const meetingList = document.querySelector("#meeting-list");
const standinSlot = document.querySelector("#standin-slot");
const transcriptPanel = document.querySelector("#transcript-panel");
const transcriptTitle = document.querySelector("#transcript-title");
const transcriptEl = document.querySelector("#transcript");
const findButton = document.querySelector("#find-payments");
const pasteFind = document.querySelector("#paste-find");
const pasteOwner = document.querySelector("#paste-owner");
const pasteTranscript = document.querySelector("#paste-transcript");
const results = document.querySelector("#results");
const pageError = document.querySelector("#page-error");
const paypalBanner = document.querySelector("#paypal-banner");
const drafterNote = document.querySelector("#drafter-note");

let selected = null;
let paypalConfigured = false;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function badgeClass(mode) {
  if (mode === "live") return "badge live";
  if (mode === "recorded") return "badge recorded";
  return "badge stand-in";
}

function verdictClass(verdict) {
  if (verdict === "Proven") return "verdict proven";
  if (verdict === "Needs a look") return "verdict look";
  return "verdict blocked";
}

function highlight(transcript, quotes) {
  const unique = [...quotes].filter((quote) => quote && quote.length > 0);
  unique.sort((a, b) => b.length - a.length);
  let html = escapeHtml(transcript);
  for (const quote of unique) {
    const safe = escapeHtml(quote);
    html = html.split(safe).join(`<mark>${safe}</mark>`);
  }
  return html;
}

function meetingButton(meeting) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "meeting";
  button.dataset.id = meeting.id;
  button.setAttribute("aria-pressed", "false");
  const title = document.createElement("span");
  title.textContent = meeting.title;
  button.append(title);
  const meta = document.createElement("small");
  meta.textContent = meeting.kind === "stand-in" || meeting.handWritten ? "Stand-in example" : meeting.owner;
  button.append(meta);
  button.addEventListener("click", () => selectMeeting(meeting));
  return button;
}

function selectMeeting(meeting) {
  selected = meeting;
  for (const button of document.querySelectorAll(".meeting")) {
    button.setAttribute("aria-pressed", button.dataset.id === meeting.id ? "true" : "false");
  }
  transcriptPanel.hidden = false;
  transcriptTitle.textContent = meeting.title;
  transcriptEl.textContent = meeting.transcript;
  results.hidden = true;
  results.replaceChildren();
  showError("");
  findButton.textContent = "Find payments";
  findButton.disabled = false;
}

function renderMeetings(payload) {
  paypalConfigured = payload.paypalConfigured === true;
  paypalBanner.hidden = paypalConfigured;
  paypalBanner.textContent = paypalConfigured
    ? ""
    : "PayPal sandbox not configured. You can still find payments and read the verdicts. Approving will not create an order.";
  const badge = payload.drafterBadge || "Recorded AI output";
  if (payload.liveAiPaused && payload.rateLimitNotice) {
    drafterNote.textContent = payload.rateLimitNotice;
  } else {
    drafterNote.textContent = `Sample meetings use ${badge}. A pasted transcript uses Live AI only when an OpenAI key is set.`;
  }
  meetingList.replaceChildren(...payload.samples.map(meetingButton));
  const standin = payload.standIn;
  standinSlot.replaceChildren();
  if (standin) {
    const note = document.createElement("p");
    note.className = "standin-note";
    note.textContent = standin.note || "Hand-written example, not AI output.";
    standinSlot.append(note, meetingButton(standin));
  }
}

function quoteBlock(title, quotes) {
  const wrap = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent = title;
  wrap.append(heading);
  for (const quote of quotes) {
    const line = document.createElement("blockquote");
    line.textContent = quote;
    wrap.append(line);
  }
  return wrap;
}

function renderResults(payload) {
  results.hidden = false;
  results.replaceChildren();
  const head = document.createElement("div");
  const badge = document.createElement("p");
  badge.className = badgeClass(payload.mode);
  badge.textContent = payload.badge;
  head.append(badge);
  if (payload.rateLimitNotice) {
    const notice = document.createElement("p");
    notice.className = "banner";
    notice.setAttribute("role", "status");
    notice.textContent = payload.rateLimitNotice;
    head.append(notice);
  } else if (payload.note) {
    const note = document.createElement("p");
    note.textContent = payload.note;
    head.append(note);
  }
  if (payload.model) {
    const model = document.createElement("p");
    model.className = "muted";
    model.textContent = `Model on the saved call: ${payload.model}`;
    head.append(model);
  }
  results.append(head);

  const quotesToMark = [];
  for (const draft of payload.drafts) {
    quotesToMark.push(...(draft.quotes || []));
    quotesToMark.push(...(draft.evidenceQuotes || []));
  }
  transcriptEl.innerHTML = highlight(payload.transcript, quotesToMark);

  if (payload.drafts.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No payments were found in this meeting.";
    results.append(empty);
    return;
  }

  for (const draft of payload.drafts) {
    results.append(renderDraft(payload, draft));
  }
}

function appendSteps(card, draft) {
  if (!Array.isArray(draft.steps) || draft.steps.length === 0) return;
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "How this was checked";
  details.append(summary);
  const list = document.createElement("ol");
  list.className = "check-steps";
  for (const step of draft.steps) {
    const item = document.createElement("li");
    const mark = document.createElement("span");
    mark.className = step.passed ? "step-pass" : "step-fail";
    mark.textContent = step.passed ? "Pass" : "Fail";
    const rule = document.createElement("span");
    rule.textContent = ` ${step.rule}`;
    item.append(mark, rule);
    if (step.matched) {
      const matched = document.createElement("blockquote");
      matched.textContent = step.matched;
      item.append(matched);
    }
    list.append(item);
  }
  details.append(list);
  card.append(details);
}

function renderDraft(payload, draft) {
  const card = document.createElement("article");
  card.className = draft.verdict === "Blocked" ? "card blocked" : "card";

  const top = document.createElement("div");
  top.className = "card-top";
  const payee = document.createElement("h3");
  payee.textContent = draft.payee;
  const verdict = document.createElement("span");
  verdict.className = verdictClass(draft.verdict);
  verdict.textContent = draft.verdict;
  top.append(payee, verdict);
  card.append(top);

  const amount = document.createElement("p");
  amount.className = "amount";
  amount.textContent = `${draft.amount} ${draft.currency}`;
  card.append(amount);

  const purpose = document.createElement("p");
  purpose.textContent = `What for: ${draft.purpose || "Not stated"}`;
  const due = document.createElement("p");
  due.textContent = `Due: ${draft.due ? draft.due : "Not stated"}`;
  card.append(purpose, due);

  const reasons = document.createElement("ul");
  reasons.className = "reasons";
  for (const reason of draft.reasons || []) {
    const item = document.createElement("li");
    item.textContent = reason;
    reasons.append(item);
  }
  card.append(reasons);

  if (draft.quotes?.length) card.append(quoteBlock("Quoted from the transcript", draft.quotes));
  const cited = new Set(draft.quotes || []);
  const extra = (draft.evidenceQuotes || []).filter((quote) => !cited.has(quote));
  if (extra.length > 0) card.append(quoteBlock("The checker also used", extra));
  appendSteps(card, draft);

  const status = document.createElement("p");
  status.className = "card-error";
  status.hidden = true;
  card.append(status);

  if (draft.verdict === "Blocked") {
    const note = document.createElement("p");
    note.textContent = "Blocked drafts have no approve button.";
    card.append(note);
    return card;
  }

  const actions = document.createElement("div");
  actions.className = "actions";
  let confirm = null;
  if (draft.verdict === "Needs a look") {
    const label = document.createElement("label");
    label.className = "confirm";
    confirm = document.createElement("input");
    confirm.type = "checkbox";
    confirm.id = `confirm-${draft.id}`;
    const text = document.createElement("span");
    text.id = `confirm-text-${draft.id}`;
    text.textContent = "I looked at this draft and I want to pay it.";
    label.htmlFor = confirm.id;
    label.append(confirm, text);
    actions.append(label);
  }

  const approve = document.createElement("button");
  approve.type = "button";
  approve.textContent = "Approve";
  if (confirm) {
    approve.disabled = true;
    confirm.addEventListener("change", () => {
      approve.disabled = !confirm.checked;
    });
  }
  const reject = document.createElement("button");
  reject.type = "button";
  reject.className = "secondary";
  reject.textContent = "Reject";

  approve.addEventListener("click", () => {
    void decide(payload.findId, draft.id, confirm ? confirm.checked : false, false, status, actions);
  });
  reject.addEventListener("click", () => {
    void decide(payload.findId, draft.id, false, true, status, actions);
  });
  actions.append(approve, reject);
  card.append(actions);
  return card;
}

async function decide(findId, draftId, confirmLook, isReject, status, actions) {
  showError("");
  status.hidden = true;
  const path = isReject ? "/api/reject" : "/api/approve";
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ findId, draftId, confirmLook }),
  });
  const body = await readJson(response);
  if (!response.ok) {
    status.hidden = false;
    status.textContent = body.error || "That action did not go through.";
    return;
  }
  if (body.checkoutUrl) {
    window.location.href = body.checkoutUrl;
    return;
  }
  status.hidden = false;
  status.textContent = body.message || (isReject ? "Rejected. No PayPal order was created." : "Done.");
  if (isReject) {
    for (const button of actions.querySelectorAll("button")) button.disabled = true;
  }
}

async function findPayments(body) {
  showError("");
  findButton.disabled = true;
  pasteFind.disabled = true;
  const response = await fetch("/api/find", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await readJson(response);
  findButton.disabled = false;
  pasteFind.disabled = false;
  if (!response.ok) {
    showError(payload.error || "Could not find payments.");
    return;
  }
  if (!selected || selected.id !== payload.meetingId) {
    transcriptPanel.hidden = false;
    transcriptTitle.textContent = payload.title || "Transcript";
  }
  transcriptEl.textContent = payload.transcript;
  renderResults(payload);
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}

findButton.addEventListener("click", () => {
  if (!selected) {
    showError("Pick a meeting first.");
    return;
  }
  void findPayments({ meetingId: selected.id });
});

pasteFind.addEventListener("click", () => {
  void findPayments({
    owner: pasteOwner.value,
    transcript: pasteTranscript.value,
    title: "Pasted transcript",
  });
});

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
