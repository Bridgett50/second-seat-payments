/**
 * Summarize the drafter log. Counts and token totals only.
 * Raw lines stay out of the response so a secret cannot be echoed.
 */

export interface ModelLogSummary {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  failedCalls: number;
  models: string[];
  skippedLines: number;
}

function emptySummary(): ModelLogSummary {
  return {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    failedCalls: 0,
    models: [],
    skippedLines: 0,
  };
}

function asCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

export function summarizeModelLog(text: string): ModelLogSummary {
  const summary = emptySummary();
  const models = new Set<string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      summary.skippedLines += 1;
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) {
      summary.skippedLines += 1;
      continue;
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record.model !== "string" || typeof record.status !== "number") {
      summary.skippedLines += 1;
      continue;
    }
    summary.calls += 1;
    if (record.status !== 200) summary.failedCalls += 1;
    const prompt = asCount(record.promptTokens);
    const completion = asCount(record.completionTokens);
    const total = asCount(record.totalTokens);
    if (prompt !== null) summary.promptTokens += prompt;
    if (completion !== null) summary.completionTokens += completion;
    if (total !== null) summary.totalTokens += total;
    models.add(record.model);
  }
  summary.models = [...models].sort();
  return summary;
}
