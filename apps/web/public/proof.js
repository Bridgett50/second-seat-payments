const proofError = document.querySelector("#proof-error");
const targetsList = document.querySelector("#targets");
const runButton = document.querySelector("#run-eval");
const evalStatus = document.querySelector("#eval-status");
const targetVerdict = document.querySelector("#target-verdict");
const totals = document.querySelector("#totals");
const meetings = document.querySelector("#meetings");
const traps = document.querySelector("#traps");
const logSummary = document.querySelector("#log-summary");
const capLine = document.querySelector("#cap-line");
const receipts = document.querySelector("#receipts");
const ledgerNode = document.querySelector("#ledger");
const verifyLedger = document.querySelector("#verify-ledger");
const ledgerStatus = document.querySelector("#ledger-status");

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

function term(label, value) {
  const wrap = document.createDocumentFragment();
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  wrap.append(dt, dd);
  return wrap;
}

function table(caption, headers, rows) {
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const element = document.createElement("table");
  const cap = document.createElement("caption");
  cap.textContent = caption;
  element.append(cap);
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  headers.forEach((header) => {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = header.label;
    if (header.numeric) cell.className = "num";
    headRow.append(cell);
  });
  head.append(headRow);
  const body = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    row.forEach((value, index) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (headers[index]?.numeric) cell.className = "num";
      tr.append(cell);
    });
    body.append(tr);
  }
  element.append(head, body);
  wrap.append(element);
  return wrap;
}

function renderTargets(targets) {
  targetsList.replaceChildren(
    term("Bad payments that may reach approval with the checker", String(targets.badPaymentsReachingApproval)),
    term("Planted traps that may reach approval", String(targets.trapsReachingApproval)),
    term("Firm payments that must reach approval", "all of them"),
    term(
      "Stand-in run: bad payments with no checker, at least",
      String(targets.standInBadWithoutChecker),
    ),
  );
}

function renderLog(payload) {
  const log = payload.log;
  const models = Array.isArray(log.models) && log.models.length > 0 ? log.models.join(", ") : "None";
  logSummary.replaceChildren(
    term("Calls", String(log.calls)),
    term("Failed calls", String(log.failedCalls)),
    term("Prompt tokens", String(log.promptTokens)),
    term("Completion tokens", String(log.completionTokens)),
    term("Total tokens", String(log.totalTokens)),
    term("Models", models),
  );
  const paused = payload.liveAiPaused === true ? " Live AI is paused until the hour rolls over." : "";
  capLine.textContent = `Live calls this hour: ${payload.liveAiCallsThisHour} of ${payload.liveAiHourlyLimit}.${paused}`;
}

function renderLedger(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    ledgerNode.replaceChildren();
    const empty = document.createElement("p");
    empty.textContent = "No decision has been written to the ledger in this server session.";
    ledgerNode.append(empty);
    return;
  }
  ledgerNode.replaceChildren(
    table(
      "Ledger",
      [
        { label: "Seq", numeric: true },
        { label: "When", numeric: false },
        { label: "Decision", numeric: false },
        { label: "Payee", numeric: false },
        { label: "Amount", numeric: false },
        { label: "PayPal order", numeric: false },
        { label: "PayPal capture", numeric: false },
        { label: "Previous hash", numeric: false },
        { label: "Hash", numeric: false },
      ],
      entries.map((entry) => [
        String(entry.seq),
        entry.at,
        entry.decision,
        entry.draft?.payee ?? "",
        `${entry.draft?.amount ?? ""} ${entry.draft?.currency ?? ""}`.trim(),
        entry.paypalOrderId ?? "",
        entry.paypalCaptureId ?? "",
        entry.previousHash,
        entry.hash,
      ]),
    ),
  );
}

function renderReceipts(list) {
  receipts.replaceChildren();
  if (!Array.isArray(list) || list.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No payment has been captured in this server session.";
    receipts.append(item);
    return;
  }
  for (const receipt of list) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = `/receipt/${encodeURIComponent(receipt.id)}`;
    link.textContent = `${receipt.payee}, ${receipt.amount} ${receipt.currency}`;
    item.append(link);
    if (receipt.capturedAt) {
      const time = document.createElement("time");
      time.dateTime = receipt.capturedAt;
      time.textContent = ` ${receipt.capturedAt}`;
      item.append(time);
    }
    receipts.append(item);
  }
}

function pair(found, total) {
  return `${found}/${total}`;
}

function metLine(label, actual, target, ok) {
  return `${label}: ${actual}. Target: ${target}. ${ok ? "Met." : "Not met."}`;
}

