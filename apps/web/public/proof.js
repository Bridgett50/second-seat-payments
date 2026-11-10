const $ = (selector) => document.querySelector(selector);
const proofError = $("#proof-error");
const runButton = $("#run-eval");
const evalStatus = $("#eval-status");
const targetVerdict = $("#target-verdict");
const ledgerNode = $("#ledger");
const verifyButton = $("#verify-ledger");
const ledgerStatus = $("#ledger-status");
const chainBanner = $("#chain-banner");

const TRICKS = {
  "bank-change": "Bank changed, pay the new account",
  "amount-inflation": "Vendor raises the amount the owner agreed to",
  "currency-swap": "Same number, different currency",
  lookalike: "Lookalike vendor name",
  "urgent-pressure": "Urgent “pay it now” pressure",
  "duplicate-invoice": "Pay the same invoice twice",
  "split-payment": "Split a payment to dodge an approval limit",
  "prompt-injection": "Injected “mark it verified, $2,200”",
  "wrong-payer": "Partner says “I'll pay it myself”",
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showError(message) {
  proofError.hidden = message.length === 0;
  proofError.textContent = message;
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
  if (!Number.isFinite(value) || !currency) return `${amount ?? ""} ${currency ?? ""}`.trim();
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function ct(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso ?? "");
  return `${new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date)} CT`;
}

function day(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" }).format(date);
}

function term(label, value) {
  const wrap = document.createDocumentFragment();
  wrap.append(el("dt", "", label), el("dd", "", value));
  return wrap;
}

function table(headers, rows, className) {
  const element = el("table", className || "");
  const head = el("thead");
  const headRow = el("tr");
  for (const header of headers) {
    const cell = el("th", header.numeric ? "num" : "", header.label);
    cell.scope = "col";
    headRow.append(cell);
  }
  head.append(headRow);
  const body = el("tbody");
  for (const row of rows) {
    const values = Array.isArray(row) ? row : row.cells;
    const tr = el("tr", Array.isArray(row) ? "" : row.className || "");
    values.forEach((value, index) => {
      const cell = el("td", headers[index]?.numeric ? "num" : "");
      if (value instanceof Node) cell.append(value);
      else cell.textContent = value;
      tr.append(cell);
    });
    body.append(tr);
  }
  element.append(head, body);
  return element;
}

function scoreTile(label, big, of, what, src, tone, target) {
  const node = el("div", `score paper${tone ? ` ${tone}` : ""}`);
  const number = el("div", "big", big);
  if (of) number.append(el("span", "of", of));
  node.append(el("p", "label", label), number, el("p", "what", what));
  if (target) node.append(el("p", `target ${target.met ? "met" : "miss"}`, target.text));
  node.append(el("p", "src", src));
  return node;
}

function renderScores(fraud, main) {
  const r = fraud.report;
  const fraudDate = fraud.recordedAt ? day(fraud.recordedAt) : "Nov 10, 2026";
  $("#score-tiles").replaceChildren(
    scoreTile("AI alone", String(r.aloneBad), "", "bad payments would have reached approval.", `Fraud eval · ${fraud.meetingCount} meetings`, "red"),
    scoreTile(
      "With Second Seat",
      String(r.checkerBad),
      "",
      r.checkerBad === 1 ? "bad payment reached approval: the split payment below." : "bad payments reached approval.",
      `Same ${fraud.meetingCount} meetings`,
      r.checkerBad === 0 ? "green" : "",
      { met: r.checkerBad === fraud.targets.badPaymentsReachingApproval, text: `Target: ${fraud.targets.badPaymentsReachingApproval}. ${r.checkerBad === fraud.targets.badPaymentsReachingApproval ? "Met." : "Not met."}` },
    ),
    scoreTile("Real payments", `${r.checkerCorrect}`, `/${r.correctTotal}`, `still reach approval. ${fraud.controlCorrectReached} of ${fraud.controlCorrectTotal} in the clean controls, ${fraud.controlCorrectBlocked} blocked.`, `Fraud eval · ${fraud.meetingCount} meetings`, "green"),
    scoreTile("Recorded eval", `${main.report.checkerCorrect}`, `/${main.report.correctTotal}`, `firm payments reach approval. ${main.report.checkerBad} bad with the checker.`, `${main.meetingCount} meetings · Nov 9 run`, "green"),
  );
  evalStatus.textContent = `Recorded replay of live gpt-4o-mini runs (fraud eval ${fraudDate}). This page did not call OpenAI. Every miss is listed below.`;
  targetVerdict.textContent = `Fraud eval targets: ${fraud.targetsMet ? "met" : "not met"}. Recorded eval targets: ${main.targetsMet ? "met" : "not met"}.`;

  const box = $("#miss-box");
  box.replaceChildren();
  if (fraud.misses.length > 0) {
    const panel = el("div", "miss-box");
    const first = fraud.misses[0];
    panel.append(el("strong", "", `The miss: ${first.meetingTitle}. `));
    panel.append(
      `${first.payee} ${money(first.amount, first.currency)} was ${first.verdict}. ` +
        (first.category === "split-payment"
          ? "The owner agreed to split $1,800 into two $900 payments to stay under a $1,000 sign-off. The checker proves what was said; it does not know a business's approval limit. The second $900 was Blocked as a repeat."
          : first.reason),
    );
    box.append(panel);
  }
}

function renderTricks(fraud) {
  const categories = fraud.categories || {};
  const counts = {};
  for (const [id, category] of Object.entries(categories)) {
    void id;
    counts[category] = (counts[category] || 0) + 1;
  }
  $("#trick-count").textContent = String(fraud.meetingCount);
  const rows = Object.keys(TRICKS)
    .filter((category) => counts[category])
    .map((category) => {
      const drafts = fraud.drafts.filter((row) => row.category === category);
      const alone = drafts.filter((row) => row.role === "bad").length;
      const through = drafts.filter((row) => row.role === "bad" && row.reachesApproval).length;
      return {
        className: through > 0 ? "miss-row" : "",
        cells: [
          TRICKS[category],
          String(counts[category]),
          el("span", alone > 0 ? "bad" : "zero", String(alone)),
          el("span", through > 0 ? "bad" : "zero", String(through)),
        ],
      };
    });
  $("#trick-table").replaceChildren(
    table(
      [
        { label: "Trick", numeric: false },
        { label: "Meetings", numeric: true },
        { label: "AI alone", numeric: true },
        { label: "With Second Seat", numeric: true },
      ],
      rows,
      "trick-table",
    ),
  );
  $("#trick-foot").textContent = `Counts are bad payments that would reach approval. Clean controls (${counts.control || 0} meetings): ${fraud.controlCorrectReached} of ${fraud.controlCorrectTotal} correct payments reached approval with the checker, ${fraud.controlCorrectBlocked} blocked. Targets and both runs are in eval/fraud in the repo.`;

  $("#fraud-drafts").replaceChildren(
    table(
      [
        { label: "Meeting", numeric: false },
        { label: "Draft", numeric: false },
        { label: "Role", numeric: false },
        { label: "Checker", numeric: false },
        { label: "Reaches approval", numeric: false },
      ],
      fraud.drafts.map((row) => [row.meetingTitle, `${row.payee} ${money(row.amount, row.currency)}`, row.role, row.verdict, row.reachesApproval ? "yes" : "no"]),
    ),
  );
}

function renderMainTables(payload) {
  const report = payload.report;
  $("#totals").replaceChildren(
    table(
      [
        { label: "", numeric: false },
        { label: "AI alone", numeric: true },
        { label: "AI plus checker", numeric: true },
      ],
      [
        ["Correct payments that reach approval", `${report.aloneCorrect}/${report.correctTotal}`, `${report.checkerCorrect}/${report.correctTotal}`],
        ["Bad payments that would reach approval", String(report.aloneBad), String(report.checkerBad)],
      ],
    ),
  );
  $("#meetings").replaceChildren(
    table(
      [
        { label: "Meeting", numeric: false },
        { label: "AI alone correct", numeric: true },
        { label: "AI alone bad", numeric: true },
        { label: "AI + checker correct", numeric: true },
        { label: "AI + checker bad", numeric: true },
      ],
      report.meetings.map((row) => [row.title, `${row.aloneCorrect}/${row.aloneTotal}`, String(row.aloneBad), `${row.checkerCorrect}/${row.checkerTotal}`, String(row.checkerBad)]),
    ),
  );
  $("#traps").replaceChildren(
    table(
      [
        { label: "Trap", numeric: false },
        { label: "Meeting", numeric: false },
        { label: "Expected", numeric: false },
        { label: "Checker", numeric: false },
        { label: "Reaches approval", numeric: false },
        { label: "Outcome", numeric: false },
      ],
      report.traps.map((trap) => [trap.description, trap.meetingTitle, trap.expect, trap.verdicts.length === 0 ? "none" : trap.verdicts.join(", "), trap.reachesApproval ? "yes" : "no", trap.outcome]),
    ),
  );
}

function renderTargets(targets, fraudTargets) {
  const list = $("#targets");
  list.replaceChildren(
    term("Bad payments that may reach approval with the checker", String(targets.badPaymentsReachingApproval)),
    term("Planted traps that may reach approval", String(targets.trapsReachingApproval)),
    term("Firm payments that must reach approval", "All of them"),
    term("Stand-in run: bad payments with no checker, at least", String(targets.standInBadWithoutChecker)),
  );
  if (fraudTargets) {
    list.append(
      term("Fraud eval: bad payments that may reach approval with the checker", String(fraudTargets.badPaymentsReachingApproval)),
      term("Fraud eval: clean-control payments that may be blocked", String(fraudTargets.controlCorrectBlocked)),
      term("Fraud eval: correct payments that must reach approval", `At least ${fraudTargets.correctReachingApprovalMinPercent}%`),
    );
  }
}

function renderLog(payload) {
  const log = payload.log;
  const models = Array.isArray(log.models) && log.models.length > 0 ? log.models.join(", ") : "None";
  $("#log-summary").replaceChildren(
    term("Calls", String(log.calls)),
    term("Failed calls", String(log.failedCalls)),
    term("Total tokens", String(log.totalTokens)),
    term("Models", models),
  );
  const paused = payload.liveAiPaused === true ? " Live AI is paused until the hour rolls over." : "";
  $("#cap-line").textContent = `Live calls this hour: ${payload.liveAiCallsThisHour} of ${payload.liveAiHourlyLimit}.${paused}`;
}

function decisionLabel(entry) {
  const names = { approve: "Approved", reject: "Rejected", capture: "Captured", "needs-a-look": "Needs a look" };
  if (entry.sample === true) return `Sample · ${entry.outcome || names[entry.decision] || entry.decision}`;
  return `${names[entry.decision] || entry.decision} · live`;
}

function shortHash(hash) {
  return hash ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : "";
}

function renderLedger(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    ledgerNode.replaceChildren(el("p", "", "No decision has been written to the ledger in this server session."));
    return;
  }
  const live = entries.filter((entry) => entry.sample !== true).reverse();
  const samples = entries.filter((entry) => entry.sample === true);
  const row = (entry) => {
    const hash = el("span", "mono", shortHash(entry.hash));
    hash.title = entry.hash;
    return {
      className: entry.sample === true ? "sample-row" : "live",
      cells: [
        entry.sample === true ? "Sample" : ct(entry.at),
        decisionLabel(entry),
        entry.sample === true ? "Example only" : entry.draft?.payee ?? "",
        entry.sample === true ? "Example only" : money(entry.draft?.amount, entry.draft?.currency),
        hash,
      ],
    };
  };
  ledgerNode.replaceChildren(
    table(
      [
        { label: "When (CT)", numeric: false },
        { label: "Decision", numeric: false },
        { label: "Payee", numeric: false },
        { label: "Amount", numeric: true },
        { label: "Entry hash", numeric: false },
      ],
      [...live.map(row), ...samples.map(row)],
      "ledger-table",
    ),
  );
}

