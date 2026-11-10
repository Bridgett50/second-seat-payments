/**
 * One live call to OpenAI for payment drafts.
 *
 * The key is sent only as the Authorization header. It is never written
 * into the request body, the cache, or an error message.
 */
import { normalizeAmount, normalizeCurrency } from "./money.js";
import type { PaymentDraft } from "./types.js";

export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
export const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

export interface TokenUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export type LiveCallResult =
  | {
      ok: true;
      drafts: PaymentDraft[];
      model: string;
      status: number;
      usage: TokenUsage;
    }
  | {
      ok: false;
      status: number;
      usage: TokenUsage;
      model: string;
      error: string;
    };

const EMPTY_USAGE: TokenUsage = {
  promptTokens: null,
  completionTokens: null,
  totalTokens: null,
};

const PAYMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["payments"],
  properties: {
    payments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["payee", "amount", "currency", "purpose", "due", "quotes"],
        properties: {
          payee: { type: "string" },
          amount: {
            type: "string",
            description: "Decimal string with two fraction digits, such as 480.00",
          },
          currency: {
            type: "string",
            description: "ISO 4217 currency code, such as USD",
          },
          purpose: { type: "string" },
          due: {
            type: "string",
            description: "When the payment is due, or an empty string",
          },
          quotes: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
    },
  },
} as const;

function redact(secret: string, text: string): string {
  if (secret.length === 0) return text;
  return text.split(secret).join("[redacted]");
}

function asString(value: unknown): string | null {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function readUsage(body: unknown): TokenUsage {
  if (typeof body !== "object" || body === null || !("usage" in body)) return EMPTY_USAGE;
  const usage = body.usage;
  if (typeof usage !== "object" || usage === null) return EMPTY_USAGE;
  const record = usage as Record<string, unknown>;
  const prompt = record.prompt_tokens ?? record.input_tokens;
  const completion = record.completion_tokens ?? record.output_tokens;
  const total = record.total_tokens;
  return {
    promptTokens: typeof prompt === "number" ? prompt : null,
    completionTokens: typeof completion === "number" ? completion : null,
    totalTokens: typeof total === "number" ? total : null,
  };
}

function draftsFromContent(content: string, fixtureId: string): PaymentDraft[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new Error("OpenAI returned payment drafts that were not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || !("payments" in parsed)) {
    throw new Error("OpenAI returned payment drafts in an unexpected shape.");
  }
  const payments = parsed.payments;
  if (!Array.isArray(payments)) {
    throw new Error("OpenAI returned payment drafts in an unexpected shape.");
  }
  return payments.map((payment, index) => {
    if (typeof payment !== "object" || payment === null) {
      throw new Error(`OpenAI payment ${index + 1} was not an object.`);
    }
    const record = payment as Record<string, unknown>;
    const payee = asString(record.payee);
    const amountRaw = asString(record.amount);
    const currencyRaw = asString(record.currency);
    const purpose = asString(record.purpose);
    const due = asString(record.due);
    if (
      payee === null ||
      amountRaw === null ||
      currencyRaw === null ||
      purpose === null ||
      due === null ||
      !Array.isArray(record.quotes)
    ) {
      throw new Error(`OpenAI payment ${index + 1} was missing a required field.`);
    }
    const quotes = record.quotes.map((quote) => {
      const text = asString(quote);
      if (text === null) {
        throw new Error(`OpenAI payment ${index + 1} included a quote that was not text.`);
      }
      return text;
    });
    const amount = normalizeAmount(amountRaw) ?? amountRaw;
    const currency = normalizeCurrency(currencyRaw) ?? currencyRaw;
    return {
      id: `${fixtureId}-${index + 1}`,
      payee,
      amount,
      currency,
      purpose,
      due,
      quotes,
    };
  });
}

function systemPrompt(): string {
  return [
    "You list payments a small-business owner agreed to during a meeting.",
    "Return a payment only when that owner agreed to pay it.",
    "For each payment include the payee, the amount as a decimal string with two fraction digits such as 480.00, the ISO currency code such as USD, what the payment is for, when it is due (or an empty string), and one or more exact quotes.",
    "Copy quotes character for character from the transcript. Do not paraphrase.",
    "Do not invent amounts, payees, currencies, or quotes.",
    "Leave the list empty when the owner did not agree to pay anything.",
  ].join(" ");
}

export async function requestLiveDrafts(input: {
  apiKey: string;
  model: string;
  transcript: string;
  owner: string;
  fixtureId: string;
  fetchImpl: typeof fetch;
}): Promise<LiveCallResult> {
  const model = input.model.trim() || DEFAULT_OPENAI_MODEL;
  let response: Response;
  try {
    response = await input.fetchImpl(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: systemPrompt() },
          {
            role: "user",
            content: `Owner: ${input.owner}\n\nTranscript:\n${input.transcript}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "payment_drafts",
            strict: true,
            schema: PAYMENT_SCHEMA,
          },
        },
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      status: 0,
      usage: EMPTY_USAGE,
      model,
      error: `OpenAI draft request failed: ${redact(input.apiKey, message)}`,
    };
  }

  const bodyText = redact(input.apiKey, await response.text());
  let body: unknown = null;
  try {
    body = JSON.parse(bodyText) as unknown;
  } catch {
    body = null;
  }
  const usage = readUsage(body);
  const reportedModel =
    typeof body === "object" &&
    body !== null &&
    "model" in body &&
    typeof body.model === "string" &&
    body.model.trim().length > 0
      ? body.model
      : model;

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      usage,
      model: reportedModel,
      error: `OpenAI draft request failed: HTTP ${response.status} ${bodyText.slice(0, 300)}`,
    };
  }

  const content =
    typeof body === "object" &&
    body !== null &&
    "choices" in body &&
    Array.isArray(body.choices)
      ? (body.choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content
      : undefined;
  if (typeof content !== "string") {
    return {
      ok: false,
      status: response.status,
      usage,
      model: reportedModel,
      error: "OpenAI draft response did not include payment JSON.",
    };
  }

  try {
    return {
      ok: true,
      drafts: draftsFromContent(content, input.fixtureId),
      model: reportedModel,
      status: response.status,
      usage,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      status: response.status,
      usage,
      model: reportedModel,
      error: redact(input.apiKey, message),
    };
  }
}
