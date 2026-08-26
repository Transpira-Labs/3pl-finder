# Telephony Runbook — placing real calls from the browser

Reps call from an in-browser softphone (Twilio Voice JS SDK). This is the exact
path from a fresh Twilio account to a rep's first real call.

## What you need

1. A **Twilio account** → Account SID + Auth Token.
2. A **Twilio phone number** (Voice-enabled), in E.164 — this is the caller ID
   leads see.
3. A **Standard API key** (Twilio console → Account → API keys & tokens). This
   mints each rep's short-lived softphone token; the auth token alone can't.
4. A **TwiML App** (Twilio console → Voice → TwiML Apps → Create). Its **Voice
   Request URL** must be `<PUBLIC_URL>/api/voice/outbound`, method **POST**.
5. A **public HTTPS URL** Twilio can reach. In production that's your Vercel
   domain; locally use `ngrok http 3000`.
6. A **phone you can answer** (playing the lead).

Trial accounts can only call **verified** numbers — verify your test phone first.

## Configure

Copy `.env.example` → `.env` and fill:

```
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxx
TWILIO_API_KEY_SID=SKxxxxxxxx
TWILIO_API_KEY_SECRET=xxxxxxxx
TWILIO_NUMBER=+1XXXXXXXXXX
TWILIO_TWIML_APP_SID=APxxxxxxxx
PUBLIC_URL=https://<your-domain-or-ngrok-id>   # no trailing slash
```

`PUBLIC_URL` matters twice: it's the origin Twilio's webhook signature is
computed over, and it's what `/api/voice/outbound` uses to build the `action`
callback URL. If it's wrong, calls fail with a 403 on signature validation.

**Settings → Connections** shows this live: it reports whether the TwiML App SID
is set and prints the exact Voice Request URL to paste into Twilio.

## Get a lead into the queue

1. On **`/`**, upload a small CSV with one lead whose `phone` is a number you can
   answer. Map `Phone` and `Consent basis`; map `Website` too if your list has
   one. Commit it. (Or add a row to a linked Google Sheet and run
   `npm run ingest` — same gate, same result.)
2. On **`/dashboard`**: create a campaign, then **Assign leads**. Make sure the
   campaign's calling hours include *now* in the lead's timezone, or the gate
   will (correctly) refuse to serve it.

## Place the call

1. Open **`/console`** as a signed-in rep or admin.
2. The softphone panel should read **"Ready to call"**. If it says *Not
   connected*, the error text under it names the missing piece.
3. The lead card shows the next lead. Press **Call**.
4. Your phone rings. Answer it — you're talking to yourself through Twilio.
5. Track the conversation with `1`–`6`, then **End call & save** (`Enter`) and
   pick a disposition. The result lands in Postgres, the lead's source sheet row,
   and the call-log sheet.

## What happens under the hood

| Step | Where |
|---|---|
| Rep is served a lead, claimed to them | `POST /api/queue/next` → `src/lib/queue/service.ts` |
| Rep presses Call — gate runs, `call_attempts` row opens | `POST /api/queue/call-start` |
| Browser connects with only an `attemptId` | `device.connect()` in `src/components/softphone.tsx` |
| Twilio asks what to dial; we resolve the number server-side | `POST /api/voice/outbound` |
| Lead's leg ends; row closes, rep freed | `POST /api/voice/status` |
| Disposition, pipeline, sheet write-back | `POST /api/console/calls` |

## Troubleshooting

- **"Outbound calling isn't configured"** — `TWILIO_TWIML_APP_SID` is unset.
- **403 on `/api/voice/outbound`** — signature validation failed. Nearly always a
  `PUBLIC_URL` that doesn't match the URL Twilio actually called (stale ngrok
  domain, missing/extra trailing slash, http vs https). For local debugging only,
  `TWILIO_SKIP_WEBHOOK_VALIDATION=true` bypasses the check — never in production.
- **The call is rejected immediately** — the compliance gate denied it. Twilio's
  request inspector shows the reason as an XML comment on the response, and
  `audit_log` has the full decision. Usual causes: outside calling hours for the
  lead's timezone, per-lead daily cap, cooldown, or the number already being in
  `contact_ledger`.
- **"This lead is no longer yours"** — the 15-minute claim expired and another
  rep took it. Skip to the next lead.
- **No audio** — the browser needs a user gesture before it will play call audio.
  Clicking Call is one, so this should be self-solving; if not, check that the
  tab has microphone permission.
- **Cost** — `/dashboard` shows live Twilio balance plus outbound-voice and
  softphone-leg spend.

## Recording

Off by default. Set `TWILIO_RECORD_CALLS=true` to record from answer, dual
channel. Two-party consent law varies by state — check before enabling.

## Follow-up email

