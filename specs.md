# Parallel Dialer + IVR-Escape Sales Tool — Implementation Spec

## Goal
Save rep time on outbound cold calls by automating the tedious parts: parallel dialing, navigating IVR/"press 3" menus, and holding through waiting rooms. **A human handles 100% of actual conversation.** No artificial/pre-recorded voice is ever played to the called party — the system only injects DTMF tones and stays silent while on hold.

When the system reaches a live human, it rings all available rep phones simultaneously; the first rep to answer is bridged to the lead and shown who the lead is.

## Hard constraints (non-negotiable, build these first)
- **No audio is ever synthesized/played toward the called party.** DTMF injection and silence only. This is the core legal design decision — do not add TTS "please hold" prompts toward the lead.
- **Compliance layer gates every dial** (see §6). A dial that fails any check never leaves the queue.
- **Abandonment governor:** never have more live-human connections pending than free reps. Target FCC ≤3% abandonment; enforce by capping concurrent dials to `freeRepCount * OVERDIAL_RATIO` (start OVERDIAL_RATIO = 1.0, i.e. no overdial, make it a config knob).
- All calls **recorded only where legal**; check called-party state two-party-consent rules before enabling recording per call.

## Stack
- **Telephony:** Twilio Programmable Voice + Media Streams (bidirectional audio for classification, DTMF injection via `<Play digits>` / `sendDigits`).
- **Call-state classifier:** service that consumes the Media Stream and labels each call moment as `RINGING | IVR_MENU | ON_HOLD | HUMAN | VOICEMAIL | DEAD`. Use Twilio AMD for first-pass human/machine, plus a lightweight audio classifier (Deepgram streaming STT + keyword/prosody heuristics, or a small trained model) for IVR-menu detection and hold-music detection.
- **Orchestrator:** Node.js + TypeScript. Fastify for the Twilio webhook server. BullMQ + Redis for the dial queue and concurrency governor.
- **DB:** Postgres (leads, campaigns, call logs, consent ledger, DNC cache, IVR menu-map cache).
- **Rep hand-off:** Twilio `<Dial>` with simultaneous ring to a list of rep numbers; `answerOnBridge=true`; first-answer-wins.

## Architecture / modules

### 1. Campaign & Lead manager
- CRUD for campaigns; each campaign has a lead list, rep pool, calling-hours window, recording policy, OVERDIAL_RATIO.
- Lead schema: `id, phone (E.164), name, company, timezone, source, consent_status, dnc_status, last_contacted, disposition`.

### 2. Dial queue + concurrency governor (BullMQ)
- Pulls eligible leads, runs each through the compliance gate (§6), enqueues dials.
- Governor tracks `freeReps` (reps not currently on a bridged call) in Redis and only releases new dials up to `freeReps * OVERDIAL_RATIO`.
- Backpressure: if reps fill up, pause releasing new dials.

