/**
 * A sliding one-hour cap on live AI calls for this process.
 * The default protects a small usage cap when the public demo is up.
 */

const HOUR_MS = 60 * 60 * 1000;
export const DEFAULT_LIVE_AI_HOURLY_LIMIT = 20;

export function readHourlyLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIVE_AI_HOURLY_LIMIT;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return DEFAULT_LIVE_AI_HOURLY_LIMIT;
  if (!/^\d+$/.test(trimmed)) return DEFAULT_LIVE_AI_HOURLY_LIMIT;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return DEFAULT_LIVE_AI_HOURLY_LIMIT;
  return value;
}

export interface LiveCallLimiter {
  limit: number;
  allow(nowMs: number): boolean;
  record(nowMs: number): void;
  used(nowMs: number): number;
}

export function createLiveCallLimiter(limit: number): LiveCallLimiter {
  const stamps: number[] = [];

  function prune(nowMs: number): void {
    const cutoff = nowMs - HOUR_MS;
    while (stamps.length > 0 && stamps[0]! <= cutoff) stamps.shift();
  }

  return {
    limit,
    allow(nowMs: number): boolean {
      prune(nowMs);
      return stamps.length < limit;
    },
    record(nowMs: number): void {
      prune(nowMs);
      stamps.push(nowMs);
    },
    used(nowMs: number): number {
      prune(nowMs);
      return stamps.length;
    },
  };
}

export function recordedFallbackNotice(limit: number): string {
  return `Live AI is paused after ${limit} calls this hour, so the usage cap stays protected. These drafts are saved output from an earlier gpt-4o-mini run. This request did not call OpenAI.`;
}

export function pastePausedNotice(limit: number): string {
  return `Live AI is paused after ${limit} calls this hour, so the usage cap stays protected. A pasted transcript has no saved recording, so it was not sent.`;
}
