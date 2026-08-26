# Implementation Plan — Parallel Dialer + IVR-Escape Sales Tool

> Companion to `specs.md`. This plan sequences the build, names concrete tools with
> cost annotations, and biases hard toward free / open-source. Anything that costs
> money is flagged **💲 COST**.

> **BUILD STATUS (all phases implemented):** Phases 1–8 are built and verified.
> The telephony half (Phases 3–7) runs against a **simulated** `TelephonyProvider`
> — the full orchestration (state machine, IVR navigation, hand-off, governor,
> abandonment) is real and verified end-to-end WITHOUT a carrier. Swapping in a
> real carrier (Twilio or FreeSWITCH/Jambonz + SIP trunk) and real STT is a
> one-file implementation of the provider/classifier interfaces. See
> `SYSTEM_OVERVIEW.md` for the as-built architecture and how to run it.

---

## 0. Guiding principles (decided)

1. **Two-halves architecture.** The system splits along a hard technical seam:
   - **Vercel-native half** — dashboard, CSV ingestion, DB-facing logic. Runs on
     Next.js + serverless. Free-tier for dev.
   - **Always-on half** — telephony orchestration, Media Streams, dial queue,
     concurrency governor. Needs persistent websockets + long-lived worker
     processes, which serverless can't hold. Runs on a separate host.
2. **Build the boring, safe, self-contained half first.** CSV ingestion + the shared
   validation gate has no telephony dependency and is required before any real
   campaign. It's milestone 1 of the *actual* build (the spec's addendum agrees).
3. **Stub external services behind interfaces.** No paid accounts yet. Every paid
   dependency (DNC provider, carrier, STT) sits behind an interface with a no-op or
   fake implementation, so wiring real providers later is a one-file swap.
4. **Free/open-source by default.** Replace Twilio with FreeSWITCH/Asterisk/Jambonz;
   replace Deepgram with Vosk/Silero/Whisper. The only unavoidable costs are
   carrier minutes and (optionally) GPU compute — flagged below.
5. **Compliance is not optional.** DNC scrubbing applies to **live-human** cold calls,
   not just automated ones — the "no synthesized voice" design does **not** exempt
   you from the DNC registry. The gate is stubbed for dev but must be real before
   any live campaign.

---

## 1. Tech stack (with cost flags)

### Vercel-native half (ingestion + dashboard)
| Concern | Choice | Cost |
|---|---|---|
| App framework | Next.js (App Router) + TypeScript | Free (OSS) |
| UI components | shadcn/ui + Tailwind | Free (OSS) |
| File storage | Vercel Blob (private) — for uploaded CSV/XLSX | Free tier; **💲 paid past free storage/egress** |
| Database | Postgres — local Docker for dev; Neon (Marketplace) for cloud | Free (local); Neon free tier, **💲 paid past ~0.5 GB** |
| CSV / Excel parse | streaming `csv-parse`, `xlsx` (SheetJS) | Free (OSS) |
| Phone validation | `libphonenumber-js` | Free (OSS) |
| Timezone from area code | static NANP area-code→timezone table | Free |
| Hosting | Vercel | Hobby free but **💲 not licensed for commercial use → Pro $20/user/mo** |

### Always-on half (telephony) — later phases
| Concern | Choice | Cost |
|---|---|---|
| Telephony engine | **FreeSWITCH** (best media handling) or Asterisk | Free (OSS) |
| Twilio-like API layer | **Jambonz** (open-source CPaaS on FreeSWITCH) | Free (OSS, self-hosted) |
| Carrier / PSTN | SIP trunk: Telnyx, SignalWire, VoIP.ms | **💲 per-minute (~$0.005–0.01/min) — unavoidable** |
| Webhook server | Fastify (Node + TS) | Free (OSS) |
| Dial queue + governor | BullMQ + Redis (local Docker; Upstash on Marketplace) | Free (local); **💲 Upstash paid past free tier** |
| STT (IVR keyword spotting) | **Vosk** (CPU, streaming) | Free (OSS) |
| Human/machine AMD | **whisper-vm-finetune** (fine-tuned Whisper + classifier) | Free (OSS); **💲 GPU compute for low latency** |
| Voice-activity / hold detection | **Silero VAD** + small audio heuristic | Free (OSS) |
| Always-on host | Fly.io / Railway / VPS | **💲 ~$5–20/mo for a small always-on instance** |

