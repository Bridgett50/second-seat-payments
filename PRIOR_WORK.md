# Prior work

These files were copied unchanged from the public repository
[Bridgett50/second-seat-paypal](https://github.com/Bridgett50/second-seat-paypal)
at commit `8c0778a2930dedb187c083d32d5964c38918971d`:

- `packages/core/src/payments/types.ts`
- `packages/core/src/payments/port.ts`
- `packages/core/src/payments/gate.ts`
- `packages/core/src/payments/demo-port.ts`
- `packages/core/src/payments/index.ts`
- `packages/core/test/payments.test.ts`
- `apps/web/src/paypalSandbox.ts`

The approval gate is the code that holds a drafted payment until the owner
approves or rejects it. The PayPal sandbox client is the code that talks to
PayPal's sandbox when that mode is turned on. The test file is the gate's
own tests.

Everything else in this repository was built during the PayPal AI Hackathon
starting November 9, 2026. That includes the TypeScript project layout, the
small `packages/core/src/index.ts` entry that re-exports only the gate, and
this note.
