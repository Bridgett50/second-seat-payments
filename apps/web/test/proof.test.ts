import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EVAL_TARGETS } from "@second-seat/core";
import { LIVE_UNAVAILABLE_NOTE, NO_SAVED_DRAFTS_NOTE, PASTE_UNAVAILABLE_NOTE } from "../src/rateLimit.js";
import { SAMPLE_RECEIPT_LABEL, sampleReceiptViews, seedSampleLedger } from "../src/sampleLedger.js";
import { startServer, type ServerOptions } from "../src/server.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const OPENAI_KEY = "sk-test-DO-NOT-LEAK";
const PAYPAL_SECRET = "sandbox-secret-DO-NOT-LEAK";

async function withServer(options: ServerOptions, run: (port: number) => Promise<void>): Promise<void> {
  const running = await startServer({ env: {}, ...options });
  try {
    await run(running.port);
  } finally {
    await running.close();
  }
}

async function request(port: number, pathname: string, init?: RequestInit): Promise<{ status: number; text: string; json: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, init);
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { status: response.status, text, json };
}

describe("proof page", () => {
  it("serves the page, the health check, and targets from code", async () => {
    await withServer({}, async (port) => {
      const health = await request(port, "/healthz");
      expect(health.status).toBe(200);
      expect(health.json.ok).toBe(true);
      const page = await request(port, "/proof");
      expect(page.status).toBe(200);
      expect(page.text).toContain("PayPal Sandbox. No real money moves.");
      expect(page.text).toContain("Run the eval again");
      expect(page.text).toContain("Verify chain");
      expect(page.text).not.toContain("16/16");
      const proof = await request(port, "/api/proof");
      expect(proof.status).toBe(200);
      expect(proof.json.targets).toEqual(EVAL_TARGETS);
      expect(proof.text).not.toContain(OPENAI_KEY);
      const log = proof.json.log as { calls: number };
      expect(log.calls).toBe(0);
      const verify = await request(port, "/api/proof/ledger/verify", { method: "POST" });
      expect(verify.json.ok).toBe(true);
      expect(verify.json.checked).toBe(seedSampleLedger().length);
      expect(page.text).not.toContain("scheduled ping keeps this demo awake");
      expect(page.text).toContain("example data");
    });
  });

  it("runs the recorded eval and keeps bad payments off the gate", async () => {
    await withServer({}, async (port) => {
      const evalRun = await request(port, "/api/proof/eval", { method: "POST" });
      expect(evalRun.status).toBe(200);
      expect(evalRun.json.mode).toBe("recorded");
      expect(evalRun.text).toContain("did not call OpenAI");
      const report = evalRun.json.report as {
        checkerBad: number;
        checkerCorrect: number;
        correctTotal: number;
        meetings: unknown[];
        trapsThrough: number;
      };
      expect(report.checkerBad).toBe(EVAL_TARGETS.badPaymentsReachingApproval);
      expect(report.trapsThrough).toBe(EVAL_TARGETS.trapsReachingApproval);
      expect(report.checkerCorrect).toBe(report.correctTotal);
      expect(report.correctTotal).toBe(16);
      expect(report.meetings).toHaveLength(15);
      expect(evalRun.json.targetsMet).toBe(true);
    });
  });

  it("summarizes the model log without echoing a secret", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "second-seat-log-"));
    const logPath = path.join(dir, "drafter.log");
    writeFileSync(
      logPath,
      [
        JSON.stringify({
          at: "2026-11-10T00:00:00.000Z",
          model: "gpt-4o-mini-2024-07-18",
          promptTokens: 10,
          completionTokens: 4,
          totalTokens: 14,
          fixtureId: "01",
          status: 200,
          note: OPENAI_KEY,
        }),
        JSON.stringify({
          at: "2026-11-10T00:00:01.000Z",
          model: "gpt-4o-mini-2024-07-18",
          promptTokens: 3,
          completionTokens: 1,
          totalTokens: 4,
          fixtureId: "02",
          status: 500,
        }),
        "not json",
        "",
      ].join("\n"),
      "utf8",
    );
    await withServer({ env: { OPENAI_API_KEY: OPENAI_KEY }, logPath }, async (port) => {
      const proof = await request(port, "/api/proof");
      const log = proof.json.log as {
        calls: number;
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        failedCalls: number;
        models: string[];
        skippedLines: number;
      };
      expect(log.calls).toBe(2);
      expect(log.promptTokens).toBe(13);
      expect(log.completionTokens).toBe(5);
      expect(log.totalTokens).toBe(18);
      expect(log.failedCalls).toBe(1);
      expect(log.models).toEqual(["gpt-4o-mini-2024-07-18"]);
      expect(log.skippedLines).toBe(1);
      expect(proof.text).not.toContain(OPENAI_KEY);
    });
  });

  it("writes approve and capture into the ledger and the chain still verifies", async () => {
    let lookups = 0;
    const fetchImpl: typeof fetch = (url, init) => {
      const href = String(url);
      const method = (init?.method ?? "GET").toUpperCase();
      if (href.endsWith("/v1/oauth2/token")) {
        return Promise.resolve(new Response(JSON.stringify({ access_token: "TEST-TOKEN" }), { status: 200 }));
      }
      if (method === "POST" && href.endsWith("/v2/checkout/orders")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "ORDER-LEDGER",
              links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-LEDGER" }],
            }),
            { status: 200 },
          ),
        );
      }
      if (method === "GET" && href.includes("/v2/checkout/orders/")) {
        lookups += 1;
        const completed = lookups > 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "ORDER-LEDGER",
              status: completed ? "COMPLETED" : "APPROVED",
              purchase_units: [
                {
                  payments: completed
                    ? { captures: [{ id: "CAP-LEDGER", status: "COMPLETED", amount: { currency_code: "USD", value: "480.00" } }] }
                    : {},
                },
              ],
            }),
            { status: 200 },
          ),
        );
      }
      if (method === "POST" && href.endsWith("/capture")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "COMPLETED",
              purchase_units: [
                { payments: { captures: [{ id: "FROM-CAPTURE", status: "COMPLETED", amount: { currency_code: "USD", value: "480.00" } }] } },
              ],
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.reject(new Error(`unexpected ${method} ${href}`));
    };
    await withServer(
      {
        env: { PAYPAL_MODE: "sandbox", PAYPAL_CLIENT_ID: "client", PAYPAL_CLIENT_SECRET: PAYPAL_SECRET },
        fetchImpl,
      },
      async (port) => {
        const found = await request(port, "/api/find", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ meetingId: "01-harbor-menus" }),
        });
        const drafts = found.json.drafts as Array<{ id: string; steps: Array<{ rule: string; passed: boolean }> }>;
        expect(drafts[0]?.steps.some((step) => step.passed && step.rule.includes("word for word"))).toBe(true);
        const approved = await request(port, "/api/approve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ findId: found.json.findId, draftId: drafts[0]?.id }),
        });
        expect(approved.status).toBe(200);
        await request(port, "/paypal/return?token=ORDER-LEDGER");
        const proof = await request(port, "/api/proof");
        const ledger = proof.json.ledger as Array<{
          sample?: boolean;
          decision: string;
          hash: string;
          previousHash: string;
          quotes: string[];
          paypalOrderId: string | null;
          label?: string;
        }>;
        const seeded = ledger.filter((entry) => entry.sample === true);
        const live = ledger.filter((entry) => entry.sample !== true);
        expect(seeded.map((entry) => entry.decision)).toEqual(["approve", "reject", "needs-a-look"]);
        expect(live.map((entry) => entry.decision)).toEqual(["approve", "capture"]);
        expect(live[0]?.previousHash).toBe(seeded[seeded.length - 1]?.hash);
        expect(live[1]?.previousHash).toBe(live[0]?.hash);
        expect(live[0]?.quotes.join(" ")).toContain("I'll pay Harbor Print $480");
        expect(seeded.every((entry) => entry.label === SAMPLE_RECEIPT_LABEL)).toBe(true);
        expect(seeded.every((entry) => entry.paypalOrderId === null)).toBe(true);
        expect(proof.text).not.toContain(PAYPAL_SECRET);
        const verify = await request(port, "/api/proof/ledger/verify", { method: "POST" });
        expect(verify.json).toEqual({ ok: true, checked: ledger.length, brokenAt: null });
        const receipts = proof.json.receipts as Array<{ sample?: boolean; orderId?: string | null }>;
        expect(receipts.filter((receipt) => receipt.sample === true)).toHaveLength(sampleReceiptViews().length);
        const liveReceipts = receipts.filter((receipt) => receipt.sample !== true);
        expect(liveReceipts).toHaveLength(1);
        expect(liveReceipts[0]?.orderId).toBe("ORDER-LEDGER");
        expect(receipts.findIndex((receipt) => receipt.sample !== true)).toBe(sampleReceiptViews().length);
      },
    );
  });
});

