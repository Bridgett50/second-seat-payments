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

/** The real PayPal Checkout REST client for the sandbox environment. */
export function createPayPalSandboxPort(config: PayPalSandboxConfig): PayPalPort {
  const apiBase = config.apiBase ?? PAYPAL_SANDBOX_API_BASE;
  if (!apiBase.includes("sandbox.paypal.com")) {
    throw new Error(
      `refusing a non-sandbox PayPal API base: ${apiBase}. This client is sandbox-only.`,
    );
  }

  async function accessToken(): Promise<string> {
    const basic = Buffer.from(
      `${config.clientId}:${config.clientSecret}`,
      "utf8",
    ).toString("base64");
    const response = await fetch(`${apiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!response.ok) {
      throw new Error(
        `PayPal sandbox token request failed: HTTP ${response.status} ${await response.text()}`,
      );
    }
    const body = (await response.json()) as { access_token?: unknown };
    if (typeof body.access_token !== "string" || body.access_token.length === 0) {
      throw new Error("PayPal sandbox token response carried no access_token");
    }
    return body.access_token;
  }

  return {
    mode: "sandbox",

    async createOrder(
      commitment: PaymentCommitmentInput & { id: string },
    ): Promise<CreatedOrder> {
      const token = await accessToken();
      const description =
        `${commitment.purpose} (payee: ${commitment.payee})`.slice(0, 127);
      const response = await fetch(`${apiBase}/v2/checkout/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": commitment.id,
        },
        body: JSON.stringify({
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
        }),
      });
      if (!response.ok) {
        throw new Error(
          `PayPal sandbox create order failed: HTTP ${response.status} ${await response.text()}`,
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
