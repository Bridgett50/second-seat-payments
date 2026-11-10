# Eval results

Mode: live. These drafts came from a live OpenAI call (gpt-4o-mini-2024-07-18). The call log is local and is not committed. Saved copies are in fixtures/cache for a later recorded run.

AI alone means every draft the drafter returned would be offered for approval. AI plus checker means only a Proven draft is offered. Needs a look stays back unless the owner confirms that draft, and this run does not confirm any. Blocked drafts are never offered.

## Totals

| | AI alone | AI plus checker |
| --- | ---: | ---: |
| Correct payments that reach approval | 16/16 | 15/16 |
| Bad payments that would reach approval | 1 | 0 |

Drafts held for a look: 1. Drafts blocked: 1.

## Per meeting

| Meeting | AI alone correct | AI alone bad | AI + checker correct | AI + checker bad |
| --- | ---: | ---: | ---: | ---: |
| Spring menus for the cafe | 1/1 | 0 | 1/1 | 0 |
| Sink install at the bakery | 1/1 | 0 | 1/1 | 0 |
| Saturday flowers for the shop | 1/1 | 0 | 1/1 | 0 |
| Cheese delivery for the market stall | 2/2 | 0 | 1/2 | 0 |
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

| Trap | Kind | Meeting | Expected | Checker | Reaches approval | Met |
| --- | --- | --- | --- | --- | --- | --- |
| Sam offers a $90 rush fee and Maya says no. | other-party-rejected | Spring menus for the cafe | Blocked | missing | no | no |
| Elena first said $650, then agreed $500 after dropping the disposal. | renegotiated-amount | Sink install at the bakery | Blocked | missing | no | no |
| The $220 quote is about Lena's Flowers, not the landlord. | wrong-payee | Saturday flowers for the shop | Blocked | missing | no | no |
| The cheese price is €150, and a draft records it as 150 US dollars. | currency-mixup | Cheese delivery for the market stall | Blocked | missing | no | no |
| Ben offers 150 Canadian dollars and Lila says no, pay euros. | rejected-currency | Cheese delivery for the market stall | Blocked | missing | no | no |
| Ava says maybe next month she could pay the photographer, if the season picks up. | hypothetical | Market stall permit and a photographer | Blocked | missing | no | no |
| The quote is the real $1,200 sentence, but the draft says $1,500. | amount-not-in-transcript | Shop roof repair | Blocked | missing | no | no |
| The draft quotes a sentence about $1,500 that Rosa never said. | fabricated-quote | Shop roof repair | Blocked | missing | no | no |
| Northwind proposes $2,000 and Helena says she cannot approve it. | other-party-rejected | A rebrand pitch the owner turns down | Blocked | missing | no | no |
| Nina says the same $315 twice, and a second draft would pay it twice. | duplicate | Summer compost pickup, said twice | Blocked | missing | no | no |
| Jonah agrees to an $800 Peak Hall deposit and then cancels it. | cancelled | Recital deposit cancelled, programs kept | Blocked | missing | no | no |
| Helen says 90 for the logo edits and never names a currency. Guessing USD is not proof. | currency-unstated | Logo edits with no currency named | Needs a look | missing | no | no |
| Helen mentions the Grand Hotel, then tells Priya she will pay her $275. | wrong-payee | Chair rental, paid to the person in the room | Blocked | missing | no | no |
| Rosa needs 15 boxes. That count is not a price of $15. | quantity-not-price | Moving boxes are a count, not a price | Blocked | missing | no | no |
| Chris says he is not sure about $900. The draft quotes that sentence instead of the later decision. | unsure-quote | Lighting quote, unsure and then decided | Blocked | missing | no | no |
| Riley offers 560 Canadian dollars and Samir says to keep the bill in dollars. | rejected-currency | Shelves for the workshop | Blocked | missing | no | no |
| Riley suggests a painter for $200 and Samir says not this month. | other-party-rejected | Shelves for the workshop | Blocked | missing | no | no |

## Against the targets

- Bad payments reaching approval with the checker: 0. Target: 0. Met.
- Firm answer-key payments reaching approval with the checker: 15/16. Target: all of them. Not met.
- Planted traps caught (verdict matches the fixture, and the draft does not reach approval): 0 of 17. Not met.
- The stand-in gap target applies to stand-in mode only. This file is a live or recorded run.

Targets for this run: not met.
