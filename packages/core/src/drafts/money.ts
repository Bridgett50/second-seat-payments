/**
 * Read amounts and currencies out of a quote.
 *
 * A number counts as money only when the words around it say so: a
 * currency symbol, a currency word, or a plain number next to "pay",
 * "invoice", "deposit", and the like. "15 boxes" and "the 12th" are not
 * prices.
 */

export interface MoneyMention {
  value: number;
  /** ISO code when the quote names a currency, otherwise null. */
  currency: string | null;
  raw: string;
  start: number;
  end: number;
}

const PAYEE_STOP = new Set([
  "the",
  "and",
  "of",
  "a",
  "an",
  "for",
  "to",
  "llc",
  "inc",
  "co",
  "company",
  "ltd",
  "limited",
]);

const CURRENCY_PHRASES: ReadonlyArray<readonly [string, string]> = [
  ["canadian dollars", "CAD"],
  ["canadian dollar", "CAD"],
  ["us dollars", "USD"],
  ["us dollar", "USD"],
  ["dollars", "USD"],
  ["dollar", "USD"],
  ["euros", "EUR"],
  ["euro", "EUR"],
  ["pounds sterling", "GBP"],
  ["pounds", "GBP"],
  ["pound", "GBP"],
  ["usd", "USD"],
  ["eur", "EUR"],
  ["gbp", "GBP"],
  ["cad", "CAD"],
];

const SMALL_NUMBERS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const NUMBER_WORDS = [...Object.keys(SMALL_NUMBERS), "hundred", "thousand", "and"];

const QUANTITY_UNITS = new Set([
  "box",
  "boxes",
  "people",
  "person",
  "minute",
  "minutes",
  "hour",
  "hours",
  "day",
  "days",
  "week",
  "weeks",
  "month",
  "months",
  "year",
  "years",
  "percent",
  "dozen",
  "dozens",
  "item",
  "items",
  "unit",
  "units",
  "chair",
  "chairs",
  "case",
  "cases",
  "bag",
  "bags",
  "copy",
  "copies",
  "guest",
  "guests",
  "seat",
  "seats",
  "ticket",
  "tickets",
  "time",
  "times",
]);

/** Words that mark a nearby bare number as a price. */
const PAY_CUE_SOURCE =
  "\\b(pay|paying|paid|cost|costs|charge|charged|invoice|invoiced|total|deposit|fee|price|quote)\\b";

