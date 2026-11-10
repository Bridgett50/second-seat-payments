import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findDrafts, type PaymentDraft } from "../src/index.js";

const SECRET = "sk-test-DO-NOT-LEAK-9f3a";

const liveDraft: PaymentDraft = {
  id: "ignored-by-parser",
  payee: "Harbor Print",
  amount: "480.00",
  currency: "USD",
  purpose: "Spring menus",
  due: "Friday",
  quotes: ["I'll pay Harbor Print $480 on Friday."],
};

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "second-seat-"));
}

function successResponse(): Response {
  return new Response(
    JSON.stringify({
      model: "gpt-4o-mini",
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      choices: [
        {
          message: {
            content: JSON.stringify({
              payments: [
                {
                  payee: liveDraft.payee,
                  amount: liveDraft.amount,
                  currency: liveDraft.currency,
                  purpose: liveDraft.purpose,
                  due: liveDraft.due,
                  quotes: liveDraft.quotes,
                },
              ],
            }),
          },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("payment finder modes", () => {
  it("uses the stand-in when there is no key and no cache", async () => {
    const root = tempDir();
    const standInPath = path.join(root, "stand-in.json");
    const handWritten: PaymentDraft = { ...liveDraft, id: "stand-in-1" };
    writeFileSync(standInPath, JSON.stringify({ "fixture-a": [handWritten] }));
    let called = false;
    const batch = await findDrafts(
      { fixtureId: "fixture-a", transcript: "Maya: hello", owner: "Maya" },
      {
        mode: "auto",
        env: {},
        cwd: root,
        cacheDir: path.join(root, "cache"),
        logPath: path.join(root, "drafter.log"),
        standInPath,
        fetchImpl: () => {
          called = true;
          return Promise.resolve(successResponse());
        },
      },
    );
    expect(called).toBe(false);
    expect(batch.mode).toBe("stand-in");
    expect(batch.model).toBeNull();
    expect(batch.drafts).toEqual([handWritten]);
  });

  it("replays a saved live result in recorded mode", async () => {
    const root = tempDir();
    const cacheDir = path.join(root, "cache");
    mkdirSync(cacheDir);
    writeFileSync(
      path.join(cacheDir, "fixture-a.json"),
      JSON.stringify({
        fixtureId: "fixture-a",
        source: "live",
        model: "gpt-4o-mini",
        recordedAt: "2026-11-10T00:00:00.000Z",
        drafts: [{ ...liveDraft, id: "fixture-a-1" }],
      }),
    );
    let called = false;
    const batch = await findDrafts(
      { fixtureId: "fixture-a", transcript: "Maya: hello", owner: "Maya" },
      {
        mode: "auto",
        env: {},
        cacheDir,
        logPath: path.join(root, "drafter.log"),
        standInPath: path.join(root, "missing.json"),
        fetchImpl: () => {
          called = true;
          return Promise.resolve(successResponse());
        },
      },
    );
    expect(called).toBe(false);
    expect(batch.mode).toBe("recorded");
    expect(batch.model).toBe("gpt-4o-mini");
    expect(batch.drafts[0]?.payee).toBe("Harbor Print");
  });

  it("calls OpenAI in live mode, logs tokens, and does not record the key", async () => {
    const root = tempDir();
    const logPath = path.join(root, "drafter.log");
    const cacheDir = path.join(root, "cache");
    let authorization = "";
    const batch = await findDrafts(
      { fixtureId: "fixture-a", transcript: "Owner: I'll pay Harbor Print $480.", owner: "Maya" },
      {
        mode: "live",
        env: { OPENAI_API_KEY: SECRET, OPENAI_MODEL: "gpt-4o-mini" },
        cacheDir,
        logPath,
        now: () => new Date("2026-11-10T01:02:03.000Z"),
        fetchImpl: (_url, init) => {
          const headers = new Headers(init?.headers);
          authorization = headers.get("authorization") ?? "";
          return Promise.resolve(successResponse());
        },
      },
    );
    expect(batch.mode).toBe("live");
    expect(batch.model).toBe("gpt-4o-mini");
    expect(batch.drafts[0]?.amount).toBe("480.00");
    expect(authorization).toBe(`Bearer ${SECRET}`);
    const log = readFileSync(logPath, "utf8");
    expect(log).toContain("gpt-4o-mini");
    expect(log).toContain("2026-11-10T01:02:03.000Z");
    expect(log).toContain('"promptTokens":11');
    expect(log).toContain('"completionTokens":7');
    expect(log).toContain('"totalTokens":18');
    expect(log).not.toContain(SECRET);
    const cache = readFileSync(path.join(cacheDir, "fixture-a.json"), "utf8");
    expect(cache).toContain('"source": "live"');
    expect(cache).not.toContain(SECRET);
  });

  it("redacts the key when the live call fails", async () => {
    const root = tempDir();
    const logPath = path.join(root, "drafter.log");
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(new Response(`invalid key ${SECRET}`, { status: 401 }));
    await expect(
      findDrafts(
        { fixtureId: "fixture-a", transcript: "hello", owner: "Maya" },
        {
          mode: "live",
          env: { OPENAI_API_KEY: SECRET },
          cacheDir: path.join(root, "cache"),
          logPath,
          fetchImpl,
        },
      ),
    ).rejects.toThrow(/HTTP 401/);
    const log = readFileSync(logPath, "utf8");
    const message = await findDrafts(
      { fixtureId: "fixture-a", transcript: "hello", owner: "Maya" },
      {
        mode: "live",
        env: { OPENAI_API_KEY: SECRET },
        cacheDir: path.join(root, "cache"),
        logPath,
        fetchImpl,
      },
    ).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
    expect(message).not.toContain(SECRET);
    expect(log).not.toContain(SECRET);
    expect(message).toContain("[redacted]");
  });

  it("refuses live mode when the key is missing", async () => {
    const root = tempDir();
    await expect(
      findDrafts(
        { fixtureId: "fixture-a", transcript: "hello", owner: "Maya" },
        {
          mode: "live",
          env: {},
          cacheDir: path.join(root, "cache"),
          logPath: path.join(root, "drafter.log"),
        },
      ),
    ).rejects.toThrow(/OPENAI_API_KEY is not set/);
  });
});