describe("live call cap and PayPal status", () => {
  it("falls back to recorded output when the hourly cap is already spent", async () => {
    let called = false;
    await withServer(
      {
        env: { OPENAI_API_KEY: OPENAI_KEY, LIVE_AI_HOURLY_LIMIT: "0" },
        fetchImpl: () => {
          called = true;
          return Promise.reject(new Error("live call should not run"));
        },
      },
      async (port) => {
        const meetings = await request(port, "/api/meetings");
        expect(meetings.json.liveAiPaused).toBe(true);
        const found = await request(port, "/api/find", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ meetingId: "01-harbor-menus" }),
        });
        expect(found.status).toBe(200);
        expect(found.json.mode).toBe("recorded");
        expect(String(found.json.rateLimitNotice)).toMatch(/paused after 0 calls/);
        expect(found.text).not.toContain(OPENAI_KEY);
        const pasted = await request(port, "/api/find", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ owner: "Maya Chen", transcript: "Maya Chen (owner): I'll pay Harbor Print $10." }),
        });
        expect(pasted.status).toBe(429);
        expect(String(pasted.json.error)).toMatch(/paused/);
        expect(called).toBe(false);
      },
    );
  });

  it("does not mark a payment captured unless PayPal's fetched status is completed", async () => {
    const fetchImpl: typeof fetch = (url, init) => {
      const href = String(url);
      const method = (init?.method ?? "GET").toUpperCase();
      if (href.endsWith("/v1/oauth2/token")) {
        return Promise.resolve(new Response(JSON.stringify({ access_token: "TEST-TOKEN" }), { status: 200 }));
      }
      if (method === "POST" && href.endsWith("/v2/checkout/orders")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "ORDER-OPEN",
              links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-OPEN" }],
            }),
            { status: 200 },
          ),
        );
      }
      if (method === "GET" && href.includes("/v2/checkout/orders/")) {
        return Promise.resolve(new Response(JSON.stringify({ id: "ORDER-OPEN", status: "CREATED" }), { status: 200 }));
      }
      if (href.endsWith("/capture")) {
        return Promise.reject(new Error("capture should not run"));
      }
      return Promise.reject(new Error(`unexpected ${method} ${href}`));
    };
    await withServer(
      { env: { PAYPAL_MODE: "sandbox", PAYPAL_CLIENT_ID: "client", PAYPAL_CLIENT_SECRET: PAYPAL_SECRET }, fetchImpl },
      async (port) => {
        const found = await request(port, "/api/find", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ meetingId: "01-harbor-menus" }),
        });
        const drafts = found.json.drafts as Array<{ id: string }>;
        await request(port, "/api/approve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ findId: found.json.findId, draftId: drafts[0]?.id }),
        });
        const receipt = await request(port, "/paypal/return?token=ORDER-OPEN");
        expect(receipt.status).toBe(200);
        expect(receipt.text).toContain("Not captured. PayPal reported CREATED.");
        expect(receipt.text).not.toContain('class="status-value">Captured');
        expect(receipt.text).not.toContain(PAYPAL_SECRET);
      },
    );
  });

  it("ignores a capture response when the follow-up order lookup is not completed", async () => {
    let lookups = 0;
    const fetchImpl: typeof fetch = (url, init) => {
      const href = String(url);
      const method = (init?.method ?? "GET").toUpperCase();
      if (href.endsWith("/v1/oauth2/token")) {
        return Promise.resolve(new Response(JSON.stringify({ access_token: "TEST-TOKEN" }), { status: 200 }));
      }
      if (method === "POST" && href.endsWith("/v2/checkout/orders")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "ORDER-STUCK",
              links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-STUCK" }],
            }),
            { status: 200 },
          ),
        );
      }
      if (method === "GET" && href.includes("/v2/checkout/orders/")) {
        lookups += 1;
        return Promise.resolve(
          new Response(JSON.stringify({ id: "ORDER-STUCK", status: "APPROVED" }), { status: 200 }),
        );
      }
      if (method === "POST" && href.endsWith("/capture")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "COMPLETED",
              purchase_units: [{ payments: { captures: [{ id: "CAP-IGNORED", status: "COMPLETED", amount: { currency_code: "USD", value: "480.00" } }] } }],
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.reject(new Error(`unexpected ${method} ${href}`));
    };
    await withServer(
      { env: { PAYPAL_MODE: "sandbox", PAYPAL_CLIENT_ID: "client", PAYPAL_CLIENT_SECRET: PAYPAL_SECRET }, fetchImpl },
      async (port) => {
        const found = await request(port, "/api/find", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ meetingId: "01-harbor-menus" }),
        });
        const drafts = found.json.drafts as Array<{ id: string }>;
        await request(port, "/api/approve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ findId: found.json.findId, draftId: drafts[0]?.id }),
        });
        const receipt = await request(port, "/paypal/return?token=ORDER-STUCK");
        expect(lookups).toBeGreaterThanOrEqual(2);
        expect(receipt.text).toContain("Not captured. PayPal reported APPROVED.");
        expect(receipt.text).not.toContain('class="status-value">Captured');
        expect(receipt.text).not.toContain("CAP-IGNORED");
      },
    );
  });
});

