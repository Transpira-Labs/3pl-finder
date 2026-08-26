import type { Bucket, BucketId, Disposition } from "./types";

/** Buckets that count toward a call's time. Order = display order. */
export const BUCKETS: Bucket[] = [
  { id: "ringing", key: "1", name: "Ringing / dialing", short: "Ringing", sub: "outbound ring", color: "#2563eb" },
  { id: "waiting", key: "2", name: "Waiting room / hold", short: "Waiting", sub: "IVR, hold, queue", color: "#d97706" },
  { id: "right", key: "3", name: "Right person", short: "Right", sub: "the conversation", color: "#059669" },
  { id: "wrong", key: "4", name: "Wrong person", short: "Wrong", sub: "gatekeeper, misroute", color: "#dc2626" },
  { id: "voicemail", key: "5", name: "Voicemail", short: "Voicemail", sub: "leaving / hitting VM", color: "#7c3aed" },
  { id: "noanswer", key: "6", name: "No answer / dead", short: "Dead", sub: "rings out, dead air", color: "#6b7280" },
];

export const BUCKET_IDS = BUCKETS.map((b) => b.id) as BucketId[];

export const DISPOSITIONS: Disposition[] = [
  { id: "booked", key: "b", label: "Booked / meeting" },
  { id: "callback", key: "c", label: "Callback later" },
  // Voicemail and "no contact" both recycle the lead into the rolling Callbacks
  // campaign for a later retry at a different hour (see RECYCLE_DISPOSITIONS and
  // queue/retry-slots.ts).
  { id: "voicemail", key: "v", label: "Voicemail — left message" },
  { id: "not_interested", key: "n", label: "Not interested" },
  { id: "wrong_number", key: "w", label: "Wrong / bad number" },
  { id: "no_contact", key: "x", label: "No contact made" },
  { id: "other", key: "o", label: "Other" },
];

/**
 * Below this many calls, a response rate is noise — 1 for 1 is not a 100% hour.
 * Analytics dims rates under this threshold rather than hiding them.
 */
export const MIN_CALLS_FOR_RATE = 3;

/**
 * Rep dispositions that recycle the lead into the rolling Callbacks campaign for
 * a later retry at a different hour: voicemail and "no contact made" (rang out /
 * didn't pick up). Both re-queue by scheduling a `call` follow-up — the only
 * re-dial path the compliance gate honours once a number has been called.
 */
export const RECYCLE_DISPOSITIONS = ["voicemail", "no_contact"] as const;

/**
 * Total dial attempts a recycled lead gets (across the original and Callbacks
 * campaigns) before it retires — first attempt + 2 retries. The cap is shared
 * across voicemail and no-answer outcomes, counted from the lead timeline.
 */
export const MAX_CALLBACK_ATTEMPTS = 3;

export function emptyAcc(): Record<BucketId, number> {
  return {
    ringing: 0,
    waiting: 0,
    right: 0,
    wrong: 0,
    voicemail: 0,
    noanswer: 0,
  };
}

export function dispositionLabel(id: string | null): string {
  if (!id) return "—";
  return DISPOSITIONS.find((d) => d.id === id)?.label ?? "—";
}

/**
 * RESULT_LABELS — friendly labels written back into the central Google Sheet's
 * `Result` column. Covers BOTH vocabularies: the orchestrator's machine
 * dispositions (non-bridged outcomes) and the rep-selected DISPOSITIONS ids
 * (bridged, finalized in the console). `Queued` is the sentinel the ingester
 * writes on import. `bridged_to_rep` is intentionally absent — the console owns
 * a bridged call's real result. A disposition with no mapping (or null) is left
 * as "Queued" by the caller.
 */
export const SHEET_RESULT_QUEUED = "Queued";
export const RESULT_LABELS: Record<string, string> = {
  // Machine (orchestrator CallOutcome.disposition)
  no_answer: "No answer",
  voicemail: "Left voicemail",
  ivr_giveup: "Couldn't reach (phone menu)",
  hold_timeout: "Couldn't reach (long hold)",
  abandoned_no_rep: "No rep available",
  // Rep-selected (config DISPOSITIONS ids)
  booked: "Booked meeting",
  callback: "Callback scheduled",
  not_interested: "Not interested",
  wrong_number: "Wrong number",
  no_contact: "No contact made",
  other: "Contacted",
};

/** Map an internal disposition to its sheet Result label, or null if unmapped. */
export function resultLabelFor(disposition: string | null): string | null {
  if (!disposition) return null;
  return RESULT_LABELS[disposition] ?? null;
}

/**
 * OUTCOME_TEMPLATES — prefilled one-click call-outcome documentation (spec §3).
 * Each template pre-fills the composer body, advances the lead's pipeline stage,
 * and may suggest a follow-up channel. `do_not_call` additionally routes through
 * the compliance opt-out path (recordOptOut) at log time.
 */