function renderEval(payload) {
  const report = payload.report;
  const targets = payload.targets;
  const model = payload.model ? ` Saved model: ${payload.model}.` : "";
  evalStatus.textContent = `${payload.label}${model}`;
  targetVerdict.textContent = payload.targetsMet === true ? "Targets for this run: met." : "Targets for this run: not met.";
  const badOk = report.checkerBad === targets.badPaymentsReachingApproval;
  const firmOk = report.checkerCorrect === report.correctTotal;
  const trapOk = report.trapsThrough === targets.trapsReachingApproval;
  totals.replaceChildren(
    table(
      "Totals",
      [
        { label: "", numeric: false },
        { label: "AI alone", numeric: true },
        { label: "AI plus checker", numeric: true },
      ],
      [
        ["Correct payments that reach approval", pair(report.aloneCorrect, report.correctTotal), pair(report.checkerCorrect, report.correctTotal)],
        ["Bad payments that would reach approval", String(report.aloneBad), String(report.checkerBad)],
      ],
    ),
  );
  const notes = document.createElement("ul");
  for (const line of [
    metLine("Bad payments reaching approval with the checker", report.checkerBad, targets.badPaymentsReachingApproval, badOk),
    metLine("Firm payments reaching approval with the checker", pair(report.checkerCorrect, report.correctTotal), "all of them", firmOk),
    metLine("Traps that got through", report.trapsThrough, targets.trapsReachingApproval, trapOk),
    `Drafts held for a look: ${report.heldForALook}. Drafts blocked: ${report.blocked}.`,
    `Traps the AI avoided: ${report.trapsAvoided}. Traps the checker caught: ${report.trapsCaught}. Traps that got through: ${report.trapsThrough}.`,
  ]) {
    const item = document.createElement("li");
    item.textContent = line;
    notes.append(item);
  }
  totals.append(notes);
  meetings.replaceChildren(
    table(
      "Per meeting",
      [
        { label: "Meeting", numeric: false },
        { label: "AI alone correct", numeric: true },
        { label: "AI alone bad", numeric: true },
        { label: "AI + checker correct", numeric: true },
        { label: "AI + checker bad", numeric: true },
      ],
      report.meetings.map((row) => [
        row.title,
        pair(row.aloneCorrect, row.aloneTotal),
        String(row.aloneBad),
        pair(row.checkerCorrect, row.checkerTotal),
        String(row.checkerBad),
      ]),
    ),
  );
  traps.replaceChildren(
    table(
      "Per trap",
      [
        { label: "Trap", numeric: false },
        { label: "Meeting", numeric: false },
        { label: "Expected", numeric: false },
        { label: "Checker", numeric: false },
        { label: "Reaches approval", numeric: false },
        { label: "Outcome", numeric: false },
      ],
      report.traps.map((trap) => [
        trap.description,
        trap.meetingTitle,
        trap.expect,
        trap.verdicts.length === 0 ? "none" : trap.verdicts.join(", "),
        trap.reachesApproval ? "yes" : "no",
        trap.outcome,
      ]),
    ),
  );
}

async function loadProof() {
  const response = await fetch("/api/proof");
  const payload = await readJson(response);
  if (!response.ok) {
    showError(payload.error || "Could not load the proof.");
    return;
  }
  showError("");
  renderTargets(payload.targets);
  renderLog(payload);
  renderLedger(payload.ledger);
  renderReceipts(payload.receipts);
}

verifyLedger.addEventListener("click", () => {
  void (async () => {
    showError("");
    verifyLedger.disabled = true;
    try {
      const response = await fetch("/api/proof/ledger/verify", { method: "POST" });
      const payload = await readJson(response);
      if (!response.ok) {
        showError(payload.error || "The chain could not be checked.");
        return;
      }
      ledgerStatus.textContent = payload.ok
        ? `Chain verified. ${payload.checked} entries recomputed.`
        : `Chain broken at entry ${payload.brokenAt}. ${payload.checked} entries recomputed.`;
    } catch {
      showError("The chain could not be checked.");
    } finally {
      verifyLedger.disabled = false;
    }
  })();
});

runButton.addEventListener("click", () => {
  void (async () => {
    showError("");
    runButton.disabled = true;
    const label = runButton.textContent;
    runButton.textContent = "Running the recorded eval";
    try {
      const response = await fetch("/api/proof/eval", { method: "POST" });
      const payload = await readJson(response);
      if (!response.ok) {
        showError(payload.error || "The recorded eval did not finish.");
        return;
      }
      renderEval(payload);
      await loadProof();
    } catch {
      showError("The recorded eval did not finish.");
    } finally {
      runButton.disabled = false;
      runButton.textContent = label;
    }
  })();
});

loadProof().catch(() => {
  showError("Could not load the proof.");
});
