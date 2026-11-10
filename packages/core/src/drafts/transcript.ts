/**
 * Split a meeting transcript into speaker turns.
 *
 * Each turn is one line that starts with a speaker label and a colon:
 *
 *   Maya Chen (owner): I'll pay Harbor Print $480 on Friday.
 *
 * A line with no colon continues the previous speaker. The owner is the
 * person named by the caller, and anyone whose label says "(owner)".
 */

export interface Turn {
  index: number;
  /** The label before the colon, including a role such as "(owner)". */
  speaker: string;
  /** The label with the parenthetical role removed. */
  speakerName: string;
  isOwner: boolean;
  text: string;
}

function cleanName(label: string): string {
  return label
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, " ")
    .trim();
}

export function parseTranscript(transcript: string, owner: string): Turn[] {
  const ownerName = cleanName(owner);
  const turns: Turn[] = [];
  for (const line of transcript.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const match = /^([^:]{1,120}):\s*(.*)$/.exec(trimmed);
    if (match === null) {
      const last = turns[turns.length - 1];
      if (last !== undefined) {
        last.text = `${last.text} ${trimmed}`.trim();
      }
      continue;
    }
    const speaker = match[1]?.trim() ?? "";
    const text = match[2] ?? "";
    const speakerName = speaker.replace(/\([^)]*\)/g, "").trim();
    const isOwner =
      /\(owner\)/i.test(speaker) ||
      (ownerName.length > 0 && cleanName(speakerName) === ownerName);
    turns.push({
      index: turns.length,
      speaker,
      speakerName,
      isOwner,
      text,
    });
  }
  return turns;
}

export function turnContaining(turns: readonly Turn[], quote: string): Turn | null {
  const needle = quote.trim();
  if (needle.length === 0) return null;
  return turns.find((turn) => turn.text.includes(needle)) ?? null;
}
