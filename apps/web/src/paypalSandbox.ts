/**
 * PayPal sandbox client for approval-gated payments.
 *
 * Implements the core `PayPalPort` against the PayPal Checkout REST API
 * in the sandbox environment only. The API base is a constant pointing
 * at the sandbox host; there is deliberately no way to repoint this
 * client at the live PayPal API through configuration.
 *
 * Credentials come from the environment and nowhere else:
 *
 *   PAYPAL_MODE=sandbox          (anything else selects the demo port)
 *   PAYPAL_CLIENT_ID=<sandbox app client id>
 *   PAYPAL_CLIENT_SECRET=<sandbox app client secret>
 *
 * With `PAYPAL_MODE` unset or set to `demo`, `paypalPortFromEnv` returns
 * the core demo port instead: the whole flow runs with simulated
 * responses, no network and no credentials, and every approval-log entry
 * is stamped mode "demo" so it cannot be mistaken for sandbox activity.
 *
 * Nothing in this file creates, stores, or guesses a credential. If
 * sandbox mode is requested without both values, it throws and names the
 * missing variable.
 */
import {
  createDemoPayPalPort,
  type CreatedOrder,
  type PayPalPort,
  type PaymentCommitmentInput,
} from "@second-seat/core";

/** PayPal sandbox API base. Sandbox only, by design. */
export const PAYPAL_SANDBOX_API_BASE = "https://api-m.sandbox.paypal.com";

export interface PayPalSandboxConfig {
  clientId: string;
  clientSecret: string;
  apiBase?: string;
  /** Where PayPal sends the buyer after they approve. Sandbox checkout only. */
  returnUrl?: string;
  /** Where PayPal sends the buyer if they back out. */
  cancelUrl?: string;
  /** Test hook. Production uses the global fetch. */
  fetchImpl?: typeof fetch;
}

export interface CapturedPayPalOrder {
  orderId: string;
  captureId: string;
  status: string;
  amount: string;
  currency: string;
}

/** An order as PayPal reported it on a fetch, before we decide it is captured. */
export interface PayPalOrderSnapshot {
  orderId: string;
  status: string;
  captureId: string | null;
  captureStatus: string | null;
  amount: string;
  currency: string;
}

type Env = Record<string, string | undefined>;

/**
 * Build the PayPal port from environment variables.
 *
 * - `PAYPAL_MODE=demo` or unset: the simulated demo port.
 * - `PAYPAL_MODE=sandbox`: the real sandbox client; throws when
 *   `PAYPAL_CLIENT_ID` or `PAYPAL_CLIENT_SECRET` is missing or empty.
 */
export function paypalPortFromEnv(env: Env): PayPalPort {
  const mode = (env.PAYPAL_MODE ?? "demo").trim().toLowerCase();
  if (mode === "demo") {
    return createDemoPayPalPort();
  }
  if (mode !== "sandbox") {
    throw new Error(
      `PAYPAL_MODE must be "demo" or "sandbox", got ${JSON.stringify(env.PAYPAL_MODE)}`,
    );
  }
  const clientId = env.PAYPAL_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.PAYPAL_CLIENT_SECRET?.trim() ?? "";
  if (clientId.length === 0) {
    throw new Error("PAYPAL_MODE=sandbox requires PAYPAL_CLIENT_ID in the environment");
  }
  if (clientSecret.length === 0) {
    throw new Error("PAYPAL_MODE=sandbox requires PAYPAL_CLIENT_SECRET in the environment");
  }
  return createPayPalSandboxPort({ clientId, clientSecret });
}

function sandboxBase(config: PayPalSandboxConfig): string {
  const apiBase = config.apiBase ?? PAYPAL_SANDBOX_API_BASE;
  if (!apiBase.includes("sandbox.paypal.com")) {
    throw new Error(
      `refusing a non-sandbox PayPal API base: ${apiBase}. This client is sandbox-only.`,
    );
  }
  return apiBase;
}

function redactSecrets(config: PayPalSandboxConfig, text: string): string {
  let out = text;
  if (config.clientId.length > 0) out = out.split(config.clientId).join("[redacted]");
  if (config.clientSecret.length > 0) out = out.split(config.clientSecret).join("[redacted]");
  return out;
}