describe("sample receipts", () => {
  it("loads labeled examples and keeps the chain verifiable", async () => {
    await withServer({}, async (port) => {
      const proof = await request(port, "/api/proof");
      const ledger = proof.json.ledger as Array<{
        sample?: boolean;
        decision: string;
        label?: string;
        paypalOrderId: string | null;
        paypalCaptureId: string | null;
        outcome?: string;
      }>;
      expect(ledger.map((entry) => entry.decision)).toEqual(["approve", "reject", "needs-a-look"]);
      expect(ledger.every((entry) => entry.sample === true)).toBe(true);
      expect(ledger.every((entry) => entry.label === SAMPLE_RECEIPT_LABEL)).toBe(true);
      expect(ledger.every((entry) => entry.paypalOrderId === null && entry.paypalCaptureId === null)).toBe(true);
      expect(JSON.stringify(ledger)).not.toMatch(/\b[A-Z0-9]{17}\b/);
      const verify = await request(port, "/api/proof/ledger/verify", { method: "POST" });
      expect(verify.json).toEqual({ ok: true, checked: ledger.length, brokenAt: null });
      const receipts = proof.json.receipts as Array<{ id: string; sample?: boolean; outcome?: string; orderId: string | null }>;
      expect(receipts.map((receipt) => receipt.outcome)).toEqual(["Approve", "Reject", "Needs a look"]);
      expect(receipts.every((receipt) => receipt.sample === true && receipt.orderId === null)).toBe(true);
      const page = await request(port, "/receipt/sample-needs-a-look");
      expect(page.status).toBe(200);
      expect(page.text).toContain(SAMPLE_RECEIPT_LABEL);
      expect(page.text).toContain("This is not a live payment");
      expect(page.text).toContain("Needs a look");
      expect(page.text).toContain("None. This is example data.");
      expect(page.text).not.toMatch(/\b[A-Z0-9]{17}\b/);
      const script = await request(port, "/proof.js");
      expect(script.text).toContain("Example only");
      expect(script.text).toContain("not a live payment");
    });
  });
});