export const OUTCOME_TEMPLATES = [
  { key: "interested",     label: "Interested — send info", body: "Spoke with the lead — interested, send more information.", stage: "qualified",      suggestFollowUp: "email" },
  { key: "callback",       label: "Callback requested",     body: "Lead asked to be called back.",                           stage: "follow_up",      suggestFollowUp: "call"  },
  { key: "meeting",        label: "Meeting booked",         body: "Booked a meeting with the lead.",                         stage: "won",            suggestFollowUp: "email" },
  { key: "voicemail",      label: "Left voicemail",         body: "No answer — left a voicemail.",                           stage: "contacted",      suggestFollowUp: "call"  },
  { key: "no_answer",      label: "No answer",              body: "No answer, no voicemail left.",                           stage: "contacted",      suggestFollowUp: "call"  },
  { key: "wrong_number",   label: "Wrong number",           body: "Number does not belong to this lead.",                    stage: "lost",           suggestFollowUp: null    },
  { key: "not_interested", label: "Not interested",         body: "Lead is not interested.",                                 stage: "lost",           suggestFollowUp: null    },
  { key: "do_not_call",    label: "Do not contact",         body: "Lead asked not to be contacted again.",                   stage: "do_not_contact", suggestFollowUp: null    },
] as const;
export type OutcomeTemplate = (typeof OUTCOME_TEMPLATES)[number];

/** Follow-ups are email-only. (Kept as a named type for the message APIs.) */
export type MessageChannel = "email";

/**
 * MESSAGE_TEMPLATES — prefilled follow-up emails a rep can send after a call,
 * keyed by the SAME key as OUTCOME_TEMPLATES so the outcome the rep tags picks the
 * message. Outcomes that must never trigger an outbound message (wrong number, not
 * interested, do not contact) intentionally have NO template.
 *
 * Bodies use {{name}}, {{company}}, {{rep}} placeholders — see renderTemplate.
 */
export type MessageTemplate = {
  key: string;
  label: string;
  email: { subject: string; body: string };
};

export const MESSAGE_TEMPLATES: MessageTemplate[] = [
  {
    key: "interested",
    label: "Send info",
    email: {
      subject: "Following up on our call",
      body: "Hi {{name}},\n\nThanks for taking the time to speak with me today — it was great learning more about {{company}}. As promised, here's some more information about what we discussed.\n\nHappy to answer any questions or set up a time to go deeper whenever works for you.\n\nBest,\n{{rep}}",
    },
  },
  {
    key: "meeting",
    label: "Confirm meeting",
    email: {
      subject: "Confirming our meeting",
      body: "Hi {{name}},\n\nThanks again for your time on the call — excited to continue the conversation. This note confirms our upcoming meeting; you'll receive a calendar invite separately.\n\nIf you need to reschedule, just reply and we'll find another time.\n\nBest,\n{{rep}}",
    },
  },
  {
    key: "callback",
    label: "Callback confirm",
    email: {
      subject: "Following up as promised",
      body: "Hi {{name}},\n\nThanks for speaking with me — as we discussed, I'll follow up with a call. In the meantime, feel free to reply here with anything you'd like me to cover.\n\nBest,\n{{rep}}",
    },
  },
  {
    key: "voicemail",
    label: "Missed you",
    email: {
      subject: "Sorry I missed you",
      body: "Hi {{name}},\n\nI tried to reach you by phone just now and left a voicemail. I'd love to connect whenever it's convenient — just reply with a good time and I'll make it work.\n\nBest,\n{{rep}}",
    },
  },
  {
    key: "no_answer",
    label: "Tried to reach you",
    email: {
      subject: "Tried to reach you today",
      body: "Hi {{name}},\n\nI tried giving you a call today but couldn't get through. If it's easier, just reply with a good time to connect and I'll give you a ring.\n\nBest,\n{{rep}}",
    },
  },
];

/** Look up a message template by its key (shared with OUTCOME_TEMPLATES). */
export function messageTemplateFor(key: string | null): MessageTemplate | null {
  if (!key) return null;
  return MESSAGE_TEMPLATES.find((t) => t.key === key) ?? null;
}

/**
 * Rep console disposition → outcome/message template key. Shared by the console
 * calls route (for logOutcome) and the client (to pick a follow-up message from
 * the outcome the rep just tagged). "other" has no template → note-only, no send.
 */
export const DISPOSITION_TO_TEMPLATE: Record<string, string> = {
  booked: "meeting",
  callback: "callback",
  voicemail: "voicemail",
  not_interested: "not_interested",
  wrong_number: "wrong_number",
  no_contact: "no_answer",
};

/** The message template a console disposition should prefill, or null if none. */
export function messageTemplateForDisposition(
  dispositionId: string | null,
): MessageTemplate | null {
  if (!dispositionId) return null;
  return messageTemplateFor(DISPOSITION_TO_TEMPLATE[dispositionId] ?? null);
}

/**
 * Fill {{name}}/{{company}}/{{rep}} placeholders. Missing values fall back to a
 * neutral word so a message never reads "Hi ,". Case-insensitive on the token.
 */
export function renderTemplate(
  text: string,
  vars: { name?: string | null; company?: string | null; rep?: string | null },
): string {
  const map: Record<string, string> = {
    name: vars.name?.trim() || "there",
    company: vars.company?.trim() || "your team",
    rep: vars.rep?.trim() || "",
  };
  return text.replace(/\{\{\s*(name|company|rep)\s*\}\}/gi, (_, k: string) =>
    map[k.toLowerCase()],
  );
}