async function accessToken(config: PayPalSandboxConfig, apiBase: string): Promise<string> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`, "utf8").toString("base64");
  const response = await fetchImpl(`${apiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(
      `PayPal sandbox token request failed: HTTP ${response.status} ${redactSecrets(config, raw).slice(0, 300)}`,
    );
  }
  let body: { access_token?: unknown };
  try {
    body = JSON.parse(raw) as { access_token?: unknown };
  } catch {
    throw new Error("PayPal sandbox token response was not JSON");
  }
  if (typeof body.access_token !== "string" || body.access_token.length === 0) {
    throw new Error("PayPal sandbox token response carried no access_token");
  }
  return body.access_token;
}

/** The real PayPal Checkout REST client for the sandbox environment. */
export function createPayPalSandboxPort(config: PayPalSandboxConfig): PayPalPort {
  const apiBase = sandboxBase(config);
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    mode: "sandbox",

    async createOrder(
      commitment: PaymentCommitmentInput & { id: string },
    ): Promise<CreatedOrder> {
      const token = await accessToken(config, apiBase);
      const description =
        `${commitment.purpose} (payee: ${commitment.payee})`.slice(0, 127);
      const order: Record<string, unknown> = {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: commitment.id,
            custom_id: commitment.id,
            description,
            amount: {
              currency_code: commitment.currency,
              value: commitment.amount,
            },
          },
        ],
      };
      if (config.returnUrl !== undefined && config.returnUrl.length > 0) {
        order.application_context = {
          return_url: config.returnUrl,
          cancel_url: config.cancelUrl !== undefined && config.cancelUrl.length > 0 ? config.cancelUrl : config.returnUrl,
          user_action: "PAY_NOW",
          shipping_preference: "NO_SHIPPING",
        };
      }
      const response = await fetchImpl(`${apiBase}/v2/checkout/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": commitment.id,
        },
        body: JSON.stringify(order),
      });
      if (!response.ok) {
        const text = redactSecrets(config, await response.text());
        throw new Error(
          `PayPal sandbox create order failed: HTTP ${response.status} ${text.slice(0, 300)}`,
        );
      }
      const body = (await response.json()) as {
        id?: unknown;
        links?: { rel?: unknown; href?: unknown }[];
      };
      if (typeof body.id !== "string" || body.id.length === 0) {
        throw new Error("PayPal sandbox create order response carried no order id");
      }
      const links = Array.isArray(body.links) ? body.links : [];
      const checkout = links.find(
        (link) => link.rel === "payer-action" || link.rel === "approve",
      );
      return {
        orderId: body.id,
        checkoutUrl: typeof checkout?.href === "string" ? checkout.href : null,
      };
    },

    async cancelOrder(orderId: string): Promise<{ detail: string }> {
      // PayPal's Orders API has no cancel endpoint for an order that was
      // never approved or captured, and such an order can never charge
      // anyone: without the payer completing checkout there is nothing to
      // capture. Owner rejection therefore abandons the order (it lapses
      // on PayPal's side), and the approval gate records the rejection.
      // This method performs no network call on purpose.
      void orderId;
      return {
        detail:
          "PayPal sandbox order abandoned after owner rejection: it was never approved or captured, cannot be charged, and lapses on PayPal's side (the Orders API exposes no cancel for an unapproved order).",
      };
    },
  };
}

/**
 * Fetch an order from PayPal sandbox.
 * The caller decides what "Captured" means from this status, not from a local guess.
 */
export async function fetchPayPalSandboxOrder(
  config: PayPalSandboxConfig,
  orderId: string,
): Promise<PayPalOrderSnapshot> {
  const apiBase = sandboxBase(config);
  const fetchImpl = config.fetchImpl ?? fetch;
  const token = await accessToken(config, apiBase);
  const response = await fetchImpl(`${apiBase}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(
      `PayPal sandbox order lookup failed: HTTP ${response.status} ${redactSecrets(config, raw).slice(0, 300)}`,
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("PayPal sandbox order lookup was not JSON");
  }
  return readOrder(orderId, body);
}