**What we deliberately do NOT adopt:**
- VICIdial / GOautodial / ICTDialer — full dialer monoliths that don't do IVR-menu
  navigation (your headline feature) and fight your own compliance/ingestion model.
- AI receptionists (LobbyStack, AIReceptionist, Dograh) — inbound and they *speak*
  to callers, violating the no-synthesized-voice constraint.
- Managed Twilio/Deepgram — replaced by the OSS stack above. (Still fine to use for a
  first spike if you want zero-setup; **💲 per-minute**.)

**Zero-cost dev envelope:** Everything in the Vercel-native half + local Postgres/Redis
runs free. Costs only appear when you (a) deploy commercially, (b) buy carrier minutes,
or (c) run GPU-backed STT.

---

## 2. Build order (phases)

Each phase is independently demonstrable. Phases 1–2 are pure Vercel-native and free.

### Phase 1 — CSV Lead Ingestion + shared validation gate  ← **START HERE**
The addendum's "build first." Delivers the single most useful screen (pre-import report).

**Build:**
1. **Schema & migrations** (Postgres):
   - `leads` (spec §1 + addendum: `ingestion_batch_id`, `raw_source_row jsonb`,
     `validation_status`, `validation_reason`).
   - `ingestion_batches` (filename, uploaded_by, counts, `column_mapping jsonb`).
   - `column_mapping_templates` (per-vendor reusable mappings).
   - `suppression_list` / internal DNC (stub-backed for now).
   - Immutable `audit_log` (append-only).
2. **`LeadIngestionService`** — standalone module, the shared gate every path calls:
   - Phone normalization → E.164 (`libphonenumber-js`); reject invalid; dedupe in-file
     + against existing leads.
   - Consent basis required → missing ⇒ **quarantine**, never silently imported.
   - `DncScrubber` interface + **no-op stub** (real provider later; **💲 when wired**).
   - Timezone derivation from area code if missing.
   - Frequency check (recently contacted / already in active campaign).
   - Every decision → `audit_log`.
3. **Upload flow** (Next.js route + UI):
   - Accept `.csv` / `.xlsx`; stream to **Vercel Blob** (or local disk in dev);
     stream-parse — never load 100k rows in memory.
   - **Column-mapping UI** (shadcn): show detected headers, map to schema, persist
     per-vendor template for auto-map on repeat uploads.
   - **Pre-import report**: `valid | quarantined | DNC-blocked | invalid | duplicates`
     — user confirms before commit.
   - **Commit**: only passing rows become dial-eligible; everything else stored with
     rejection reason, exportable.

**Verify:** upload a messy sample CSV → correct counts in the report → committed
leads have correct E.164 + timezone + validation_status.

**Cost:** $0 (local Postgres, stubbed DNC).

### Phase 2 — Campaign & Lead manager + Compliance gate (dial-side)
Still Vercel-native and free; no telephony yet.

**Build:**
- Campaign CRUD (lead list, rep pool, calling-hours, recording policy, OVERDIAL_RATIO).
- Compliance gate (spec §6) as a **pre-dial** function reusing the same primitives:
  DNC (stub), consent check, calling-hours (8:00–21:00 called-party local),
  opt-out → permanent internal-DNC, frequency caps. All logged immutably.
- **This is the "do not run any campaign before this exists" gate.** Build it real
  (except the DNC provider, which stays stubbed until you contract one).

**Verify:** feed leads through the gate; confirm out-of-hours / no-consent / opt-out
leads are blocked and logged.

**Cost:** $0. (Real DNC provider later is **💲 subscription + per-lookup**.)

### Phase 3 — Telephony spike (always-on service begins)
First code on the separate host. Prove the core mechanic end-to-end.

**Build:**
- Stand up FreeSWITCH (or Jambonz) + a SIP trunk in a test account.
- Fastify webhook server; place one outbound call; start a Media Stream; **inject DTMF**;
  confirm you can detect answer.
- (Fast alternative for a same-day spike: Twilio trial — **💲 per-minute**, but zero
  infra. Swap to FreeSWITCH once proven.)

**Verify:** dial your own cell, hear silence, send a digit, see it logged.

