# Eval results

Mode: recorded (from live gpt-4o-mini run Nov 9). These drafts were replayed from fixtures/cache. This run did not call OpenAI. The saved copies were produced by an earlier live call (gpt-4o-mini-2024-07-18).

AI alone means every draft the drafter returned would be offered for approval. AI plus checker means only a Proven draft is offered. Needs a look stays back unless the owner confirms that draft, and this run does not confirm any. Blocked drafts are never offered.

## Totals

| | AI alone | AI plus checker |
| --- | ---: | ---: |
| Correct payments that reach approval | 16/16 | 16/16 |
| Bad payments that would reach approval | 1 | 0 |

Drafts held for a look: 1. Drafts blocked: 0.

## Per meeting

| Meeting | AI alone correct | AI alone bad | AI + checker correct | AI + checker bad |
| --- | ---: | ---: | ---: | ---: |
| Spring menus for the cafe | 1/1 | 0 | 1/1 | 0 |
| Sink install at the bakery | 1/1 | 0 | 1/1 | 0 |
| Saturday flowers for the shop | 1/1 | 0 | 1/1 | 0 |
| Cheese delivery for the market stall | 2/2 | 0 | 2/2 | 0 |
| Market stall permit and a photographer | 1/1 | 0 | 1/1 | 0 |
| Shop roof repair | 1/1 | 0 | 1/1 | 0 |
| A rebrand pitch the owner turns down | 0/0 | 0 | 0/0 | 0 |
| Summer compost pickup, said twice | 1/1 | 0 | 1/1 | 0 |
| Recital deposit cancelled, programs kept | 1/1 | 0 | 1/1 | 0 |
| Logo edits with no currency named | 0/0 | 1 | 0/0 | 0 |
| Chair rental, paid to the person in the room | 1/1 | 0 | 1/1 | 0 |
| Moving boxes are a count, not a price | 1/1 | 0 | 1/1 | 0 |
| Flour and labels for the bakery | 2/2 | 0 | 2/2 | 0 |
| Lighting quote, unsure and then decided | 1/1 | 0 | 1/1 | 0 |
| Shelves for the workshop | 2/2 | 0 | 2/2 | 0 |

## Per trap

Traps are matched by payee, amount, and currency, not by stand-in draft ids. Avoided means the drafter never produced that payment. Checker caught means it did, and the checker kept it from approval. Got through means it would reach approval.

| | Count |
| --- | ---: |
| Traps the AI avoided on its own | 16 |
| Traps the AI fell for that the checker caught | 1 |
| Traps that got through | 0 |

| Trap | Kind | Meeting | Expected | Checker | Reaches approval | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| Sam offers a $90 rush fee and Maya says no. | other-party-rejected | Spring menus for the cafe | Blocked | none | no | avoided |
| Elena first said $650, then agreed $500 after dropping the disposal. | renegotiated-amount | Sink install at the bakery | Blocked | none | no | avoided |
| The $220 quote is about Lena's Flowers, not the landlord. | wrong-payee | Saturday flowers for the shop | Blocked | none | no | avoided |
| The cheese price is €150, and a draft records it as 150 US dollars. | currency-mixup | Cheese delivery for the market stall | Blocked | none | no | avoided |
| Ben offers 150 Canadian dollars and Lila says no, pay euros. | rejected-currency | Cheese delivery for the market stall | Blocked | none | no | avoided |
| Ava says maybe next month she could pay the photographer, if the season picks up. | hypothetical | Market stall permit and a photographer | Blocked | none | no | avoided |
| The quote is the real $1,200 sentence, but the draft says $1,500. | amount-not-in-transcript | Shop roof repair | Blocked | none | no | avoided |
| The draft quotes a sentence about $1,500 that Rosa never said. | fabricated-quote | Shop roof repair | Blocked | none | no | avoided |
| Northwind proposes $2,000 and Helena says she cannot approve it. | other-party-rejected | A rebrand pitch the owner turns down | Blocked | none | no | avoided |
| Nina says the same $315 twice, and a second draft would pay it twice. | duplicate | Summer compost pickup, said twice | Blocked | none | no | avoided |
| Jonah agrees to an $800 Peak Hall deposit and then cancels it. | cancelled | Recital deposit cancelled, programs kept | Blocked | none | no | avoided |
| Helen says 90 for the logo edits and never names a currency. Guessing USD is not proof. | currency-unstated | Logo edits with no currency named | Needs a look | Needs a look | no | checker caught |
| Helen mentions the Grand Hotel, then tells Priya she will pay her $275. | wrong-payee | Chair rental, paid to the person in the room | Blocked | none | no | avoided |
| Rosa needs 15 boxes. That count is not a price of $15. | quantity-not-price | Moving boxes are a count, not a price | Blocked | none | no | avoided |
| Chris says he is not sure about $900. The draft quotes that sentence instead of the later decision. | unsure-quote | Lighting quote, unsure and then decided | Blocked | none | no | avoided |
| Riley offers 560 Canadian dollars and Samir says to keep the bill in dollars. | rejected-currency | Shelves for the workshop | Blocked | none | no | avoided |
| Riley suggests a painter for $200 and Samir says not this month. | other-party-rejected | Shelves for the workshop | Blocked | none | no | avoided |

## Against the targets

- Bad payments reaching approval with the checker: 0. Target: 0. Met.
- Firm answer-key payments reaching approval with the checker: 16/16. Target: all of them. Met.
- Traps that got through: 0. Target: 0. Met.
- The stand-in gap target applies to stand-in mode only. This file is a live or recorded run.

Targets for this run: met.
