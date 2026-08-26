# GTM Console — Unified Frontend

The one unified frontend for outbound GTM: lead ingestion, a keyboard-driven
call console, a lead pipeline, and the admin dialer dashboard — all behind a
single cobalt-railed shell. Implementation of the spec in [`specs.md`](./specs.md),
sequenced by [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md).

**Calling is rep-initiated:** a rep is served one lead at a time and clicks Call,
which dials through their in-browser softphone (Twilio). The former predictive
dialer — dial-ahead loop, answering-machine detection, IVR navigation, screen-pop
hand-off — has been removed; see **`SYSTEM_OVERVIEW.md`** for the as-built
architecture and **`TELEPHONY_RUNBOOK.md`** to place your first real call.

## The four surfaces

Every route lives under the same nav shell:

- **`/` — Leads** — the lead ingestion wizard (this file's focus below).
- **`/console` — Call console** — the keyboard-driven live call console. This
  surface **absorbed the standalone call time tracker** (`../automated_time_tracker`):
  the timer state machine, the `1`–`6`/`Space`/`0`/`Enter` shortcuts, the
  disposition tagging, aggregate stat tiles, CSV export, Google Sheets sync, and
  history management all come from it. History is now server-backed (per rep,
  via `/api/console/calls`), and the console also shows the **lead card** the rep
  calls from — pressing Call starts the timer automatically.
- **`/pipeline` — Pipeline** — lead management workspace (see below).
- **`/dashboard` — Calling dashboard** — admin view: campaigns, reps, queue
  depth, call outcomes, and live Twilio cost. Read-only over the calling itself —
  reps drive that from `/console`.

### Design system

The app uses a lightweight **design system** — Montserrat headings, IBM Plex Mono
for numerics/labels, and a single cobalt accent on quiet white cards.

## Stack (Phase 1)

- Next.js 16 (App Router) + TypeScript + Tailwind — dashboard & API
- Postgres via Drizzle ORM
- `csv-parse` (streaming) + `xlsx` — file parsing
- `libphonenumber-js` — phone E.164 normalization/validation

All free / open-source. See `IMPLEMENTATION_PLAN.md` for the cost breakdown of
later phases (carrier minutes, STT compute, etc.).

## Prerequisites

- Node 20+
- A hosted Postgres — **Supabase** is the default. Create a project, then copy
  both connection strings from Project Settings → Database. A local Postgres
  still works for development; just point `DATABASE_URL` at it.
- A Twilio account for calling (see `TELEPHONY_RUNBOOK.md`).

## Setup

```bash
# 1. copy the env template and fill it in (.env.example documents every var)
cp .env.example .env

# 2. install deps
npm install

# 3. apply the schema — runs against DATABASE_URL_DIRECT, since a transaction
#    pooler can't run DDL
npm run db:migrate

# 4. run
npm run dev   # http://localhost:3000
```

The first person to sign up claims admin on the `/no-access` page.

### Supabase connection strings

`DATABASE_URL` is the **transaction pooler** (`:6543`) with
`DATABASE_POOLED=true`; `DATABASE_URL_DIRECT` is the **direct** connection
(`:5432`). `src/db/index.ts` reads that split and disables prepared statements on
the pooler, which pgBouncer doesn't support.

## Lead ingestion

Open `/` and follow the wizard:

1. **Upload** a `.csv` / `.xlsx` vendor list (stream-parsed).
2. **Map columns** — headers are never assumed; a heuristic pre-fills the mapping,
   and a per-vendor template is remembered for repeat uploads. `phone` and
   `consent_basis` are required.
3. **Pre-import report** — the honest callable count:
   `eligible | quarantined (no consent) | blocked (DNC/suppression) | invalid | duplicates`.
4. **Commit** — only `eligible` rows become dial-eligible; everything else is
   retained with a rejection reason for the audit trail.

### The shared gate

`src/lib/ingestion/service.ts` is the single `LeadIngestionService` gate every
ingestion path must use — the CSV wizard and the Google-Sheet worker are both
callers, and neither reimplements validation:

- **Phone** → E.164 via `libphonenumber-js`; invalid rejected.
- **Consent basis** required → missing ⇒ quarantined, never silently imported.
- **DNC** → external National/state scrub is a stubbed no-op seam
  (`src/lib/ingestion/dnc.ts`); the internal suppression list is real. **A real
  DNC provider must be wired before any live campaign** — DNC applies to
  live-human cold calls too.
- **Timezone** → derived from NANP area code when absent, for the later
  calling-hours gate.
- **Dedupe** → within-file and against existing eligible leads.
- Every commit writes an immutable `audit_log` record.

### Layout

```
src/
  db/                     schema.ts (Drizzle), index.ts (client)
  lib/ingestion/
    service.ts            the shared validation-and-scrub gate + report/commit
    phone.ts              E.164 normalization
    timezone.ts           NANP area-code → IANA timezone
    dnc.ts                DncScrubber interface + stub + internal suppression
    parse.ts              streaming CSV / XLSX parsing
    store.ts              temp staging between validate and commit
    types.ts
  app/
    page.tsx              the upload → map → report → commit wizard
    api/ingest/{upload,validate,commit}/route.ts
```

## Lead Pipeline

`/pipeline` (Rep nav) tracks every generated lead through a stage
(`new → contacted → follow_up → qualified → won | lost | do_not_contact`) and
turns each call into documentation. Left pane: filterable/searchable lead table.
Right pane: a per-lead **activity timeline** rendered as chat bubbles
(rep/outcome bubbles right-aligned, dialer/system bubbles left, stage changes as
centered dividers) with a **composer** — prefilled outcome-template chips plus a
free-text note. Templates that suggest a follow-up reveal an inline scheduler
(call/email, quick date presets). A **follow-up queue** lists pending items by
due date, overdue highlighted, with Done / Snooze / Open-lead actions.

- **Routes:** `GET/POST /api/leads`, `GET/PATCH /api/leads/[id]`,
  `POST /api/leads/[id]/activity` (log outcome + optional follow-up),
  `GET /api/followups`, `PATCH /api/followups/[id]` (done | canceled | snooze).
  Business logic lives in `src/lib/pipeline/{service,ledger}.ts`; routes are thin.
- **Tables** (migration `0004`): `lead_activities` (timeline bubbles),
  `follow_ups` (due queue), `contact_ledger` (dedupe log), plus
  `leads.pipeline_stage`. Outcome vocab is `OUTCOME_TEMPLATES` in
  `src/lib/config.ts`; the `do_not_call` template also calls `recordOptOut()`.

### Contact ledger (the persistent found/called log)

`contact_ledger` is a permanent, cross-session record keyed by E.164 phone, so a
number is never re-found on ingest nor accidentally re-dialed — surviving even if
the original lead row is later quarantined or deleted.

- **Found-side (ingest):** `validateBatch` marks a row `duplicate` when its phone
  is already in the ledger; `commitBatch` upserts a ledger row for every eligible
  inserted lead (`onConflictDoNothing`).
- **Called-side (pre-dial):** `checkDialable` denies `already_contacted`
  (`already_called`) when `callCount > 0` for the phone — **unless** the lead has
  a `pending` `call` follow-up due now. The follow-up queue is the only
  sanctioned re-dial path.
- **Called write:** `/api/queue/call-start` records the ledger the moment a call
  is authorized; standalone console calls record on their insert path. A
  completing call against a pending call follow-up marks that follow-up `done`.

## DB scripts

```bash
npm run db:generate   # generate a migration after editing schema.ts
npm run db:migrate    # apply migrations
npm run db:studio     # Drizzle Studio
```

## License

MIT — see the repository-root [`LICENSE`](../LICENSE).

**Compliance note:** outbound calling is regulated (TCPA/TSR/state law). The
external DNC registry check is a stubbed no-op; wire a real DNC provider and
verify your legal obligations before running any live campaign. See the
disclaimer in the repository-root README.