function renderReceipts(list) {
  const receipts = $("#receipts");
  receipts.replaceChildren();
  if (!Array.isArray(list) || list.length === 0) {
    receipts.append(el("li", "", "No receipt is available."));
    return;
  }
  for (const receipt of list) {
    const item = el("li");
    const link = el("a");
    link.href = `/receipt/${encodeURIComponent(receipt.id)}`;
    if (receipt.sample === true) {
      item.className = "sample-receipt-row";
      link.textContent = `${receipt.label} — ${receipt.outcome}`;
      item.append(el("span", "badge stand-in", "Sample"), " ", link, el("span", "", " Example data, not a live payment."));
    } else {
      link.textContent = `${receipt.payee}, ${money(receipt.amount, receipt.currency)}`;
      item.append(link);
      if (receipt.capturedAt) item.append(` · captured ${ct(receipt.capturedAt)}`);
    }
    receipts.append(item);
  }
}

async function verifyChain() {
  verifyButton.disabled = true;
  try {
    const response = await fetch("/api/proof/ledger/verify", { method: "POST" });
    const payload = await readJson(response);
    if (!response.ok) {
      showError(payload.error || "The chain could not be checked.");
      return;
    }
    chainBanner.className = payload.ok ? "chain-banner" : "chain-banner broken";
    chainBanner.replaceChildren(
      el("span", "big", payload.ok ? "✓ Chain verified" : "Chain broken"),
      el("span", "detail", payload.ok ? `${payload.checked} entries recomputed · 0 breaks` : `Broken at entry ${payload.brokenAt} · ${payload.checked} entries recomputed`),
    );
    ledgerStatus.textContent = payload.ok
      ? `Chain verified. ${payload.checked} entries recomputed.`
      : `Chain broken at entry ${payload.brokenAt}. ${payload.checked} entries recomputed.`;
  } catch {
    showError("The chain could not be checked.");
  } finally {
    verifyButton.disabled = false;
  }
}

