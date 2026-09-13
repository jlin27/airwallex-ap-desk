# AP Desk

An accounts-payable exception review prototype built on real Airwallex Sandbox bills,
vendors, beneficiaries, balances, FX rates and transfer validation.

An invoice arrives, an agent reads it, server code decides what happens to it, and a
person resolves anything the rules can't clear. No money moves.

## The pipeline

```
1  Intake      an invoice lands in the AP inbox; the model extracts six fields
2  Validate    server checks each field against live Airwallex data
3  Queue       the bill enters Airwallex; exception checks run on arrival
4  Resolve     a person decides, and the reason is recorded
5  Decision    payout instructions validated; a decision record, not a payment
```

## The design decision that matters

**The model cannot express a decision.** `apExplanationSchema` has no `recommendation`,
`priority` or `requiresHuman` field to put one in. `decideApBill()` computes all three
from verified facts and the server attaches them after the model call.

This is structural prevention rather than detection — there is no "check the model's
answer against ours" step, because the model has no way to give a conflicting answer.
The model writes the prose; the server owns every outcome.

Where the model *does* do work no rule could — reading an unstructured invoice — the
guardrails are real and can fail:

| Check | Enforced against |
| --- | --- |
| Vendor exists | `GET /spend/vendors`, exact match only; near misses are suggested, never bound |
| Currency is held | `GET /balances/current` |
| Amount is sane | positive, finite, under a ceiling |
| Invoice number is usable | safe charset, 35-char transfer `reference` limit |
| Low-confidence extraction | routed to a person before a bill can be created |

Every one is re-checked server-side on submit, so a tampered request cannot skip them.

## Exceptions the server raises

- **Duplicate** — matched by invoice number, *or* by same vendor + amount + date within
  10 days, which catches resubmission under a new number
- **Amount change** — 25%+ above the prior average for that vendor
- **Missing beneficiary** — no payout route on the beneficiary record
- **Beneficiary currency mismatch** — the bill's currency isn't what that payee is paid in
- **Insufficient funds** — compared in the funding wallet's currency, converting via
  `GET /fx/rates/current` when the payout currency wallet can't cover it

## Untrusted documents

An invoice is attacker-controllable input. Extraction output is structurally constrained
and every field re-validated, which holds whatever the document says. The model also
reports instruction-like text it sees — surfaced as a signal, explicitly not as a control.

`examples/invoices/05-prompt-injection.txt` carries instructions addressed to the agent.

## Run locally

```bash
npm install
cp .env.example .env    # add Airwallex Sandbox credentials
npm run dev
```

Open `http://localhost:3000`.

`AI_GATEWAY_API_KEY` provides model access. Set `AP_AGENT_LIVE=true` to opt in before
minimized bill facts are sent to a model. With it off, a labelled deterministic fallback
keeps everything working — the server guardrails are identical either way.

## Demo

The app reads and reviews what is already in the Sandbox; it has no seed or reset control.

1. **Intake** — open an inbox message; watch the extraction and the server checks
   - `BPL-2291` is from a vendor that doesn't exist: blocked before anything is written
   - `NC-1150` carries instructions aimed at the agent
2. **Review** — duplicate and amount-change cases can't advance
3. **Resolve** — approve the variance with a reason; see the record that gets written
4. **Decision** — validate the payroll payout; `VALIDATED`, funded across currencies via
   live FX, and an audit trail. No transfer is created.

A bill created by intake can be withdrawn from its detail pane, which returns its inbox
message to unfiled. Nothing else the app does can be undone from the UI.

## Safety boundary

- The model never sees Airwallex IDs, exact wallet balances or credentials
- The model cannot call Airwallex
- Server code owns exception precedence and the human-review gate
- Transfer creation is deliberately absent; `tests/prototype.test.mjs` asserts it stays absent
- The audit actor reads "Demo operator (unauthenticated session)" — there is no auth here,
  and the trail says so rather than signing decisions with an unverified name

## Tests

```bash
npm test     # builds, then runs the suite
npm run lint
```

`ap-agent`, `ap-intake`, `ap-case-status` and `airwallex-route` exercise real code against
Sandbox-shaped fixtures. `prototype.test.mjs` holds source-level invariants only — what
must *not* be present, and that key wiring exists.

## Design

`.design/` holds the screen-flow mockup sources. Rebuild the artboards with
`node .design/build.mjs`.
