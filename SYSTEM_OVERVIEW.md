# System Overview (as built)

A GTM platform with three surfaces behind one nav shell: **lead ingestion**, a
**rep call console**, and an **admin dashboard**. Calling is **rep-initiated**:
a rep is served one lead at a time and clicks Call. Nothing dials on its own.

> Historical note: this used to be a *predictive* dialer — a worker loop dialed
> ahead of the reps, machine-detected whether a human answered, navigated IVRs,
> and screen-popped whoever was free. That entire subsystem (engine, orchestrator,
> governor, abandonment, hand-off, classifier, IVR navigator, Media Stream
> websocket, and the always-on telephony server) has been **deleted**. It exists
> in git history if you ever need it back. `specs.md` and `IMPLEMENTATION_PLAN.md`
> describe that older design and are kept as history, not as current truth.

## How a call happens

```
Lead list (Saleshandy prospects, or any CSV export)
        │
        ├── Saleshandy ───► ingest worker (npm run ingest / /api/cron/ingest)
        └── CSV ──────────► upload wizard at /
                     │
        LeadIngestionService — the one validation gate
        (phone→E.164, consent, DNC scrub, timezone, dedupe, audit)
                     ▼
                  leads table
                     │
   rep opens /console ──► POST /api/queue/next
                     │      claims one lead: UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)
                     ▼
              Lead card: name · company · phone · website · notes
                     │        [ Call ]        [ Skip ]
                     ▼
          POST /api/queue/call-start   → checkDialable() → call_attempts row → attemptId
                     ▼
          softphone: device.connect({ attemptId })       (no phone number leaves the browser)
                     ▼
          POST /api/voice/outbound   TwiML App webhook, Twilio-signature verified
                     │  resolves attemptId → the lead's stored E.164, re-runs the gate
                     ▼  <Dial answerOnBridge> the lead
          POST /api/voice/status     ← the lead's leg ended: close the row, free the rep
                     ▼
          rep dispositions → /api/console/calls → Postgres (+ call-log Sheet export)
```

Everything above runs in Next.js. There is **no always-on process** for calling —
the two Twilio touchpoints are ordinary stateless routes.

## Run it

```bash
npm install
npm run db:migrate     # against DATABASE_URL_DIRECT (see .env.example)
npm run dev            # http://localhost:3000
```

Background worker (a separate process, not needed to place calls):

```bash
npm run ingest         # poll Saleshandy for new prospects
```

Surfaces:

- **`/`** — lead ingestion wizard (upload → map → pre-import report → commit).
- **`/console`** — the rep's screen: softphone, lead card, stopwatch, history.
  Also has a **solo mode** (no rep, no DB, no queue — a bare stopwatch backed by
  `localStorage`). The seam is `SOLO_REP_ID` in `src/hooks/useCallTracker.ts`.
- **`/pipeline`** — lead management: table, activity timeline, follow-up queue.
- **`/dashboard`** — admin: campaigns, reps, queue depth, outcomes, Twilio cost.
- **`/analytics`** — admin: per-day call statistics + the "what I did differently"
  journal, whose tags drive day-cohort comparison.
- **`/settings`** — integration health + runtime config (call-log sheet, Saleshandy).

## Module map

```
src/lib/
  ingestion/        parse, phone→E.164, timezone, DNC seam, consent classification,
                    the shared validation gate, report/commit, saleshandy-source
  compliance/
    predial.ts      dial-time gate — eligibility, consent, DNC recheck, calling
                    hours (called-party local time), frequency cap, cooldown
  queue/
    service.ts      the shared calling queue: claim-on-serve (FOR UPDATE SKIP
                    LOCKED), claim expiry, gate-checked candidates, skip/release
    session-rep.ts  resolves the calling identity from the session, never the body
  telephony/
    webhook.ts      Twilio signature verification + TwiML helpers
  campaigns/
    service.ts      campaign/rep CRUD, presence, lead assignment
  observability/
    metrics.ts      calls, connect rate, avg call length, disposition breakdown
  pipeline/
    service.ts      list/detail, setStage, logOutcome, follow-ups
    ledger.ts       contact_ledger read/write (recordFound/Called)
  analytics/
    stats.ts        per-day call statistics, comparisons, tag cohorts (all SQL)
    service.ts      the daily journal + tags that make days comparable

src/app/api/
  queue/{next,skip,call-start}   the rep's queue
  voice/{outbound,status}        the only Twilio-facing routes
  console/calls                  call history + disposition finalize
  ingest/{upload,validate,commit}
  campaigns/…, leads/…, followups/…, telephony/{token,me,heartbeat,cost}
```

## Lead pipeline + contact ledger

Every lead carries a `pipeline_stage`
(`new → contacted → follow_up → qualified → won | lost | do_not_contact`).
`/pipeline` renders each call as chat-bubble activity (`lead_activities`) with a
prefilled-template composer (`OUTCOME_TEMPLATES` in `config.ts`) and a follow-up
due queue (`follow_ups`).

`contact_ledger` is the permanent found/called log keyed by E.164 phone,
independent of the lead row's lifecycle:

- **Ingest** marks ledger-known phones `duplicate`.
- **Pre-dial** `checkDialable` denies `already_contacted` when `callCount > 0`,
  unless a pending `call` follow-up is due — the follow-up queue is the only
  sanctioned re-dial path.
- **Call start** (`/api/queue/call-start`) writes the "called" ledger row the
  moment a call is authorized, so the number can't be dialed from another list.

## Deployment shape

Entirely Vercel-native. The app is stateless; state lives in hosted Postgres
(Supabase — see `.env.example` for the pooler-vs-direct connection split). One
Vercel cron runs lead ingestion nightly. Nothing else runs on a schedule.

## Hard constraints honored

- **No synthesized audio to the lead.** The TwiML we emit only `<Dial>`s or
  `<Hangup>`s — there is no `<Say>` or `<Play>` on any path a lead can hear.
- **Compliance gates every dial.** `checkDialable` runs when a lead is served,
  again at call-start, and once more in `/api/voice/outbound` before a number is
  dialed. Every decision is written to `audit_log`.
- **The browser never supplies a phone number.** It holds only an `attemptId`;
  the number is resolved server-side. A rep cannot dial an arbitrary number
  through the Twilio account.
- **Twilio webhooks are signature-verified.** `TWILIO_SKIP_WEBHOOK_VALIDATION`
  exists only for local tunnel debugging.
- **DNC is still stubbed.** The external registry is a no-op seam
  (`src/lib/ingestion/dnc.ts`); internal suppression is real. **A real DNC
  provider must be wired before any live campaign.**