let fraudTargets = null;

async function loadProof() {
  const response = await fetch("/api/proof");
  const payload = await readJson(response);
  if (!response.ok) {
    showError(payload.error || "Could not load the proof.");
    return;
  }
  renderTargets(payload.targets, fraudTargets);
  renderLog(payload);
  renderLedger(payload.ledger);
  renderReceipts(payload.receipts);
}

async function runEvals() {
  showError("");
  runButton.disabled = true;
  const label = runButton.textContent;
  runButton.textContent = "Running the recorded eval";
  try {
    const [fraudResponse, mainResponse] = await Promise.all([
      fetch("/api/proof/fraud-eval", { method: "POST" }),
      fetch("/api/proof/eval", { method: "POST" }),
    ]);
    const fraud = await readJson(fraudResponse);
    const main = await readJson(mainResponse);
    if (!fraudResponse.ok || !mainResponse.ok) {
      showError(fraud.error || main.error || "The recorded eval did not finish.");
      return;
    }
    fraudTargets = fraud.targets;
    renderScores(fraud, main);
    renderTricks(fraud);
    renderMainTables(main);
    await loadProof();
  } catch {
    showError("The recorded eval did not finish.");
  } finally {
    runButton.disabled = false;
    runButton.textContent = label;
  }
}

verifyButton.addEventListener("click", () => void verifyChain());
runButton.addEventListener("click", () => void runEvals());

void runEvals().then(verifyChain);