**Cost:** **💲 carrier minutes** (small); optional **💲 always-on host**.

### Phase 4 — Classifier v0
**Build:**
- AMD (human vs machine): **whisper-vm-finetune** or Silero-VAD heuristic.
- Hold-music + IVR-menu detection: **Vosk** streaming keyword spotting + audio
  heuristics.
- Emit `RINGING | IVR_MENU | ON_HOLD | HUMAN | VOICEMAIL | DEAD` events.

**Verify:** call a real IVR; confirm state transitions are labeled correctly.

**Cost:** $0 on CPU (Vosk/Silero); **💲 GPU** if using Whisper AMD for low latency.

### Phase 5 — Human hand-off
**Build:**
- On `HUMAN`: simultaneous ring all free rep phones (`answerOnBridge=true`, ~15s
  timeout); first-answer-wins bridge.
- Rep-ear **whisper** (rep leg only — never toward the lead) with lead identity.
- **Screen-pop** to rep dashboard (websocket) + optional SMS/Slack.
- No rep answers → **abandoned call**, logged against the governor.

**Verify:** trigger a HUMAN event; two rep phones ring; first answer bridges; screen-pop
shows lead context.

**Cost:** **💲 carrier minutes** for the rep legs.

### Phase 6 — Concurrency governor + abandonment tracking
**Build:**
- BullMQ + Redis dial queue.
- Governor: track `freeReps`; release dials only up to `freeReps * OVERDIAL_RATIO`
  (start 1.0). Backpressure when reps fill.
- Rolling 30-day per-campaign abandonment rate; auto-throttle approaching 3% (FCC).

**Verify:** simulate reps filling up; confirm no over-dial; force abandonments; confirm
OVERDIAL_RATIO tightens.

**Cost:** $0 local Redis; **💲 Upstash** if cloud.

### Phase 7 — IVR navigator with menu-map learning
**Build:**
- Per destination-number menu map: `prompt-fingerprint → digit → outcome`.
- Cold-start heuristic (keywords: representative/agent/operator/sales/new customer;
  fallback "0" / stay on line).
- Vosk transcribes menu; scoring function ranks digits by likelihood of reaching a
  human; log decision + outcome to reinforce the map.
- Guard: max `MAX_IVR_LEVELS` then bail.

**Verify:** repeated calls to the same IVR reach a human faster over time.

**Cost:** $0 (reuses Vosk).

### Phase 8 — Dashboard + observability
**Build:**
- Live view: who's on a call, queue depth, incoming hand-offs (screen-pop).
- Rep presence toggle → feeds `freeReps`.
- Disposition capture.
- Metrics: dials/min, human-reach rate, time-to-human, abandonment, hold time,
  answer rate. Structured per-call state-machine timeline logs.

**Cost:** $0 (self-hosted metrics/logs). Managed observability optional **💲**.

---

## 3. Config knobs (from spec)
`OVERDIAL_RATIO`, `MAX_HOLD_SECONDS`, `REP_RING_TIMEOUT`, `MAX_IVR_LEVELS`,
`PER_LEAD_DAILY_CAP`, `CALLING_HOURS`, `RECORDING_POLICY` — all env/DB-configurable.

## 4. Explicitly out of scope
- Any TTS / pre-recorded voice toward leads.
- Voicemail drops (separate compliant module if ever wanted).

## 5. Cost summary (what's actually free vs. not)
- **Free forever:** all app code, Next.js, shadcn, FreeSWITCH/Jambonz/Asterisk, Vosk,
  Silero, Whisper models, libphonenumber-js, local Postgres/Redis, Phases 1–2 & 7–8.
- **💲 Unavoidable once live:** carrier SIP minutes (per-minute, per leg — the dominant
  cost of parallel dialing).
- **💲 Situational:** GPU for Whisper-based AMD; always-on host ($5–20/mo); Vercel Pro
  for commercial use; Neon/Upstash past free tiers; a real DNC-scrub provider
  (subscription + per-lookup) before any live campaign.

## 6. Legal note (from spec, restated)
Cold outbound at scale is the most-litigated area of US consumer law. The tool
*enforces* rules; it can't tell you your legal basis to call a given lead. DNC applies
to live-human calls too. Have counsel review thresholds and consent basis before any
real campaign.
