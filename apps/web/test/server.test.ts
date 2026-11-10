import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PayPalPort } from "@second-seat/core";
import { startServer, type ServerOptions } from "../src/server.js";

const PAYPAL_SECRET = "sandbox-secret-DO-NOT-LEAK";
const PAYPAL_CLIENT = "sandbox-client-DO-NOT-LEAK";
const OPENAI_KEY = "sk-test-DO-NOT-LEAK";

interface Json {
  [key: string]: unknown;
}

async function withServer(
  options: ServerOptions,
  run: (port: number) => Promise<void>,
): Promise<void> {
  const running = await startServer({ env: {}, ...options });
  try {
    await run(running.port);
  } finally {
    await running.close();
  }
}

async function request(port: number, pathname: string, init?: RequestInit): Promise<{ status: number; text: string; json: Json }> {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, init);
  const text = await response.text();
  let json: Json = {};
  try {
    json = JSON.parse(text) as Json;
  } catch {
    json = {};
  }
  return { status: response.status, text, json };
}

function post(port: number, pathname: string, body: unknown): Promise<{ status: number; text: string; json: Json }> {
  return request(port, pathname, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function draftsOf(json: Json): Array<Record<string, unknown>> {
  return Array.isArray(json.drafts) ? (json.drafts as Array<Record<string, unknown>>) : [];
}

describe("payments page", () => {
  it("serves the page with the sandbox footer and no secrets", async () => {
    await withServer({}, async (port) => {
      const home = await request(port, "/");
      expect(home.status).toBe(200);
      expect(home.text).toContain("PayPal Sandbox. No real money moves.");
      expect(home.text).toContain("Find payments");
      expect(home.text).toContain('href="/proof"');
      expect(home.text).toContain("free server is waking up");
      expect(home.text).toContain("about a minute");
      const meetings = await request(port, "/api/meetings");
      const samples = meetings.json.samples as unknown[];
      expect(samples.length).toBeGreaterThanOrEqual(15);
      const standIn = meetings.json.standIn as Record<string, unknown>;
      expect(standIn.kind).toBe("stand-in");
      expect(standIn.id).toBe("demo-made-up-amount");
      expect(meetings.json.paypalConfigured).toBe(false);
      expect(meetings.json.drafterBadge).toBe("Recorded AI output");
    });
  });

  it("replays the cheese payment as recorded output and proves the owner's yes", async () => {
    await withServer({}, async (port) => {
      const found = await post(port, "/api/find", { meetingId: "04-dairy-currency" });
      expect(found.status).toBe(200);
      expect(found.json.mode).toBe("recorded");
      expect(found.json.badge).toBe("Recorded AI output");
      expect(found.json.model).toBe("gpt-4o-mini-2024-07-18");
      const cheese = draftsOf(found.json).find((draft) => draft.payee === "Alto Dairy");
      expect(cheese?.verdict).toBe("Proven");
      expect(cheese?.amount).toBe("150.00");
      expect(cheese?.currency).toBe("EUR");
      expect(cheese?.evidenceQuotes).toContain("The cheese delivery comes to €150.");
      expect(cheese?.quotes).toContain("Deal. I'll pay that on Tuesday.");
    });
  });

  it("shows the stand-in made-up amount as blocked and not as AI output", async () => {
    let called = false;
    await withServer(
      {
        fetchImpl: () => {
          called = true;
          return Promise.reject(new Error("fetch should not run"));
        },
      },
      async (port) => {
        const found = await post(port, "/api/find", { meetingId: "demo-made-up-amount" });
        expect(found.status).toBe(200);
        expect(found.json.mode).toBe("stand-in");
        expect(found.json.badge).toBe("Stand-in example");
        expect(found.json.model).toBeNull();
        expect(found.text).toContain("not AI output");
        expect(found.text).not.toContain("Recorded AI output");
        expect(found.text).not.toContain("Live AI");
        const invented = draftsOf(found.json).find((draft) => draft.id === "demo-invented-amount");
        const real = draftsOf(found.json).find((draft) => draft.id === "demo-real-posters");
        expect(invented?.verdict).toBe("Blocked");
        expect(invented?.amount).toBe("875.00");
        expect(String(invented?.reasons)).toMatch(/875\.00/);
        expect(real?.verdict).toBe("Proven");
        const denied = await post(port, "/api/approve", { findId: found.json.findId, draftId: "demo-invented-amount" });
        expect(denied.status).toBe(400);
        expect(String(denied.json.error)).toMatch(/never reach/);
        expect(called).toBe(false);
      },
    );
  });

  it("refuses to approve when PayPal sandbox is not configured", async () => {
    let called = false;
    await withServer(
      {
        fetchImpl: () => {
          called = true;
          return Promise.reject(new Error("fetch should not run"));
        },
      },
      async (port) => {
        const found = await post(port, "/api/find", { meetingId: "01-harbor-menus" });
        const draft = draftsOf(found.json)[0];
        expect(draft?.verdict).toBe("Proven");
        const approved = await post(port, "/api/approve", { findId: found.json.findId, draftId: draft?.id });
        expect(approved.status).toBe(409);
        expect(approved.json.error).toBe("PayPal sandbox not configured");
        expect(called).toBe(false);
      },
    );
  });

  it("holds a needs-a-look draft until the owner confirms it", async () => {
    const portImpl: PayPalPort = {
      mode: "sandbox",
      async createOrder() {
        return { orderId: "ORDER-LOGO", checkoutUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-LOGO" };
      },
      async cancelOrder() {
        return { detail: "abandoned" };
      },
    };
    await withServer({ paypalPort: portImpl }, async (port) => {
      const found = await post(port, "/api/find", { meetingId: "10-logo-currency" });
      const draft = draftsOf(found.json)[0];
      expect(draft?.verdict).toBe("Needs a look");
      const held = await post(port, "/api/approve", { findId: found.json.findId, draftId: draft?.id });
      expect(held.status).toBe(400);
      expect(String(held.json.error)).toMatch(/not confirmed/);
      const confirmed = await post(port, "/api/approve", {
        findId: found.json.findId,
        draftId: draft?.id,
        confirmLook: true,
      });
      expect(confirmed.status).toBe(200);
      expect(confirmed.json.checkoutUrl).toBe("https://www.sandbox.paypal.com/checkoutnow?token=ORDER-LOGO");
      expect(confirmed.json.orderId).toBe("ORDER-LOGO");
    });
  });

  it("rejects a draft without creating a PayPal order", async () => {
    await withServer({}, async (port) => {
      const found = await post(port, "/api/find", { meetingId: "01-harbor-menus" });
      const draft = draftsOf(found.json)[0];
      const rejected = await post(port, "/api/reject", { findId: found.json.findId, draftId: draft?.id });
      expect(rejected.status).toBe(200);
      expect(rejected.json.status).toBe("rejected");
      expect(rejected.json.orderId).toBeNull();
      expect(String(rejected.json.message)).toMatch(/No PayPal order was created/);
    });
  });

  it("creates a sandbox order, sends the buyer to PayPal, and captures on return", async () => {
    const calls: string[] = [];
    let orderBody = "";
    let orderLookups = 0;
    const fetchImpl: typeof fetch = (url, init) => {
      const href = String(url);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push(`${method} ${href}`);
      if (href.endsWith("/v1/oauth2/token")) {
        return Promise.resolve(new Response(JSON.stringify({ access_token: "TEST-TOKEN" }), { status: 200 }));
      }
      if (method === "POST" && href.endsWith("/v2/checkout/orders")) {
        orderBody = typeof init?.body === "string" ? init.body : "";
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "5O190127TN364715T",
              links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T" }],
            }),
            { status: 200 },
          ),
        );
      }
      if (method === "GET" && href.includes("/v2/checkout/orders/")) {
        orderLookups += 1;
        const completed = orderLookups > 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "5O190127TN364715T",
              status: completed ? "COMPLETED" : "APPROVED",
              purchase_units: [
                {
                  payments: completed
                    ? {
                        captures: [
                          {
                            id: "3C679366HH908993F",
                            status: "COMPLETED",
                            amount: { currency_code: "USD", value: "480.00" },
                          },
                        ],
                      }
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
                {
                  payments: {
                    captures: [
                      {
                        id: "FROM-CAPTURE-RESPONSE",
                        status: "COMPLETED",
                        amount: { currency_code: "USD", value: "480.00" },
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${method} ${href}`));
    };
    await withServer(
      {
        env: {
          PAYPAL_MODE: "sandbox",
          PAYPAL_CLIENT_ID: PAYPAL_CLIENT,
          PAYPAL_CLIENT_SECRET: PAYPAL_SECRET,
        },
        fetchImpl,
      },
      async (port) => {
        const found = await post(port, "/api/find", { meetingId: "01-harbor-menus" });
        const draft = draftsOf(found.json)[0];
        const approved = await post(port, "/api/approve", { findId: found.json.findId, draftId: draft?.id });
        expect(approved.status).toBe(200);
        expect(approved.json.checkoutUrl).toBe("https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T");
        expect(approved.json.orderId).toBe("5O190127TN364715T");
        expect(approved.text).not.toContain(PAYPAL_SECRET);
        expect(approved.text).not.toContain(PAYPAL_CLIENT);
        const created = JSON.parse(orderBody) as { application_context?: { return_url?: string } };
        expect(created.application_context?.return_url).toContain("/paypal/return");
        const receipt = await request(port, "/paypal/return?token=5O190127TN364715T");
        expect(receipt.status).toBe(200);
        expect(receipt.text).toContain("5O190127TN364715T");
        expect(receipt.text).toContain("3C679366HH908993F");
        expect(receipt.text).toContain("480.00");
        expect(receipt.text).toContain("USD");
        expect(receipt.text).toContain("COMPLETED");
        expect(receipt.text).toContain('class="status-value">Captured');
        expect(receipt.text).toContain("Decision log");
        expect(receipt.text).toContain("Approved by the owner.");
        expect(receipt.text).toContain("Captured after PayPal reported the order complete.");
        expect(receipt.text).not.toContain("FROM-CAPTURE-RESPONSE");
        expect(receipt.text).toContain("I'll pay Harbor Print $480 on Friday for the spring menus.");
        expect(receipt.text).toContain("PayPal Sandbox. No real money moves.");
        expect(receipt.text).not.toContain(PAYPAL_SECRET);
        expect(calls.some((href) => href.endsWith("/capture"))).toBe(true);
        const ops = calls.map((entry) => {
          if (entry.includes("/oauth2/token")) return "token";
          if (entry.endsWith("/capture")) return "capture";
          if (entry.startsWith("GET ") && entry.includes("/v2/checkout/orders/")) return "get";
          if (entry.includes("/v2/checkout/orders")) return "create";
          return entry;
        });
        expect(ops).toEqual(["token", "create", "token", "get", "token", "capture", "token", "get"]);
      },
    );
  });

  it("uses live AI when an OpenAI key is set and does not leak the key", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "second-seat-live-"));
    const logPath = path.join(dir, "drafter.log");
    const fetchImpl: typeof fetch = (_url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${OPENAI_KEY}`);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            model: "gpt-4o-mini-2024-07-18",
            usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    payments: [
                      {
                        payee: "Harbor Print",
                        amount: "480.00",
                        currency: "USD",
                        purpose: "Spring menus",
                        due: "Friday",
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
    };
    await withServer(
      {
        env: { OPENAI_API_KEY: OPENAI_KEY },
        fetchImpl,
        cacheDir: path.join(dir, "cache"),
        logPath,
      },
      async (port) => {
        const meetings = await request(port, "/api/meetings");
        expect(meetings.json.drafterBadge).toBe("Live AI");
        const found = await post(port, "/api/find", { meetingId: "01-harbor-menus" });
        expect(found.status).toBe(200);
        expect(found.json.mode).toBe("live");
        expect(found.json.badge).toBe("Live AI");
        expect(found.text).not.toContain(OPENAI_KEY);
        const pasted = await post(port, "/api/find", { owner: "", transcript: "" });
        expect(pasted.status).toBe(400);
      },
    );
    const log = readFileSync(logPath, "utf8");
    expect(log).toContain("gpt-4o-mini-2024-07-18");
    expect(log).not.toContain(OPENAI_KEY);
  });

  it("tells a pasted transcript to use a live key when none is set", async () => {
    await withServer({}, async (port) => {
      const pasted = await post(port, "/api/find", {
        owner: "Maya Chen",
        transcript: "Maya Chen (owner): I'll pay Harbor Print $10.",
      });
      expect(pasted.status).toBe(400);
      expect(String(pasted.json.error)).toMatch(/OPENAI_API_KEY/);
      expect(String(pasted.json.error)).toMatch(/Recorded AI output/);
    });
  });
});
