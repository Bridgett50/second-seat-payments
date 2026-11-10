/**
 * Payments page. One Node server for the demo:
 * pick a meeting, find drafts, read the checker's verdict, approve or reject.
 * Approve goes through the approval gate and, when sandbox credentials are
 * set, creates a PayPal sandbox order. Missing PayPal env vars stay visible
 * as "PayPal sandbox not configured". Nothing here pretends a payment happened.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  admitDraftToGate,
  checkDrafts,
  createPaymentGate,
  decideAdmission,
  EVAL_TARGETS,
  findDrafts,
  recordedTargetsMet,
  type CheckResult,
  type DrafterMode,
  type PaymentDraft,
  type PaymentGate,
  type PayPalPort,
} from "@second-seat/core";
import { appendLedgerEntry, verifyLedger, type LedgerEntry } from "./ledger.js";
import { summarizeModelLog } from "./modelLog.js";
import { nextCaptureStep, verifiedCaptured } from "./orderCheck.js";
import {
  capturePayPalSandboxOrder,
  createPayPalSandboxPort,
  fetchPayPalSandboxOrder,
  type CapturedPayPalOrder,
  type PayPalOrderSnapshot,
  type PayPalSandboxConfig,
} from "./paypalSandbox.js";
import {
  createLiveCallLimiter,
  pastePausedNotice,
  readHourlyLimit,
  recordedFallbackNotice,
  type LiveCallLimiter,
} from "./rateLimit.js";
import { runRecordedEval } from "./recordedEval.js";

const DEMO_ID = "demo-made-up-amount";
const FOOTER = "PayPal Sandbox. No real money moves.";
const NOT_CONFIGURED = "PayPal sandbox not configured";

export interface ServerOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  port?: number;
  root?: string;
  /** Test double for the approval gate. When set, PayPal counts as configured. */
  paypalPort?: PayPalPort;
  captureOrder?: (orderId: string) => Promise<CapturedPayPalOrder>;
  /** Test double for the order lookup that decides whether a return is Captured. */
  getOrder?: (orderId: string) => Promise<PayPalOrderSnapshot>;
  cacheDir?: string;
  logPath?: string;
  /** Clock for the audit log and the live-call cap. */
  now?: () => Date;
}

export interface RunningServer {
  port: number;
  close: () => Promise<void>;
}

interface SampleMeeting {
  id: string;
  title: string;
  owner: string;
  transcript: string;
  kind: "sample" | "stand-in";
  note: string;
  /** Hand-written drafts. They are not replayed as recorded model output. */
  set?: "stand-in";
  handWritten?: boolean;
}

interface DemoFile {
  id: string;
  title: string;
  owner: string;
  transcript: string;
  note?: string;
  drafts: PaymentDraft[];
}

interface FindSession {
  id: string;
  meetingId: string;
  title: string;
  owner: string;
  transcript: string;
  mode: DrafterMode;
  model: string | null;
  badge: string;
  note: string;
  rateLimitNotice: string | null;
  drafts: PaymentDraft[];
  checks: CheckResult[];
}

interface AuditEvent {
  at: string;
  action: "approve" | "reject" | "capture";
  detail: string;
}

interface TrackedPayment {
  id: string;
  draftKey: string;
  draft: PaymentDraft;
  quotes: string[];
  orderId: string | null;
  captureId: string | null;
  captureStatus: string | null;
  amount: string;
  currency: string;
  payee: string;
  purpose: string;
  status: "approved" | "captured" | "rejected" | "cancelled";
  checkoutUrl: string | null;
  /** PayPal's own status from the last order lookup, when we have one. */
  paypalStatus: string | null;
  audit: AuditEvent[];
}

function findRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(path.join(dir, "fixtures", "meetings")) && existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("Could not find the repository root.");
    dir = parent;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function badgeFor(mode: DrafterMode): string {
  if (mode === "live") return "Live AI";
  if (mode === "recorded") return "Recorded AI output";
  return "Stand-in example";
}

function noteFor(mode: DrafterMode): string {
  if (mode === "live") return "These drafts came from a live OpenAI call.";
  if (mode === "recorded") {
    return "These drafts are saved output from a live gpt-4o-mini run. This request did not call OpenAI.";
  }
  return "These drafts were written by hand. They are not AI output.";
}

