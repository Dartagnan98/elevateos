# SOP — FINTRAC Individual Identification Information Record

> Owner: Avery (orchestrator)
> Reviewed: 2026-04-29
> Source: FINTRAC Guideline 6 + RECBC member alerts. Confirm against your brokerage's compliance manual; brokerage policy supersedes this SOP.

## When this SOP fires

- Any time a contract of purchase and sale is being drafted or about to be drafted (Pierce flags this).
- Any time a listing presentation is scheduled with a new client.
- Any time the user is preparing to act as agent for a private sale party they have not previously verified.

If you detect any of the above, run this SOP **before** the contract reaches signature. A missed FINTRAC IIR is a brokerage compliance issue, not just a paperwork issue.

## Outcome

A complete Individual Identification Information Record (IIR) on file in the listing folder under `10-disclosures/fintrac/`, dated and time-stamped, with the verification method documented.

## Steps

1. **Identify which party needs verification.**
   - Listing presentation → seller(s).
   - Contract about to be drafted → buyer(s).
   - Both sides on a private sale → both.
   - Corporate party → that's a different record (Beneficial Ownership / Corporation IR), not this SOP.

2. **Check whether an IIR is already on file.**
   ```bash
   # In the listing folder
   ls "Listings/<address>/10-disclosures/fintrac/"
   ```
   If a record exists for this party dated within the brokerage's reverification window (default 24 months), no action needed — log it and exit.

3. **If missing, surface a [HUMAN] task.**
   ```
   Subject: FINTRAC IIR needed for <party name> before <event>
   Body:
     - Party: <full legal name>
     - Listing/contract: <address or deal ID>
     - Event triggering: <listing presentation | contract drafting | other>
     - By when: <event date — 24h ahead at minimum>
     - Verification method options: in-person government photo ID, credit file, dual process
   ```
   Block on this task. Do not let the contract proceed.

4. **Coordinate verification.**
   - User performs the verification (in-person or per brokerage's accepted remote method).
   - User uploads the completed IIR form (PDF) to the listing's Drive folder.
   - User notifies you via Telegram or by replying to the [HUMAN] task.

5. **File the record.**
   - On notification, the gmail-doc-router skill (or you, manually) routes the IIR to `Listings/<address>/10-disclosures/fintrac/<party>-<YYYY-MM-DD>.pdf`.
   - Verify the file is named correctly and the date is the actual verification date, not the upload date.
   - Log a CRM event: `fintrac_iir_filed` with party, date, method.

6. **Mark the [HUMAN] task complete and unblock dependent work.**
   - Notify Pierce that contract drafting can proceed.
   - Notify Avery's deadline tracker so the listing's "verification due" subject is cleared.

## Things that block the SOP

- **Party refuses verification.** Surface to user immediately. Brokerage will pull the agent — this is non-negotiable for FINTRAC reporting.
- **Brokerage policy is stricter than the federal guideline.** Brokerage wins. Read the brokerage's policy doc in the knowledge base before deciding what's "good enough."
- **Remote verification.** BC's accepted methods change periodically. Check the brokerage's current accepted method list before recommending one. When in doubt, default to in-person.

## Related SOPs

- [Listing onboarding — first 48 hours](../marlowe/listing-onboarding.md) — Tier 2
- [Offer presentation prep](../pierce/offer-presentation.md) — Tier 2
- [Closing checklist](../avery/closing-checklist.md) — Tier 2

## Why this SOP exists

FINTRAC fines brokerages, not individual agents. A single missed IIR can trigger an audit. The brokerage's audit trail is built from records like this one — incomplete records put the brokerage on the hook. Avery's job is to make sure no contract reaches signature without the IIR cleared.