After a call, the rep can send a prefilled follow-up **email** chosen by the
outcome (`src/components/send-followup.tsx`, opened from the disposition dialog;
also on a pipeline lead's detail). Reps can type a lead's email onto the lead card
mid-call. Every send runs the message compliance gate (`src/lib/messaging/gate.ts`
— eligible lead, recorded consent basis, not unsubscribed), is recorded in the
`messages` table + the `contact_ledger`, and drops a bubble on the lead timeline.

There is **also an SMS path** (`src/lib/sms/`, `/api/sms/*`), offered by a
per-call checkbox on the disposition dialog rather than automatically by outcome.
A call produces at most one follow-up: ticking the SMS box takes precedence, and
the email offer is skipped (`src/components/disposition-host.tsx`). The two paths
have separate gates and separate Twilio/Resend config — see below for email,
and the SMS section for `/api/sms/inbound` + `/api/sms/status` webhook wiring.

### Env

```
# Email (Resend). Verify a sending domain in Resend first.
RESEND_API_KEY=re_xxxxxxxx
FROM_EMAIL="Your Co <followups@mail.your-domain.com>"   # any local-part on the verified domain
REPLY_TO_EMAIL=team@your-domain.com                     # optional; where lead replies go
MAILING_ADDRESS=Your Co, 123 Main St, City, ST 00000   # CAN-SPAM email footer (required)
```

`PUBLIC_URL` is reused to build the unsubscribe link, so it must be set for
unsubscribe to work.

**Settings → Connections** reports whether email is configured.

### Compliance notes

- A send requires a recorded, recognized consent basis on the lead (same set as
  the dial gate).
- Email opt-outs are stored per-address in `email_suppression`, enforced by the
  gate on every send; the unsubscribe link in the footer writes to it.
- As with the dial gate, this enforces *well-formedness*, not legality — you still
  own whether a given lead may be emailed.

## Known gaps

Things that are fine at today's scale (one rep) and will need work before more.

### TODO: a pool of outbound numbers, not one

Every rep dials from the single `TWILIO_NUMBER` (`+14633482683`). That is not a
concurrency problem — the number is only the caller ID stamped on the outbound
leg, so any number of reps can be on calls simultaneously; each call is an
independent bridge between the rep's WebRTC leg and the lead.

The problem is **caller-ID reputation**. Sustained volume from one number is the
exact pattern carrier analytics (STIR/SHAKEN, Hiya, TNS) score as spam. Once a
number is labelled "Spam Likely" answer rates collapse, and a flagged number is
hard to rehabilitate — so this is worth doing *before* the volume that triggers
it, not after.

What it needs:
- A table of owned numbers (number, status, optionally an area code for
  local-presence matching against the lead).
- Selection at dial time in `/api/voice/outbound`, which today reads a single
  `process.env.TWILIO_NUMBER` — that line is the whole seam. Pick per call
  rather than per rep: a lead should see a consistent number across attempts
  (sticky by lead) while the pool spreads total volume.
- A per-number daily cap, so rotation actually spreads load instead of hammering
  whichever number sorts first.
- Health tracking. Answer rate per number is the early warning that one has been
  flagged; a number with a collapsing answer rate should be rested.

A pool of numbers multiplies the inbound setup below — every number in the pool
is one a lead might call back, and each needs its own Voice Request URL.

## Inbound calls (voicemail callbacks)

A lead returning a voicemail hits `POST /api/voice/inbound`, which forwards to
the personal cells set in **Settings → Connections → Inbound calls**. They ring
simultaneously; first to answer takes it.

### Wiring it

1. Settings → Connections → Inbound calls: enter the cells, E.164, comma
   separated. Empty means inbound hangs up.
2. Twilio console → Phone Numbers → your number → **Voice** → *A call comes in*:
   set to `<PUBLIC_URL>/api/voice/inbound`, method **POST**.

Step 2 is on the **number**, not the TwiML App. The TwiML App handles outbound
(what a rep's softphone dials); the number's own Voice Request URL handles
inbound. Setting one does not set the other.

### Design notes

- **Cells, not the softphone.** Callbacks arrive hours after the voicemail, when
  no console tab is open. `incomingAllow` stays `false` on the rep token, so
  nothing routes to the browser. Ringing a client that isn't there would drop
  precisely the calls this exists to catch.
- **No compliance gate.** `checkDialable` governs calls *we* place — hours,
  cooldown, caps, DNC. A lead choosing to ring us is not a dial, and a lead on
  the DNC list may still call back. Running the gate here would reject callbacks
  for arriving outside the window we're allowed to dial in.
- **Still no synthesized audio.** Same invariant as every other path: the TwiML
  only `<Dial>`s or `<Hangup>`s. No greeting, no menu.
- **Caller ID is our own number**, not the lead's — Twilio requires a number the
  account owns, and it keeps the single-sender rule. So the cell screen shows the
  work number; *who* called is answered by the `call_attempts` row, which is
  written before the dial and carries `source: "inbound"`.
- Every inbound call logs to `call_attempts` and `audit_log` whether or not it's
  answered, and is matched to a lead by E.164 when the caller is known.