describe("live AI failures", () => {
  it("falls back to saved drafts, does not count the failure, and returns 503 for a paste", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "second-seat-fallback-"));
    const cacheDir = path.join(dir, "cache");
    mkdirSync(cacheDir);
    copyFileSync(path.join(repoRoot, "fixtures", "cache", "01-harbor-menus.json"), path.join(cacheDir, "01-harbor-menus.json"));
    const logPath = path.join(dir, "drafter.log");
    const steps = ["timeout", "401", "500", "429", "ok"] as const;
    let calls = 0;
    const fetchImpl: typeof fetch = () => {
      const step = steps[calls];
      calls += 1;
      if (step === "timeout") return Promise.reject(new Error(`The operation was aborted due to timeout ${OPENAI_KEY}`));
      if (step === "401") return Promise.resolve(new Response(`invalid ${OPENAI_KEY}`, { status: 401 }));
      if (step === "500") return Promise.resolve(new Response("upstream failed", { status: 500 }));
      if (step === "429") return Promise.resolve(new Response("rate limited", { status: 429 }));
      if (step === "ok") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              model: "gpt-4o-mini-2024-07-18",
              usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      payments: [
                        {
                          payee: "Live Payee",
                          amount: "1.00",
                          currency: "USD",
                          purpose: "Live check",
                          due: "",
                          quotes: ["I'll pay Harbor Print $480 on Friday for the spring menus."],
                        },
                      ],
                    }),
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.reject(new Error("live call should not run"));
    };
    await withServer(
      { env: { OPENAI_API_KEY: OPENAI_KEY, LIVE_AI_HOURLY_LIMIT: "1" }, fetchImpl, cacheDir, logPath },
      async (port) => {
        const aside = await request(port, "/api/find", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ meetingId: "16-injection-aside" }),
        });
        expect(aside.status).toBe(200);
        expect(aside.json.mode).toBe("stand-in");
        expect(calls).toBe(0);

        const timedOut = await request(port, "/api/find", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ meetingId: "01-harbor-menus" }),
        });
        expect(timedOut.status).toBe(200);
        expect(timedOut.json.mode).toBe("recorded");
        expect(timedOut.json.liveFallback).toBe(true);
        expect(timedOut.json.note).toBe(LIVE_UNAVAILABLE_NOTE);
        const saved = timedOut.json.drafts as Array<{ payee: string; amount: string }>;
        expect(saved[0]?.payee).toBe("Harbor Print");
        expect(saved[0]?.amount).toBe("480.00");
        expect(timedOut.text).not.toContain(OPENAI_KEY);

        const unauthorized = await request(port, "/api/find", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ meetingId: "01-harbor-menus" }),
        });
        expect(unauthorized.status).toBe(200);
        expect(unauthorized.json.note).toBe(LIVE_UNAVAILABLE_NOTE);
        expect(unauthorized.text).not.toContain(OPENAI_KEY);

        const pasteBody = {
          owner: "Maya Chen",
          transcript: "Maya Chen (owner): I'll pay Harbor Print $10 tomorrow.",
        };
        const serverError = await request(port, "/api/find", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(pasteBody),
        });
        expect(serverError.status).toBe(503);
        expect(serverError.json.error).toBe(PASTE_UNAVAILABLE_NOTE);
        expect(serverError.text).not.toContain("HTTP 500");
        expect(serverError.text).not.toContain(OPENAI_KEY);

        const rateLimited = await request(port, "/api/find", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(pasteBody),
        });
        expect(rateLimited.status).toBe(503);
        expect(rateLimited.json.error).toBe(PASTE_UNAVAILABLE_NOTE);
        expect(String(rateLimited.json.error)).not.toMatch(/paused after/);

        const beforeSuccess = await request(port, "/api/meetings");
        expect(beforeSuccess.json.liveAiCallsThisHour).toBe(0);
        expect(beforeSuccess.json.liveAiPaused).toBe(false);

        const live = await request(port, "/api/find", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ meetingId: "01-harbor-menus" }),
        });
        expect(live.status).toBe(200);
        expect(live.json.mode).toBe("live");
        expect(live.json.liveFallback).toBe(false);
        const liveDrafts = live.json.drafts as Array<{ payee: string }>;
        expect(liveDrafts[0]?.payee).toBe("Live Payee");

        const afterSuccess = await request(port, "/api/meetings");
        expect(afterSuccess.json.liveAiCallsThisHour).toBe(1);
        expect(afterSuccess.json.liveAiPaused).toBe(true);

        const capped = await request(port, "/api/find", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ meetingId: "01-harbor-menus" }),
        });
        expect(capped.status).toBe(200);
        expect(capped.json.mode).toBe("recorded");
        expect(String(capped.json.rateLimitNotice)).toMatch(/paused after 1 calls/);
        expect(calls).toBe(steps.length);
        expect(capped.text).not.toContain(OPENAI_KEY);

        const app = await request(port, "/app.js");
        expect(app.text).toContain("liveFallback");
        expect(app.text).toContain("fallback-note");
      },
    );
    const log = readFileSync(logPath, "utf8");
    expect(log).toContain("timeout");
    expect(log).toContain("HTTP 401");
    expect(log).toContain("HTTP 500");
    expect(log).toContain("HTTP 429");
    expect(log).toContain("[redacted]");
    expect(log).not.toContain(OPENAI_KEY);
  });

  it("returns 503 instead of 500 when a sample has no saved drafts", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "second-seat-empty-cache-"));
    const logPath = path.join(dir, "drafter.log");
    const fetchImpl: typeof fetch = () => Promise.resolve(new Response(`nope ${OPENAI_KEY}`, { status: 401 }));
    await withServer(
      {
        env: { OPENAI_API_KEY: OPENAI_KEY, LIVE_AI_HOURLY_LIMIT: "5" },
        fetchImpl,
        cacheDir: path.join(dir, "cache"),
        logPath,
      },
      async (port) => {
        const found = await request(port, "/api/find", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ meetingId: "01-harbor-menus" }),
        });
        expect(found.status).toBe(503);
        expect(found.json.error).toBe(NO_SAVED_DRAFTS_NOTE);
        expect(found.text).not.toContain(OPENAI_KEY);
        expect(found.text).not.toContain("HTTP 401");
        const again = await request(port, "/api/find", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ meetingId: "01-harbor-menus" }),
        });
        expect(again.status).toBe(503);
        const meetings = await request(port, "/api/meetings");
        expect(meetings.json.liveAiCallsThisHour).toBe(0);
        expect(meetings.json.liveAiPaused).toBe(false);
      },
    );
    const log = readFileSync(logPath, "utf8");
    expect(log).toContain("HTTP 401");
    expect(log).toContain("[redacted]");
    expect(log).not.toContain(OPENAI_KEY);
  });
});