function receiptQuotes(draft: PaymentDraft, check: CheckResult): string[] {
  const seen = new Set<string>();
  const quotes: string[] = [];
  for (const quote of [...draft.quotes, ...(check.evidenceQuotes ?? [])]) {
    const trimmed = quote.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    quotes.push(trimmed);
  }
  return quotes;
}

function isDraft(value: unknown): value is PaymentDraft {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.payee === "string" &&
    typeof record.amount === "string" &&
    typeof record.currency === "string" &&
    typeof record.purpose === "string" &&
    typeof record.due === "string" &&
    Array.isArray(record.quotes) &&
    record.quotes.every((quote) => typeof quote === "string")
  );
}

function loadSamples(root: string): { samples: SampleMeeting[]; standIn: SampleMeeting; demo: DemoFile } {
  const dir = path.join(root, "fixtures", "meetings");
  const samples = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const parsed = JSON.parse(readFileSync(path.join(dir, name), "utf8")) as SampleMeeting;
      return {
        id: parsed.id,
        title: parsed.title,
        owner: parsed.owner,
        transcript: parsed.transcript,
        kind: "sample" as const,
        handWritten: parsed.set === "stand-in",
        note: parsed.set === "stand-in" ? "Hand-written example, not AI output." : "",
      };
    });
  const demo = JSON.parse(readFileSync(path.join(root, "fixtures", "demo", "made-up-amount.json"), "utf8")) as DemoFile;
  if (!Array.isArray(demo.drafts) || !demo.drafts.every(isDraft)) {
    throw new Error("The stand-in example is not a list of payment drafts.");
  }
  const standIn: SampleMeeting = {
    id: demo.id,
    title: demo.title,
    owner: demo.owner,
    transcript: demo.transcript,
    kind: "stand-in",
    note: demo.note ?? "Hand-written example, not AI output.",
  };
  return { samples, standIn, demo };
}

function header(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name];
  if (typeof value === "string" && value.trim().length > 0) return value.split(",")[0]?.trim() ?? null;
  return null;
}

function publicBase(req: IncomingMessage): string {
  const proto = header(req, "x-forwarded-proto") ?? "http";
  const host = header(req, "x-forwarded-host") ?? header(req, "host") ?? "127.0.0.1";
  return `${proto}://${host}`;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("That transcript is too long to check.");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim().length === 0) return {};
  return JSON.parse(text) as unknown;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(html);
}

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <header class="site-header">
    <a class="skip" href="#main">Skip to content</a>
    <div class="header-bar">
      <p class="eyebrow">Second Seat</p>
      <nav aria-label="Sections">
        <a href="/">Payments</a>
        <a href="/proof">Proof</a>
      </nav>
    </div>
    <h1>${escapeHtml(title)}</h1>
    <p class="wake">If the first load is slow, the free server is waking up. Wait a few seconds and reload.</p>
  </header>
  <main id="main">${body}</main>
  <footer class="site-footer"><p class="sandbox-badge">${FOOTER}</p></footer>