### 3. Call orchestrator (Twilio webhooks)
- Initiates outbound call via Twilio REST API with a Media Stream started on answer.
- State machine per call:
  - `DIALING` → on answer, start classifier stream.
  - Classifier says `IVR_MENU` → §4 IVR navigator picks a digit, inject via `sendDigits`.
  - Classifier says `ON_HOLD` → stay silent, keep alive, poll for state change, enforce max-hold timeout (config, e.g. 8 min).
  - Classifier says `VOICEMAIL` → hang up (do NOT drop a recorded msg unless you've built compliant VM-drop separately), mark disposition.
  - Classifier says `HUMAN` → trigger §5 hand-off immediately.
  - `DEAD` / no-answer / timeout → mark disposition, release rep slot.

### 4. IVR navigator
- Goal: reach a live human as fast as possible.
- Per (destination number) cache a **menu map** learned across calls: `prompt-audio-fingerprint → chosen digit → outcome`. Reinforce choices that historically reached a human fastest.
- Cold start: heuristic — prefer options matching keywords like "representative / agent / operator / sales / new customer"; fall back to "0" or staying on the line.
- Streaming STT transcribes the menu; a scoring function ranks digits by likelihood of reaching a human. Log every decision + outcome to improve the map.
- Guard: max N menu levels then bail to avoid infinite trees.

### 5. Human-reached hand-off
- On `HUMAN` detection, the lead is currently connected to the system with silence.
- Immediately `<Dial>` all free rep phones simultaneously (`answerOnBridge=true`, `timeout` ~15s).
- **First rep to answer wins**; Twilio bridges that rep to the lead; others stop ringing.
- Rep receives lead context out-of-band the instant ringing starts: push a **screen-pop** (websocket to a rep dashboard, or SMS/Slack) with `name, company, campaign, source, notes`. Do NOT play a whisper *toward the lead*; a whisper prompt played only into the *rep's* ear (`<Dial>` with a whisper URL on the rep leg) is fine and recommended so the rep knows who they're talking to before speaking.
- If NO rep answers within timeout → this is an **abandoned call**. Log it (counts against the 3% governor). Politeness: because no audio may be played to the lead, just release; but every abandonment should tighten OVERDIAL_RATIO automatically.

### 6. Compliance layer (gate in front of every dial)
- **DNC scrub:** check number against National DNC + any state lists + internal suppression list. Cache results. Block + log if listed.
- **Consent ledger:** record and check basis-to-call per lead. Block if none where required.
- **Calling-hours gate:** compute called-party local time from lead timezone (derive from area code if unknown); block outside 8:00–21:00 local.
- **Opt-out handling:** any lead who requests no-contact → immediate internal-DNC insert, permanent block.
- **Abandonment tracker:** rolling 30-day per-campaign abandonment rate; expose in dashboard; auto-throttle if approaching 3%.
- **Frequency caps:** per-lead max attempts/day and cooldown.
- All gate decisions are logged immutably (audit trail).

### 7. Rep dashboard
- Live view: who's on a call, queue depth, incoming hand-offs with lead context (screen-pop).
- Rep presence toggle (available/away) feeding `freeReps`.
- Disposition capture after each call.

### 8. Observability
- Metrics: dials/min, human-reach rate, avg time-to-human, abandonment rate, avg hold time, rep answer rate.
- Structured logs per call with full state-machine timeline.

## Build order (milestones)
1. Twilio outbound call + Media Stream echo; confirm you can detect answer and inject DTMF.
2. Classifier v0: AMD + hold-music/human heuristic. Get `HUMAN` detection working end-to-end.
3. Hand-off: simultaneous rep ring, first-answer bridge, rep-ear whisper, screen-pop.
4. Compliance gate (DNC + calling hours + consent + opt-out). **Do not run any real campaign before this exists.**
5. Concurrency governor + abandonment tracking.
6. IVR navigator with menu-map learning.
7. Dashboard + observability.

## Config knobs
`OVERDIAL_RATIO`, `MAX_HOLD_SECONDS`, `REP_RING_TIMEOUT`, `MAX_IVR_LEVELS`, `PER_LEAD_DAILY_CAP`, `CALLING_HOURS`, `RECORDING_POLICY`.

## Explicitly out of scope
- Any TTS/pre-recorded voice toward leads.
- Voicemail drops (separate compliant module if ever wanted).

## Note for the human (not for Claude Code)
This is engineered to avoid the artificial-voice TCPA trigger and to keep abandonment governed, but cold outbound at scale is the most-litigated area of US consumer law. Have counsel review the compliance layer's specific thresholds and your consent basis before running real campaigns. The tool enforces rules; it can't tell you your legal basis to call a given lead.

---

# Addendum: Lead Ingestion — CSV Upload (build first)

## Why CSV first
Leads originate in spreadsheets from list vendors. All four ingestion paths (CSV, CRM sync, REST API, manual) converge on one shared **validation-and-scrub gate**; build that gate as a standalone service (`LeadIngestionService`) and have CSV be its first caller. Do NOT reimplement validation per ingestion path.

## Flow
1. **Upload** — dashboard accepts `.csv` / `.xlsx`. Stream-parse (don't load whole file in memory); vendor lists can be 100k+ rows.
2. **Column mapping UI** — never assume headers. Show detected columns; let the user map to the lead schema: `phone (required)`, `name`, `company`, `timezone`, `source`, `consent_basis (required)`, plus arbitrary `notes`. Persist mappings per vendor as a reusable template so repeat uploads from the same source auto-map.
3. **Row validation** (the shared gate — every row runs all checks):
   - **Phone normalization:** parse to E.164 via `libphonenumber-js`. Reject unparseable/invalid. Dedupe within the file and against existing leads.
   - **Consent basis:** required. Rows without it go to a **quarantine bucket**, not the live list. Never silently import a no-consent row.
   - **DNC scrub at import time:** check National + state + internal suppression. Cache results. Mark `dnc_status`.
   - **Timezone derivation:** if `timezone` missing, derive from area code so the calling-hours gate works later.
   - **Frequency check:** flag numbers contacted recently / already in another active campaign.
4. **Pre-import report** — before anything becomes dial-eligible, show the user a summary: `X valid & dial-eligible | Y quarantined (no consent) | Z blocked (DNC) | W invalid numbers | V duplicates`. User confirms before commit. This is the single most useful screen in the tool — it turns "5,000 uploaded" into an honest "1,900 are actually callable."
5. **Commit** — only rows passing all checks enter the leads table as dial-eligible. Everything else is stored with its rejection reason (audit trail), viewable/exportable so the user can fix and re-upload.

## Schema additions
Lead: add `ingestion_batch_id`, `raw_source_row (jsonb)`, `validation_status (eligible|quarantined|blocked|invalid)`, `validation_reason`.
New table `ingestion_batches`: `id, filename, uploaded_by, row_count, eligible_count, blocked_count, created_at, column_mapping (jsonb)`.

## Libraries
`papaparse` or streaming `csv-parse` for CSV; `xlsx` (SheetJS) for Excel; `libphonenumber-js` for phone norm/validation.

## Explicitly
- No row is dial-eligible until it passes the gate AND the user confirms the pre-import report.
- Quarantined (no-consent) rows are retained but never dialable until a consent basis is supplied.