/**
 * Find payment drafts in a transcript.
 *
 * Live mode calls OpenAI when OPENAI_API_KEY is set, appends a log line
 * with the model, token counts, and the reason when the call fails, and
 * saves the drafts so they can be replayed. Recorded mode replays that
 * saved file. Stand-in mode uses hand-written drafts and does not pretend
 * they came from a model.
 * Every result says which of the three modes produced it.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_OPENAI_MODEL, requestLiveDrafts, type TokenUsage } from "./openai.js";
import type { DraftBatch, DrafterMode, PaymentDraft, StandInLibrary } from "./types.js";

export type RequestedMode = DrafterMode | "auto";

export interface FindDraftsInput {
  fixtureId: string;
  transcript: string;
  owner: string;
}

export interface FindDraftsOptions {
  env?: Record<string, string | undefined>;
  mode?: RequestedMode;
  cacheDir?: string;
  logPath?: string;
  standIn?: StandInLibrary;
  standInPath?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  cwd?: string;
}

interface RecordedFile {
  fixtureId: string;
  source: "live";
  model: string;
  recordedAt: string;
  drafts: PaymentDraft[];
}

interface LogFields {
  at: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  fixtureId: string;
  status: number;
  error?: string;
}

function assertFixtureId(fixtureId: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(fixtureId)) {
    throw new Error(`fixture id must be a plain file name, got ${JSON.stringify(fixtureId)}`);
  }
}

function requestedMode(options: FindDraftsOptions, env: Record<string, string | undefined>): RequestedMode {
  const raw = options.mode ?? env.DRAFTER_MODE ?? "auto";
  const value = raw.trim().toLowerCase();
  if (value === "live" || value === "recorded" || value === "stand-in" || value === "auto") {
    return value;
  }
  throw new Error(
    `DRAFTER_MODE must be "live", "recorded", "stand-in", or "auto", got ${JSON.stringify(raw)}`,
  );
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

function readStandIn(filePath: string): StandInLibrary {
  if (!existsSync(filePath)) {
    throw new Error(`No stand-in drafts file at ${filePath}.`);
  }
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Stand-in drafts file ${filePath} is not an object keyed by fixture id.`);
  }
  const library: StandInLibrary = {};
  for (const [fixtureId, drafts] of Object.entries(parsed)) {
    if (!Array.isArray(drafts) || !drafts.every(isDraft)) {
      throw new Error(`Stand-in drafts for ${fixtureId} are not a list of payment drafts.`);
    }
    library[fixtureId] = drafts;
  }
  return library;
}

function readRecorded(filePath: string, fixtureId: string): RecordedFile {
  if (!existsSync(filePath)) {
    throw new Error(
      `No recorded drafts are saved for ${fixtureId}. Run the live eval once to create the cache.`,
    );
  }
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Recorded drafts for ${fixtureId} could not be read.`);
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.model !== "string" || !Array.isArray(record.drafts) || !record.drafts.every(isDraft)) {
    throw new Error(`Recorded drafts for ${fixtureId} are missing the model or the drafts.`);
  }
  return {
    fixtureId,
    source: "live",
    model: record.model,
    recordedAt: typeof record.recordedAt === "string" ? record.recordedAt : "",
    drafts: record.drafts,
  };
}

function appendLog(logPath: string, fields: LogFields, secret: string): void {
  const line = JSON.stringify(fields);
  const exact = secret.length === 0 ? line : line.split(secret).join("[redacted]");
  const safe = exact.replace(/sk-[A-Za-z0-9*_-]{6,}/g, "[redacted]");
  mkdirSync(path.dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${safe}\n`, "utf8");
}

function usageFields(usage: TokenUsage): Pick<LogFields, "promptTokens" | "completionTokens" | "totalTokens"> {
  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
  };
}

export async function findDrafts(
  input: FindDraftsInput,
  options: FindDraftsOptions = {},
): Promise<DraftBatch> {
  assertFixtureId(input.fixtureId);
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const cacheDir = options.cacheDir ?? path.join(cwd, "fixtures", "cache");
  const logPath = options.logPath ?? path.join(cwd, "eval", "logs", "drafter.log");
  const standInPath = options.standInPath ?? path.join(cwd, "fixtures", "stand-in.json");
  const cacheFile = path.join(cacheDir, `${input.fixtureId}.json`);
  const now = options.now ?? (() => new Date());
  let mode = requestedMode(options, env);
  if (mode === "auto") {
    const key = env.OPENAI_API_KEY?.trim() ?? "";
    if (key.length > 0) mode = "live";
    else if (existsSync(cacheFile)) mode = "recorded";
    else mode = "stand-in";
  }

  if (mode === "recorded") {
    const recorded = readRecorded(cacheFile, input.fixtureId);
    return {
      mode: "recorded",
      model: recorded.model,
      fixtureId: input.fixtureId,
      drafts: recorded.drafts,
    };
  }

  if (mode === "stand-in") {
    const library = options.standIn ?? readStandIn(standInPath);
    return {
      mode: "stand-in",
      model: null,
      fixtureId: input.fixtureId,
      drafts: library[input.fixtureId] ?? [],
    };
  }

  const apiKey = env.OPENAI_API_KEY?.trim() ?? "";
  if (apiKey.length === 0) {
    throw new Error("OPENAI_API_KEY is not set, so live mode cannot run.");
  }
  const model = env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
  const call = await requestLiveDrafts({
    apiKey,
    model,
    transcript: input.transcript,
    owner: input.owner,
    fixtureId: input.fixtureId,
    fetchImpl: options.fetchImpl ?? fetch,
  });
  appendLog(
    logPath,
    {
      at: now().toISOString(),
      model: call.model,
      fixtureId: input.fixtureId,
      status: call.status,
      ...usageFields(call.usage),
      ...(call.ok ? {} : { error: call.error }),
    },
    apiKey,
  );
  if (!call.ok) {
    throw new Error(call.error);
  }

  const recorded: RecordedFile = {
    fixtureId: input.fixtureId,
    source: "live",
    model: call.model,
    recordedAt: now().toISOString(),
    drafts: call.drafts,
  };
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cacheFile, `${JSON.stringify(recorded, null, 2)}\n`, "utf8");
  return {
    mode: "live",
    model: call.model,
    fixtureId: input.fixtureId,
    drafts: call.drafts,
  };
}