</body>
</html>`;
}

function presentDraft(draft: PaymentDraft, check: CheckResult): Record<string, unknown> {
  return {
    id: draft.id,
    payee: draft.payee,
    amount: draft.amount,
    currency: draft.currency,
    purpose: draft.purpose,
    due: draft.due,
    quotes: draft.quotes,
    verdict: check.verdict,
    reasons: check.reasons,
    steps: check.steps,
    ...(check.evidenceQuotes !== undefined ? { evidenceQuotes: check.evidenceQuotes } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = options.root ?? findRoot(here);
  const env = options.env ?? process.env;
  const publicDir = path.resolve(here, "../public");
  const { samples, standIn, demo } = loadSamples(root);
  const meetings = new Map<string, SampleMeeting>([...samples, standIn].map((meeting) => [meeting.id, meeting]));

  const secrets = [env.OPENAI_API_KEY, env.PAYPAL_CLIENT_ID, env.PAYPAL_CLIENT_SECRET]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0);

  function redact(text: string): string {
    let out = text;
    for (const secret of secrets) out = out.split(secret).join("[redacted]");
    return out;
  }

  const sandbox = sandboxFromEnv(env);
  const checkoutUrls = { returnUrl: "", cancelUrl: "" };
  const port = options.paypalPort ?? (sandbox === null ? null : sandboxPort(sandbox));
  const gate: PaymentGate | null = port === null ? null : createPaymentGate({ port });
  const paypalConfigured = gate !== null;

  function sandboxPort(config: PayPalSandboxConfig): PayPalPort {
    const withFetch = {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    };
    return {
      mode: "sandbox",
      createOrder(commitment) {
        return createPayPalSandboxPort({
          ...withFetch,
          returnUrl: checkoutUrls.returnUrl,
          cancelUrl: checkoutUrls.cancelUrl,
        }).createOrder(commitment);
      },
      cancelOrder(orderId) {
        return createPayPalSandboxPort(withFetch).cancelOrder(orderId);
      },
    };
  }

  const sessions = new Map<string, FindSession>();
  const payments = new Map<string, TrackedPayment>();
  const byOrder = new Map<string, TrackedPayment>();
  const byDraft = new Map<string, TrackedPayment>();
  const now = options.now ?? (() => new Date());
  const limiter: LiveCallLimiter = createLiveCallLimiter(readHourlyLimit(env.LIVE_AI_HOURLY_LIMIT));
  const ledger: LedgerEntry[] = [];

  function clock(): number {
    return now().getTime();
  }

  function stamp(): string {
    return now().toISOString();
  }

  function livePaused(): boolean {
    return openaiKey().length > 0 && !limiter.allow(clock());
  }

  function recordAudit(payment: TrackedPayment, action: AuditEvent["action"], detail: string): void {
    payment.audit.push({ at: stamp(), action, detail });
  }

  function recordLedger(
    payment: TrackedPayment,
    decision: LedgerEntry["decision"],
    captureId: string | null,
  ): void {
    ledger.push(
      appendLedgerEntry(ledger, {
        at: stamp(),
        decision,
        draft: {
          id: payment.draft.id,
          payee: payment.payee,
          amount: payment.amount,
          currency: payment.currency,
          purpose: payment.purpose,
        },
        quotes: payment.quotes,
        paypalOrderId: payment.orderId,
        paypalCaptureId: captureId,
      }),
    );
  }

  const cacheDir = options.cacheDir ?? path.join(root, "fixtures", "cache");
  const logPath = options.logPath ?? path.join(root, "eval", "logs", "drafter.log");
  const pasteCache = path.join(tmpdir(), "second-seat-paste-cache");

  function openaiKey(): string {
    return env.OPENAI_API_KEY?.trim() ?? "";
  }

  async function buildSession(input: {
    meetingId: string;
    title: string;
    owner: string;
    transcript: string;
    mode: DrafterMode;
    model: string | null;
    drafts: PaymentDraft[];
    note?: string;
    rateLimitNotice?: string | null;
  }): Promise<FindSession> {
    const checks = checkDrafts({
      transcript: input.transcript,
      owner: input.owner,
      drafts: input.drafts,
    });
    const session: FindSession = {
      id: `find_${randomUUID().slice(0, 8)}`,
      meetingId: input.meetingId,
      title: input.title,
      owner: input.owner,
      transcript: input.transcript,
      mode: input.mode,
      model: input.model,
      badge: badgeFor(input.mode),
      note: input.note ?? noteFor(input.mode),
      rateLimitNotice: input.rateLimitNotice ?? null,
      drafts: input.drafts,
      checks,
    };
    sessions.set(session.id, session);
    return session;
  }

  function sessionJson(session: FindSession): Record<string, unknown> {
    return {
      findId: session.id,
      meetingId: session.meetingId,
      title: session.title,
      owner: session.owner,
      transcript: session.transcript,
      mode: session.mode,
      model: session.model,
      badge: session.badge,
      note: session.note,
      rateLimitNotice: session.rateLimitNotice,
      paypalConfigured,
      drafts: session.drafts.map((draft, index) => {
        const check = session.checks[index];
        return presentDraft(
          draft,
          check ?? { draftId: draft.id, verdict: "Blocked", reasons: ["The checker did not return a verdict."], steps: [] },
        );
      }),
    };
  }

  async function findMeeting(meeting: SampleMeeting): Promise<FindSession> {
    if (meeting.kind === "stand-in") {
      return buildSession({
        meetingId: meeting.id,
        title: meeting.title,
        owner: meeting.owner,
        transcript: meeting.transcript,
        mode: "stand-in",
        model: null,
        drafts: demo.drafts,
        note: "These drafts were written by hand. They are not AI output.",
      });
    }
    if (meeting.handWritten === true) {
      const batch = await findDrafts(
        { fixtureId: meeting.id, transcript: meeting.transcript, owner: meeting.owner },
        {
          cwd: root,
          env,
          mode: "stand-in",
          cacheDir,
          logPath,
        },
      );
      return buildSession({
        meetingId: meeting.id,
        title: meeting.title,
        owner: meeting.owner,
        transcript: meeting.transcript,
        mode: "stand-in",
        model: null,
        drafts: batch.drafts,
        note: "These drafts were written by hand. They are not AI output.",
      });
    }
    const wantLive = openaiKey().length > 0;
    const paused = wantLive && !limiter.allow(clock());
    if (wantLive && !paused) limiter.record(clock());
    const batch = await findDrafts(
      { fixtureId: meeting.id, transcript: meeting.transcript, owner: meeting.owner },
      {
        cwd: root,
        env,
        mode: paused ? "recorded" : wantLive ? "live" : "recorded",
        cacheDir,
        logPath,
        ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
      },
    );
    const notice = paused ? recordedFallbackNotice(limiter.limit) : null;
    return buildSession({
      meetingId: meeting.id,
      title: meeting.title,
      owner: meeting.owner,
      transcript: meeting.transcript,
      mode: batch.mode,
      model: batch.model,
      drafts: batch.drafts,
      ...(notice !== null ? { note: notice, rateLimitNotice: notice } : {}),
    });
  }

  function draftIn(session: FindSession, draftId: string): { draft: PaymentDraft; check: CheckResult } | null {
    const index = session.drafts.findIndex((draft) => draft.id === draftId);
    if (index < 0) return null;
    const draft = session.drafts[index];
    const check = session.checks[index];
    if (draft === undefined || check === undefined) return null;
    return { draft, check };
  }

  function remember(payment: TrackedPayment): void {
    payments.set(payment.id, payment);
    byDraft.set(payment.draftKey, payment);
    if (payment.orderId !== null) byOrder.set(payment.orderId, payment);
  }

  async function onFind(body: unknown): Promise<{ status: number; payload: unknown }> {
    const record = asRecord(body);
    if (record === null) return { status: 400, payload: { error: "Send a meeting or a transcript." } };
    const meetingId = typeof record.meetingId === "string" ? record.meetingId.trim() : "";
    if (meetingId.length > 0) {
      if (!/^[A-Za-z0-9._-]+$/.test(meetingId)) {
        return { status: 400, payload: { error: "That meeting id is not one of the samples." } };
      }
      const meeting = meetings.get(meetingId);
      if (meeting === undefined) return { status: 404, payload: { error: "That meeting is not in the samples." } };
      const session = await findMeeting(meeting);
      return { status: 200, payload: sessionJson(session) };
    }
    const owner = typeof record.owner === "string" ? record.owner.trim() : "";
    const transcript = typeof record.transcript === "string" ? record.transcript.trim() : "";
    const title = typeof record.title === "string" && record.title.trim().length > 0 ? record.title.trim() : "Pasted transcript";
    if (owner.length === 0 || transcript.length === 0) {
      return { status: 400, payload: { error: "A pasted transcript needs the owner's name and the transcript." } };
    }
    if (owner.length > 120 || transcript.length > 20_000) {
      return { status: 400, payload: { error: "That transcript is too long to check." } };
    }
    if (openaiKey().length === 0) {
      return {
        status: 400,
        payload: {
          error:
            "Recorded AI output is only saved for the sample meetings. A pasted transcript needs OPENAI_API_KEY for a live check.",
        },
      };
    }
    if (!limiter.allow(clock())) {
      const notice = pastePausedNotice(limiter.limit);
      return { status: 429, payload: { error: notice, rateLimitNotice: notice } };
    }
    limiter.record(clock());
    const batch = await findDrafts(
      { fixtureId: `pasted-${randomUUID().slice(0, 8)}`, transcript, owner },
      {
        cwd: root,
        env,
        mode: "live",
        cacheDir: pasteCache,
        logPath,
        ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
      },
    );
    const session = await buildSession({
      meetingId: batch.fixtureId,
      title,
      owner,
      transcript,
      mode: batch.mode,
      model: batch.model,
      drafts: batch.drafts,
    });
    return { status: 200, payload: sessionJson(session) };
  }

  async function onApprove(req: IncomingMessage, body: unknown): Promise<{ status: number; payload: unknown }> {
    const found = requireDraft(body);
    if ("error" in found) return found.error;
    const { session, draft, check } = found;
    const record = asRecord(body);
    const confirmLook = record?.confirmLook === true;
    const decision = decideAdmission(check, confirmLook);
    if (!decision.admit) return { status: 400, payload: { error: decision.explanation } };
    const existing = byDraft.get(`${session.id}:${draft.id}`);
    if (existing !== undefined && existing.status === "rejected") {
      return { status: 400, payload: { error: "This draft was rejected." } };
    }
    if (existing !== undefined && existing.checkoutUrl !== null && existing.status !== "cancelled") {
      return {
        status: 200,
        payload: { ok: true, checkoutUrl: existing.checkoutUrl, paymentId: existing.id, orderId: existing.orderId },
      };
    }
    if (gate === null) return { status: 409, payload: { error: NOT_CONFIGURED } };

    const base = publicBase(req);
    checkoutUrls.returnUrl = `${base}/paypal/return`;
    checkoutUrls.cancelUrl = `${base}/paypal/cancel`;
    const admitted = await admitDraftToGate({
      gate,
      meetingId: session.meetingId,
      draft,
      check,
      ownerConfirmedLook: confirmLook,
      actor: "second-seat",
    });
    if (!admitted.admitted) return { status: 400, payload: { error: admitted.explanation } };
    const approved = await gate.approve(admitted.record.id, "owner");
    const tracked: TrackedPayment = {
      id: approved.id,
      draftKey: `${session.id}:${draft.id}`,
      draft,
      quotes: receiptQuotes(draft, check),
      orderId: approved.paypalOrderId,
      captureId: null,
      captureStatus: null,
      amount: approved.amount,
      currency: approved.currency,
      payee: approved.payee,
      purpose: draft.purpose,
      status: "approved",
      checkoutUrl: approved.checkoutUrl,
      paypalStatus: null,
      audit: [],
    };
    recordAudit(tracked, "approve", "Approved by the owner.");
    recordLedger(tracked, "approve", null);
    remember(tracked);
    if (approved.checkoutUrl === null) {
      return { status: 502, payload: { error: "PayPal sandbox did not return a checkout link." } };
    }
    return {
      status: 200,
      payload: { ok: true, checkoutUrl: approved.checkoutUrl, paymentId: approved.id, orderId: approved.paypalOrderId },
    };
  }

  async function onReject(body: unknown): Promise<{ status: number; payload: unknown }> {
    const found = requireDraft(body);
    if ("error" in found) return found.error;
    const { session, draft, check } = found;
    const key = `${session.id}:${draft.id}`;
    const existing = byDraft.get(key);
    if (existing !== undefined && existing.status === "captured") {
      return { status: 400, payload: { error: "This payment was already captured." } };
    }
    if (existing !== undefined && existing.orderId !== null && existing.status === "approved" && gate !== null) {
      const rejected = await gate.reject(existing.id, "owner", "Rejected from the payments page");
      existing.status = "rejected";
      recordAudit(existing, "reject", "Rejected by the owner. The PayPal order was abandoned.");
      recordLedger(existing, "reject", null);
      return {
        status: 200,
        payload: {
          ok: true,
          status: "rejected",
          paymentId: rejected.id,
          orderId: rejected.paypalOrderId,
          message: "Rejected. The PayPal sandbox order was abandoned and will not be captured.",
        },
      };
    }
    if (check.verdict === "Blocked") {
      return { status: 400, payload: { error: "Blocked drafts are not sent to PayPal, so there is nothing to reject." } };
    }
    const local: TrackedPayment = {
      id: `local_${randomUUID().slice(0, 8)}`,
      draftKey: key,
      draft,
      quotes: receiptQuotes(draft, check),
      orderId: null,
      captureId: null,
      captureStatus: null,
      amount: draft.amount,
      currency: draft.currency,
      payee: draft.payee,
      purpose: draft.purpose,
      status: "rejected",
      checkoutUrl: null,
      paypalStatus: null,
      audit: [],
    };
    recordAudit(local, "reject", "Rejected by the owner. No PayPal order was created.");
    recordLedger(local, "reject", null);
    remember(local);
    return {
      status: 200,
      payload: {
        ok: true,
        status: "rejected",
        paymentId: local.id,
        orderId: null,
        message: "Rejected. No PayPal order was created.",
      },
    };
  }

  function requireDraft(body: unknown):
    | { session: FindSession; draft: PaymentDraft; check: CheckResult }
    | { error: { status: number; payload: unknown } } {
    const record = asRecord(body);
    const findId = typeof record?.findId === "string" ? record.findId : "";
    const draftId = typeof record?.draftId === "string" ? record.draftId : "";
    const session = sessions.get(findId);
    if (session === undefined) return { error: { status: 404, payload: { error: "Find the payments again, then approve." } } };
    const pair = draftIn(session, draftId);
    if (pair === null) return { error: { status: 404, payload: { error: "That draft is not in this result." } } };
    return { session, draft: pair.draft, check: pair.check };
  }

  function sandboxConfig(): PayPalSandboxConfig | null {
    if (sandbox === null) return null;
    return {
      clientId: sandbox.clientId,
      clientSecret: sandbox.clientSecret,
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    };
  }

  async function captureTracked(orderId: string): Promise<CapturedPayPalOrder> {
    if (options.captureOrder !== undefined) return options.captureOrder(orderId);
    const config = sandboxConfig();
    if (config === null) throw new Error(NOT_CONFIGURED);
    return capturePayPalSandboxOrder(config, orderId);
  }

  async function lookupOrder(orderId: string): Promise<PayPalOrderSnapshot> {
    if (options.getOrder !== undefined) return options.getOrder(orderId);
    const config = sandboxConfig();
    if (config === null) throw new Error(NOT_CONFIGURED);
    return fetchPayPalSandboxOrder(config, orderId);
  }

  function statusText(payment: TrackedPayment): string {
    if (payment.status === "captured") return "Captured";
    if (payment.status === "rejected") return "Rejected";
    if (payment.status === "cancelled") return "Cancelled on PayPal. No money was captured.";
    if (payment.paypalStatus !== null && !verifiedCaptured(payment.paypalStatus)) {
      return `Not captured. PayPal reported ${payment.paypalStatus}.`;
    }
    return "Approved, waiting for PayPal";
  }

  function auditLabel(event: AuditEvent): string {
    if (event.action === "approve") return "Approved by the owner.";
    if (event.action === "reject") return "Rejected by the owner.";
    return "Captured after PayPal reported the order complete.";
  }

  function receiptHtml(payment: TrackedPayment): string {
    const quotes = payment.quotes.map((quote) => `<blockquote>${escapeHtml(quote)}</blockquote>`).join("");
    const audit =
      payment.audit.length === 0
        ? "<p>No decision has been recorded.</p>"
        : `<ol class="audit">${payment.audit
            .map(
              (event) =>
                `<li><time datetime="${escapeHtml(event.at)}">${escapeHtml(event.at)}</time> ${escapeHtml(auditLabel(event))}</li>`,
            )
            .join("")}</ol>`;
    return page(
      "Receipt",
      `<article class="receipt">
        <dl>
          <dt>Status</dt><dd class="status-value">${escapeHtml(statusText(payment))}</dd>
          <dt>Payee</dt><dd>${escapeHtml(payment.payee)}</dd>
          <dt>Amount</dt><dd>${escapeHtml(payment.amount)} ${escapeHtml(payment.currency)}</dd>
          <dt>What for</dt><dd>${escapeHtml(payment.purpose || "Not stated")}</dd>
          <dt>PayPal order</dt><dd>${escapeHtml(payment.orderId ?? "None")}</dd>
          <dt>PayPal status</dt><dd>${escapeHtml(payment.paypalStatus ?? "Not fetched")}</dd>
          <dt>PayPal capture</dt><dd>${escapeHtml(payment.captureId ?? "Not captured")}</dd>
        </dl>
        <h2>Decision log</h2>
        ${audit}
        <h2>From the transcript</h2>
        ${quotes || "<p>No quote was stored.</p>"}
        <p><a href="/">Back to payments</a></p>
      </article>`,
    );
  }

  function sessionReceipts(): Array<Record<string, unknown>> {
    return [...payments.values()]
      .filter((payment) => payment.status === "captured")
      .map((payment) => ({
        id: payment.id,
        payee: payment.payee,
        amount: payment.amount,
        currency: payment.currency,
        purpose: payment.purpose,
        orderId: payment.orderId,
        captureId: payment.captureId,
        capturedAt: payment.audit.find((event) => event.action === "capture")?.at ?? null,
      }));
  }

  function proofPayload(): Record<string, unknown> {
    const logText = existsSync(logPath) ? redact(readFileSync(logPath, "utf8")) : "";
    return {
      targets: EVAL_TARGETS,
      log: summarizeModelLog(logText),
      receipts: sessionReceipts(),
      ledger,
      liveAiHourlyLimit: limiter.limit,
      liveAiCallsThisHour: limiter.used(clock()),
      liveAiPaused: livePaused(),
    };
  }

  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      const message = redact(error instanceof Error ? error.message : "Something went wrong.");
      console.error(message);
      if (!res.headersSent) sendJson(res, 500, { error: message });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const method = req.method ?? "GET";

    if (method === "GET" && url.pathname === "/healthz") {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      sendHtml(res, 200, readFileSync(path.join(publicDir, "index.html"), "utf8"));
      return;
    }
    if (method === "GET" && url.pathname === "/proof") {
      sendHtml(res, 200, readFileSync(path.join(publicDir, "proof.html"), "utf8"));
      return;
    }
    if (method === "GET" && (url.pathname === "/styles.css" || url.pathname === "/app.js" || url.pathname === "/proof.js")) {
      const file = path.join(publicDir, url.pathname.slice(1));
      const type = url.pathname.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8";
      res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      res.end(readFileSync(file));
      return;
    }
    if (method === "GET" && url.pathname === "/api/meetings") {
      const paused = livePaused();
      sendJson(res, 200, {
        paypalConfigured,
        drafter: paused ? "recorded" : openaiKey().length > 0 ? "live" : "recorded",
        drafterBadge: paused ? "Recorded AI output" : openaiKey().length > 0 ? "Live AI" : "Recorded AI output",
        liveAiHourlyLimit: limiter.limit,
        liveAiCallsThisHour: limiter.used(clock()),
        liveAiPaused: paused,
        rateLimitNotice: paused ? recordedFallbackNotice(limiter.limit) : null,
        samples,
        standIn,
      });
      return;
    }
    if (method === "GET" && url.pathname === "/api/proof") {
      sendJson(res, 200, proofPayload());
      return;
    }
    if (method === "POST" && url.pathname === "/api/proof/ledger/verify") {
      sendJson(res, 200, verifyLedger(ledger));
      return;
    }
    if (method === "POST" && url.pathname === "/api/proof/eval") {
      const result = await runRecordedEval(root);
      sendJson(res, 200, {
        label: "Recorded replay of the live gpt-4o-mini run. This run did not call OpenAI.",
        mode: result.mode,
        model: result.model,
        meetingCount: result.meetingCount,
        targets: EVAL_TARGETS,
        targetsMet: recordedTargetsMet(result.report),
        report: result.report,
      });
      return;
    }
    if (method === "POST" && url.pathname === "/api/find") {
      const result = await onFind(await readJson(req));
      sendJson(res, result.status, result.payload);
      return;
    }
    if (method === "POST" && url.pathname === "/api/approve") {
      const result = await onApprove(req, await readJson(req));
      sendJson(res, result.status, result.payload);
      return;
    }
    if (method === "POST" && url.pathname === "/api/reject") {
      const result = await onReject(await readJson(req));
      sendJson(res, result.status, result.payload);
      return;
    }
    if (method === "GET" && url.pathname === "/paypal/return") {
      const orderId = url.searchParams.get("token") ?? url.searchParams.get("orderId") ?? "";
      const payment = byOrder.get(orderId);
      if (payment === undefined) {
        sendHtml(res, 404, page("Receipt", "<p>That PayPal order is not one this server created.</p>"));
        return;
      }
      if (payment.status !== "captured") {
        try {
          let snapshot = await lookupOrder(orderId);
          const step = nextCaptureStep(snapshot.status);
          if (step === "capture") {
            await captureTracked(orderId);
            snapshot = await lookupOrder(orderId);
          }
          payment.paypalStatus = snapshot.status;
          if (verifiedCaptured(snapshot.status)) {
            payment.status = "captured";
            payment.captureId = snapshot.captureId;
            payment.captureStatus = snapshot.status;
            if (snapshot.amount.length > 0) payment.amount = snapshot.amount;
            if (snapshot.currency.length > 0) payment.currency = snapshot.currency;
            if (!payment.audit.some((event) => event.action === "capture")) {
              recordAudit(payment, "capture", "PayPal reported the order complete.");
              recordLedger(payment, "capture", payment.captureId);
            }
          }
        } catch (error) {
          const message = redact(error instanceof Error ? error.message : "PayPal could not be checked.");
          console.error(message);
          sendHtml(
            res,
            502,
            page(
              "Receipt",
              `<article class="receipt"><p>PayPal could not be checked, so this payment is not marked captured.</p><p><a href="/">Back to payments</a></p></article>`,
            ),
          );
          return;
        }
      }
      res.writeHead(303, { location: `${publicBase(req)}/receipt/${payment.id}` });
      res.end();
      return;
    }
    if (method === "GET" && url.pathname === "/paypal/cancel") {
      const orderId = url.searchParams.get("token") ?? "";
      const payment = byOrder.get(orderId);
      if (payment !== undefined && payment.status === "approved") payment.status = "cancelled";
      sendHtml(
        res,
        200,
        page(
          "Checkout cancelled",
          `<article class="receipt"><p>PayPal checkout was cancelled. No money was captured.</p><p><a href="/">Back to payments</a></p></article>`,
        ),
      );
      return;
    }
    if (method === "GET" && url.pathname.startsWith("/receipt/")) {
      const id = decodeURIComponent(url.pathname.slice("/receipt/".length));
      const payment = payments.get(id);
      if (payment === undefined) {
        sendHtml(res, 404, page("Receipt", "<p>That receipt is not on this server.</p>"));
        return;
      }
      sendHtml(res, 200, receiptHtml(payment));
      return;
    }
    sendHtml(res, 404, page("Not found", "<p>That page is not part of the payments demo.</p>"));
  }

  await new Promise<void>((resolve) => {
    server.listen(options.port ?? 0, "0.0.0.0", () => resolve());
  });
  const address = server.address();
  const listenPort = typeof address === "object" && address !== null ? address.port : 0;
  return {
    port: listenPort,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function sandboxFromEnv(env: Record<string, string | undefined>): PayPalSandboxConfig | null {
  const mode = (env.PAYPAL_MODE ?? "").trim().toLowerCase();
  const clientId = env.PAYPAL_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.PAYPAL_CLIENT_SECRET?.trim() ?? "";
  if (mode !== "sandbox" || clientId.length === 0 || clientSecret.length === 0) return null;
  return { clientId, clientSecret };
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  const fromEnv = Number(process.env.PORT);
  const port = Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : 3000;
  const running = await startServer({ port });
  console.log(`Payments page listening on http://0.0.0.0:${running.port}`);
  process.on("SIGTERM", () => {
    void running.close().finally(() => process.exit(0));
  });
}