/** Capture a sandbox order after the buyer approves it on PayPal. */
export async function capturePayPalSandboxOrder(
  config: PayPalSandboxConfig,
  orderId: string,
): Promise<CapturedPayPalOrder> {
  const apiBase = sandboxBase(config);
  const fetchImpl = config.fetchImpl ?? fetch;
  const token = await accessToken(config, apiBase);
  const response = await fetchImpl(`${apiBase}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": `capture-${orderId}`,
    },
    body: "{}",
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(
      `PayPal sandbox capture failed: HTTP ${response.status} ${redactSecrets(config, raw).slice(0, 300)}`,
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("PayPal sandbox capture response was not JSON");
  }
  return readCapture(orderId, body);
}

function readOrder(orderId: string, body: unknown): PayPalOrderSnapshot {
  if (typeof body !== "object" || body === null) {
    throw new Error("PayPal sandbox order lookup carried no order");
  }
  const record = body as { id?: unknown; status?: unknown; purchase_units?: unknown };
  if (typeof record.id === "string" && record.id.length > 0 && record.id !== orderId) {
    throw new Error("PayPal sandbox order lookup returned a different order id");
  }
  if (typeof record.status !== "string" || record.status.length === 0) {
    throw new Error("PayPal sandbox order lookup carried no status");
  }
  const capture = firstCapture(record.purchase_units);
  return {
    orderId,
    status: record.status,
    captureId: capture?.id ?? null,
    captureStatus: capture?.status ?? null,
    amount: capture?.amount ?? "",
    currency: capture?.currency ?? "",
  };
}

function firstCapture(
  purchaseUnits: unknown,
): { id: string; status: string | null; amount: string; currency: string } | null {
  const units = Array.isArray(purchaseUnits) ? purchaseUnits : [];
  const first = units[0];
  const payments =
    typeof first === "object" && first !== null && "payments" in first ? first.payments : undefined;
  const captures =
    typeof payments === "object" && payments !== null && "captures" in payments && Array.isArray(payments.captures)
      ? payments.captures
      : [];
  const capture = captures[0];
  if (typeof capture !== "object" || capture === null) return null;
  const captureRecord = capture as { id?: unknown; status?: unknown; amount?: unknown };
  if (typeof captureRecord.id !== "string" || captureRecord.id.length === 0) return null;
  const amountRecord =
    typeof captureRecord.amount === "object" && captureRecord.amount !== null
      ? (captureRecord.amount as { currency_code?: unknown; value?: unknown })
      : undefined;
  return {
    id: captureRecord.id,
    status: typeof captureRecord.status === "string" ? captureRecord.status : null,
    amount: typeof amountRecord?.value === "string" ? amountRecord.value : "",
    currency: typeof amountRecord?.currency_code === "string" ? amountRecord.currency_code : "",
  };
}

function readCapture(orderId: string, body: unknown): CapturedPayPalOrder {
  if (typeof body !== "object" || body === null) {
    throw new Error("PayPal sandbox capture response carried no capture");
  }
  const record = body as {
    status?: unknown;
    purchase_units?: unknown;
  };
  const units = Array.isArray(record.purchase_units) ? record.purchase_units : [];
  const first = units[0];
  const payments =
    typeof first === "object" && first !== null && "payments" in first ? first.payments : undefined;
  const captures =
    typeof payments === "object" && payments !== null && "captures" in payments && Array.isArray(payments.captures)
      ? payments.captures
      : [];
  const capture = captures[0];
  if (typeof capture !== "object" || capture === null) {
    throw new Error("PayPal sandbox capture response carried no capture");
  }
  const captureRecord = capture as { id?: unknown; status?: unknown; amount?: unknown };
  if (typeof captureRecord.id !== "string" || captureRecord.id.length === 0) {
    throw new Error("PayPal sandbox capture response carried no capture id");
  }
  const amountRecord =
    typeof captureRecord.amount === "object" && captureRecord.amount !== null
      ? (captureRecord.amount as { currency_code?: unknown; value?: unknown })
      : undefined;
  const amount = typeof amountRecord?.value === "string" ? amountRecord.value : "";
  const currency = typeof amountRecord?.currency_code === "string" ? amountRecord.currency_code : "";
  const status =
    typeof captureRecord.status === "string"
      ? captureRecord.status
      : typeof record.status === "string"
        ? record.status
        : "COMPLETED";
  return { orderId, captureId: captureRecord.id, status, amount, currency };
}
