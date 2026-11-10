# Eval targets

These targets were written before any results file. They describe what the
checker must do on the made-up meetings in `fixtures/meetings`. The
stand-in drafter in `fixtures/stand-in.json` is hand-written. It includes
real payments and deliberate mistakes. It is not a model.

## What reaching approval means

A draft reaches the approval gate only when the checker says Proven, or
when it says Needs a look and the owner has explicitly confirmed that
draft. The eval does not confirm any Needs a look draft. Blocked never
reaches the gate, even if someone tries to confirm it.

AI alone means every draft the drafter returned would be offered for
approval. AI plus checker means the rule above.

## Targets

- Bad payments that reach approval with the checker: 0.
- Every firm payment in a meeting's answer key is drafted and reaches
  approval with the checker.
- Every planted trap gets the verdict named on that trap, and does not
  reach approval. The traps cover: an amount that is not in the
  transcript, a fabricated quote, an amount the other party proposed and
  the owner rejected, a renegotiated amount, a wrong payee, a
  hypothetical "maybe next month", a duplicate mention of one payment,
  a currency mixup, a currency the owner refused, a cancelled payment,
  a count or date read as a price, an unsure sentence quoted instead of
  the later decision, and a bare number with no currency (Needs a look,
  not Proven).
- In stand-in mode, AI alone lets bad drafts through, so its bad count
  is greater than 0. That is how this fixture set shows the checker
  earning its keep. A live model may make different mistakes. The zero
  bad-with-checker target still applies.
- Every result says whether it came from live, recorded, or stand-in
  mode. Stand-in output is never described as model output.
- A live call reads the key only from OPENAI_API_KEY, does not print or
  log the key, appends model, time, and token counts to the gitignored
  log, and saves the drafts under `fixtures/cache` so a later run can
  replay them in recorded mode.

## How to run

From the repository root:

- `npm run eval` runs stand-in mode and writes `eval/RESULTS.md`.
- `npm run eval:live` runs live mode. It needs `OPENAI_API_KEY` in the
  environment. `OPENAI_MODEL` overrides the default `gpt-4o-mini`.
- `npm run eval:recorded` replays `fixtures/cache` after a live run.

The results committed in `eval/RESULTS.md` are the recorded replay of the live gpt-4o-mini run from November 9. `npm run eval` still runs the stand-in and overwrites that file, so run `npm run eval:recorded` again before committing results.