export function significantWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/&/g, " ")
    .split(/[^a-z0-9']+/)
    .filter((word) => word.length > 1 && !PAYEE_STOP.has(word));
}

export function normalizeAmount(raw: string): string | null {
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value.toFixed(2);
}

export function normalizeCurrency(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  return code;
}

export function amountsMatch(left: string, right: string): boolean {
  const a = normalizeAmount(left);
  const b = normalizeAmount(right);
  return a !== null && a === b;
}

export function samePayment(
  draft: { payee: string; amount: string; currency: string },
  expected: { payee: string; amount: string; currency: string },
): boolean {
  if (!amountsMatch(draft.amount, expected.amount)) return false;
  const leftCurrency = normalizeCurrency(draft.currency);
  const rightCurrency = normalizeCurrency(expected.currency);
  if (leftCurrency === null || leftCurrency !== rightCurrency) return false;
  const leftPayee = significantWords(draft.payee).join(" ");
  const rightPayee = significantWords(expected.payee).join(" ");
  return leftPayee.length > 0 && leftPayee === rightPayee;
}

export function paymentKey(draft: {
  payee: string;
  amount: string;
  currency: string;
}): string {
  const amount = normalizeAmount(draft.amount) ?? draft.amount.trim();
  const currency = normalizeCurrency(draft.currency) ?? draft.currency.trim();
  return `${significantWords(draft.payee).join(" ")}|${amount}|${currency}`;
}

function phrasePattern(): string {
  return CURRENCY_PHRASES.map(([phrase]) => phrase.replace(/ /g, "\\s+")).join("|");
}

function currencyForPhrase(phrase: string): string | null {
  const found = CURRENCY_PHRASES.find(
    ([name]) => name.toLowerCase() === phrase.toLowerCase().replace(/\s+/g, " "),
  );
  return found?.[1] ?? null;
}

function parseNumber(whole: string, fraction: string | undefined): number | null {
  const digits = whole.replace(/,/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const text = fraction === undefined ? digits : `${digits}.${fraction}`;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function parseWordNumber(words: string[]): number | null {
  let total = 0;
  let current = 0;
  let any = false;
  for (const word of words) {
    if (word === "and") continue;
    if (word === "hundred") {
      current = (current === 0 ? 1 : current) * 100;
      any = true;
      continue;
    }
    if (word === "thousand") {
      total += (current === 0 ? 1 : current) * 1000;
      current = 0;
      any = true;
      continue;
    }
    const small = SMALL_NUMBERS[word];
    if (small === undefined) return null;
    current += small;
    any = true;
  }
  if (!any) return null;
  return total + current;
}

function symbolCurrency(symbol: string): string | null {
  if (symbol === "$") return "USD";
  if (symbol === "€") return "EUR";
  if (symbol === "£") return "GBP";
  if (symbol === "CA$" || symbol === "C$") return "CAD";
  if (symbol === "A$") return "AUD";
  return null;
}

function addMention(
  mentions: MoneyMention[],
  mention: MoneyMention | null,
): void {
  if (mention === null) return;
  const overlaps = mentions.some(
    (existing) => mention.start < existing.end && existing.start < mention.end,
  );
  if (overlaps) return;
  mentions.push(mention);
}

/**
 * True when `value` shows up in `text` as a count or a date, not a price.
 * Used to explain a draft that grabbed "15 boxes" or "the 12th".
 */
export function isQuantityOrDate(text: string, value: number): boolean {
  if (!Number.isInteger(value)) return false;
  const raw = String(value);
  const pattern = new RegExp(
    `\\b${raw}(?:st|nd|rd|th)?\\b(?:\\s+([a-z]+))?`,
    "gi",
  );
  let foundQuantity = false;
  for (const match of text.matchAll(pattern)) {
    const unit = match[1]?.toLowerCase();
    const ordinal = /(?:st|nd|rd|th)$/i.test(match[0].split(/\s+/)[0] ?? "");
    if (ordinal || (unit !== undefined && QUANTITY_UNITS.has(unit))) {
      foundQuantity = true;
    }
  }
  return foundQuantity;
}

export function extractMoney(text: string): MoneyMention[] {
  const mentions: MoneyMention[] = [];
  const phrases = phrasePattern();

  const symbolRe = /(CA\$|C\$|A\$|[$€£])\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;
  for (const match of text.matchAll(symbolRe)) {
    const raw = match[0];
    const symbol = match[1];
    const whole = match[2];
    if (symbol === undefined || whole === undefined) continue;
    const value = parseNumber(whole, match[3]);
    const currency = symbolCurrency(symbol);
    if (value === null || currency === null) continue;
    addMention(mentions, {
      value,
      currency,
      raw,
      start: match.index ?? 0,
      end: (match.index ?? 0) + raw.length,
    });
  }

  const wordRe = new RegExp(
    `\\b((?:(?:${NUMBER_WORDS.join("|")})\\s+){1,8})(${phrases})\\b`,
    "gi",
  );
  for (const match of text.matchAll(wordRe)) {
    const words = match[1]?.trim().toLowerCase().split(/\s+/) ?? [];
    const phrase = match[2];
    if (phrase === undefined) continue;
    const value = parseWordNumber(words);
    const currency = currencyForPhrase(phrase);
    if (value === null || currency === null || value <= 0) continue;
    const raw = match[0];
    addMention(mentions, {
      value,
      currency,
      raw,
      start: match.index ?? 0,
      end: (match.index ?? 0) + raw.length,
    });
  }

  const numberThenCurrency = new RegExp(
    `\\b(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d{1,2}))?\\s+(${phrases})\\b`,
    "gi",
  );
  for (const match of text.matchAll(numberThenCurrency)) {
    const whole = match[1];
    const phrase = match[3];
    if (whole === undefined || phrase === undefined) continue;
    const value = parseNumber(whole, match[2]);
    const currency = currencyForPhrase(phrase);
    if (value === null || currency === null) continue;
    const raw = match[0];
    addMention(mentions, {
      value,
      currency,
      raw,
      start: match.index ?? 0,
      end: (match.index ?? 0) + raw.length,
    });
  }

  const codeThenNumber =
    /\b(USD|EUR|GBP|CAD|AUD)\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\b/gi;
  for (const match of text.matchAll(codeThenNumber)) {
    const code = match[1];
    const whole = match[2];
    if (code === undefined || whole === undefined) continue;
    const value = parseNumber(whole, match[3]);
    if (value === null) continue;
    const raw = match[0];
    addMention(mentions, {
      value,
      currency: code.toUpperCase(),
      raw,
      start: match.index ?? 0,
      end: (match.index ?? 0) + raw.length,
    });
  }

  const bareRe = /\b(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\b/g;
  for (const cue of text.matchAll(new RegExp(PAY_CUE_SOURCE, "gi"))) {
    const cueEnd = (cue.index ?? 0) + cue[0].length;
    const window = text.slice(cueEnd, cueEnd + 48);
    bareRe.lastIndex = 0;
    const number = bareRe.exec(window);
    if (number === null || number[1] === undefined) continue;
    const token = number[0];
    const after = window.slice(number.index + token.length);
    const nextWord = /^[\s,]*([a-z]+)/i.exec(after)?.[1]?.toLowerCase();
    if (nextWord !== undefined && QUANTITY_UNITS.has(nextWord)) continue;
    if (/(?:st|nd|rd|th)\b/i.test(token) || /^(?:st|nd|rd|th)\b/i.test(after.trim())) {
      continue;
    }
    const value = parseNumber(number[1], number[2]);
    if (value === null || value <= 0) continue;
    const start = cueEnd + number.index;
    addMention(mentions, {
      value,
      currency: null,
      raw: token,
      start,
      end: start + token.length,
    });
  }

  mentions.sort((a, b) => a.start - b.start);
  return mentions;
}

export function mentionsValue(text: string, value: number): MoneyMention[] {
  return extractMoney(text).filter((mention) => Math.abs(mention.value - value) < 0.001);
}
