import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EVAL_TARGETS } from "@second-seat/core";
import { startServer, type ServerOptions } from "../src/server.js";

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
      expect(page.text).toContain("Run the recorded eval");
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
      expect(verify.json.checked).toBe(0);
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
        const ledger = proof.json.ledger as Array<{ decision: string; hash: string; previousHash: string; quotes: string[] }>;
        expect(ledger.map((entry) => entry.decision)).toEqual(["approve", "capture"]);
        expect(ledger[1]?.previousHash).toBe(ledger[0]?.hash);
        expect(ledger[0]?.quotes.join(" ")).toContain("I'll pay Harbor Print $480");
        expect(proof.text).not.toContain(PAYPAL_SECRET);
        const verify = await request(port, "/api/proof/ledger/verify", { method: "POST" });
        expect(verify.json).toEqual({ ok: true, checked: 2, brokenAt: null });
        const receipts = proof.json.receipts as unknown[];
        expect(receipts).toHaveLength(1);
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
