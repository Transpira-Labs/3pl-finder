import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  date,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";

/**
 * Validation outcome for a lead row, per spec addendum §"Schema additions".
 *   eligible   — passed every gate check, dial-eligible after user confirms.
 *   quarantined — retained but never dialable (e.g. missing consent basis).
 *   blocked    — on a DNC / suppression list.
 *   invalid    — unparseable/invalid phone or other hard-reject.
 */
export const validationStatusEnum = pgEnum("validation_status", [
  "eligible",
  "quarantined",
  "blocked",
  "invalid",
  "duplicate",
]);

/** DNC scrub result cached per number. `unknown` when the stub hasn't decided. */
export const dncStatusEnum = pgEnum("dnc_status", [
  "clear",
  "listed",
  "unknown",
]);

export const consentStatusEnum = pgEnum("consent_status", [
  "has_basis",
  "missing",
]);

/**
 * Enumerated consent basis (Phase 2 ledger). Replaces trusting free text: a raw
 * consent string is classified into one of these, and only some are a lawful
 * basis to cold-call. `unrecognized` covers text we can't map (e.g. "purchased
 * list") — present but not a valid basis, so it quarantines.
 */
export const consentBasisTypeEnum = pgEnum("consent_basis_type", [
  "express_written",
  "express_oral",
  "existing_business_relationship",
  "inbound_inquiry",
  "unrecognized",
  // Business-to-business dialing basis. Assigned explicitly by the Google-Sheet
  // ingestion path (never inferred from free text); treated as callable so B2B
  // sheet leads pass the consent gate at ingest and at dial time.
  "b2b",
]);

/** Per-call state emitted by the classifier (Phase 3/4). */
export const callStateEnum = pgEnum("call_state", [
  "DIALING",
  "RINGING",
  "IVR_MENU",
  "ON_HOLD",
  "HUMAN",
  "VOICEMAIL",
  "DEAD",
  "BRIDGED",
  "ABANDONED",
]);

export const repPresenceEnum = pgEnum("rep_presence", ["available", "away"]);

/**
 * How a rep takes calls:
 *  - `phone`   — a real phone number the dialer bridges to (admin-added custom rep).
 *  - `browser` — an in-app WebRTC softphone (Twilio Voice SDK). Identity is
 *    `rep_<userId>`; presence is derived from being logged in + a live heartbeat.
 */
export const repKindEnum = pgEnum("rep_kind", ["phone", "browser"]);

/**
 * Auth roles. New signups default to `none` (no access — they see a "pending
 * access" page). An admin promotes them to `rep` (call console only) or `admin`
 * (everything, and can act as a rep). See src/lib/auth.
 */
export const userRoleEnum = pgEnum("user_role", ["none", "rep", "admin"]);

/**
 * users — authentication principals (email/password via Auth.js Credentials).
 * `role` gates access. `repId` links a user to a dialer identity (phone) so reps
 * — and admins acting as reps — can be bridged calls in the console.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull().default("none"),
  repId: uuid("rep_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * pipeline_stage — where a lead sits in the sales pipeline. Every lead starts
 * `new`; reps advance it via outcome logging / manual stage changes.
 */
export const pipelineStageEnum = pgEnum("pipeline_stage", [
  "new",
  "contacted",
  "follow_up",
  "qualified",
  "won",
  "lost",
  "do_not_contact",
]);

/**
 * ingestion_batches — one row per upload. Holds the summary counts shown on the
 * pre-import report and the column mapping actually used for this batch.
 */
export const ingestionBatches = pgTable("ingestion_batches", {
  id: uuid("id").defaultRandom().primaryKey(),
  filename: text("filename").notNull(),
  uploadedBy: text("uploaded_by").notNull().default("dev"),
  rowCount: integer("row_count").notNull().default(0),
  eligibleCount: integer("eligible_count").notNull().default(0),
  quarantinedCount: integer("quarantined_count").notNull().default(0),
  blockedCount: integer("blocked_count").notNull().default(0),
  invalidCount: integer("invalid_count").notNull().default(0),
  duplicateCount: integer("duplicate_count").notNull().default(0),
  // "pending" until the user confirms the pre-import report, then "committed".
  status: text("status").notNull().default("pending"),
  columnMapping: jsonb("column_mapping").$type<ColumnMapping>(),
  // Records dropped before the validation gate ever saw them — currently only
  // Saleshandy prospects with no phone number. Everything else a batch touched
  // is recoverable by joining `leads` on ingestion_batch_id, but these never
  // become leads, so without this they leave no trace at all and the import
  // report can only ever say "54 skipped" without saying which 54.
  skippedRecords: jsonb("skipped_records").$type<SkippedRecord[]>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** A source record dropped before validation, kept so the UI can name it. */
export type SkippedRecord = {
  reason: "no_phone";
  name: string | null;
  email: string | null;
  company: string | null;
  linkedin: string | null;
};

/**
 * leads — the canonical lead table. Rows land here at commit time with a
 * validation_status; only `eligible` rows are dial-eligible. Everything else is
 * retained with a rejection reason for the audit trail / fix-and-reupload flow.
 */
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    phone: text("phone"), // E.164; null when unparseable (validation_status=invalid)
    // Contact email, shown on the rep's lead card. Nullable; phone stays the
    // dial/identity key. Not unique.
    email: text("email"),
    name: text("name"),
    company: text("company"),
    // Shown on the rep's lead card so they can look at the prospect's site
    // before dialing. Free text as provided by the source (may lack a scheme).
    website: text("website"),
    placeId: text("place_id"), // Google Places place_id for discovery dedup
    timezone: text("timezone"), // IANA tz, derived from area code if absent
    source: text("source"),
    consentBasis: text("consent_basis"), // raw text as provided by the vendor
    // Consent ledger provenance (Phase 2): the classified basis type + where/when
    // it was obtained. consent_basis_type = 'unrecognized' is present-but-invalid.
    consentBasisType: consentBasisTypeEnum("consent_basis_type"),
    consentSource: text("consent_source"),
    consentObtainedAt: timestamp("consent_obtained_at", { withTimezone: true }),
    consentStatus: consentStatusEnum("consent_status")
      .notNull()
      .default("missing"),
    dncStatus: dncStatusEnum("dnc_status").notNull().default("unknown"),
    validationStatus: validationStatusEnum("validation_status").notNull(),
    validationReason: text("validation_reason"),
    campaignId: uuid("campaign_id"),
    lastContacted: timestamp("last_contacted", { withTimezone: true }),
    disposition: text("disposition"),
    pipelineStage: pipelineStageEnum("pipeline_stage")
      .notNull()
      .default("new"),
    ingestionBatchId: uuid("ingestion_batch_id").references(
      () => ingestionBatches.id,
    ),
    // First-class free-text notes (from the sheet's Notes column). Previously
    // notes only survived inside rawSourceRow jsonb.
    notes: text("notes"),
    // AI-generated enrichment data (sales brief, products, revenue estimate)
    enrichmentData: jsonb("enrichment_data").$type<Record<string, unknown>>(),
    // Shared-pool claim. When a rep is served this lead it's locked to them so no
    // one else is handed the same prospect. The claim expires (see CLAIM_TTL in
    // lib/queue/service.ts) so a rep who closes their tab doesn't strand leads.
    claimedByRepId: uuid("claimed_by_rep_id"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    // Last time this lead was served to a rep — the queue orders by it so a
    // skipped lead sinks to the back instead of being handed straight back.
    lastServedAt: timestamp("last_served_at", { withTimezone: true }),
    rawSourceRow: jsonb("raw_source_row").$type<Record<string, string>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // A committed eligible number should be unique; dedupe against existing leads
    // is enforced in the service, this index guards it at the DB level too.
    uniqueIndex("leads_phone_eligible_uniq")
      .on(t.phone)
      .where(sql`validation_status = 'eligible'`),
    index("leads_batch_idx").on(t.ingestionBatchId),
    index("leads_validation_status_idx").on(t.validationStatus),
    index("leads_pipeline_stage_idx").on(t.pipelineStage),
    // Serves the calling queue's "next unclaimed eligible lead" scan.
    index("leads_queue_idx").on(t.campaignId, t.validationStatus, t.claimedAt),
    // Case-insensitive lookup by contact email.
    index("leads_email_idx").on(sql`lower(${t.email})`),
    index("leads_place_id_idx").on(t.placeId),
  ],
);

/**
 * column_mapping_templates — remembered per-vendor header→field mappings so
 * repeat uploads from the same source auto-map (spec addendum flow step 2).
 */
export const columnMappingTemplates = pgTable("column_mapping_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  vendor: text("vendor").notNull().unique(),
  mapping: jsonb("mapping").$type<ColumnMapping>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * suppression_list — internal DNC / opt-out list. Numbers here are hard-blocked.
 * The National + state DNC scrub is a stubbed external provider; this internal
 * list is real and used by both import-time scrub and (later) the pre-dial gate.
 */
export const suppressionList = pgTable(
  "suppression_list",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    phone: text("phone").notNull().unique(), // E.164
    reason: text("reason").notNull().default("internal"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("suppression_phone_idx").on(t.phone)],
);

/**
 * audit_log — append-only record of every gate decision (spec §6 "All gate
 * decisions are logged immutably"). Never updated or deleted.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    event: text("event").notNull(), // e.g. "ingest.row.blocked"
    subjectPhone: text("subject_phone"),
    batchId: uuid("batch_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt)],
);

export type ColumnMapping = {
  // maps a lead-schema field to the source column header it was mapped from
  phone: string;
  name?: string;
  company?: string;
  website?: string;
  timezone?: string;
  source?: string;
  consentBasis?: string;
  notes?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2+ : campaigns, reps, call attempts, IVR menu maps
// ─────────────────────────────────────────────────────────────────────────────

/**
 * campaigns — a runnable unit: a lead list + rep pool + calling policy. The
 * config knobs from the spec live here so they're tunable per campaign.
 */
export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    status: text("status").notNull().default("draft"), // draft | active | paused
    // The three knobs the pre-dial compliance gate reads. The predictive-era ones
    // (overdial ratio, max hold, rep ring timeout, max IVR levels) are gone with
    // the auto-dialer — a rep dials one lead at a time, so there is nothing to
    // pace, park or navigate.
    callingHoursStart: integer("calling_hours_start").notNull().default(8), // local hour
    callingHoursEnd: integer("calling_hours_end").notNull().default(21),
    perLeadDailyCap: integer("per_lead_daily_cap").notNull().default(3),
    cooldownMinutes: integer("cooldown_minutes").notNull().default(60),
    recordingPolicy: text("recording_policy").notNull().default("where_legal"),
    // The single rolling "Callbacks" campaign: leads that went to voicemail or
    // didn't pick up are moved here and re-dialed later at a different hour (see
    // ensureCallbackCampaign + queue/retry-slots.ts). The partial-unique index
    // below keeps it singular so ensureCallbackCampaign always resolves one row.
    isCallbackTarget: boolean("is_callback_target").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("campaigns_callback_target_uniq")
      .on(t.isCallbackTarget)
      .where(sql`is_callback_target = true`),
  ],
);

/** reps — the people who get bridged to leads. presence feeds `freeReps`. */
export const reps = pgTable(
  "reps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    // Phone reps only. Browser reps have no number (identity = rep_<userId>).
    phone: text("phone"),
    kind: repKindEnum("kind").notNull().default("phone"),
    // Browser reps link to their user; presence follows login + heartbeat.
    userId: uuid("user_id"),
    lastSeen: timestamp("last_seen", { withTimezone: true }),
    presence: repPresenceEnum("presence").notNull().default("away"),
    // true while bridged to a lead — a busy rep is not "free" even if available.
    onCall: boolean("on_call").notNull().default(false),
    campaignId: uuid("campaign_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // One rep row per user — NULLs (phone reps) are unaffected, Postgres never
  // treats two NULLs as duplicates.
  (t) => [uniqueIndex("reps_user_id_uniq").on(t.userId)],
);

/**
 * campaign_reps — which reps work which campaigns. Many-to-many: a rep can be
 * assigned to several campaigns and pulls leads from all of them.
 *
 * Supersedes `reps.campaign_id`, which allowed only one campaign per rep. That
 * column is kept (the legacy phone reps still carry it) but is no longer read by
 * the queue — `repCampaignIds()` is the single source of truth.
 *
 * Reps are not created by hand any more: every platform user with role `rep` or
 * `admin` is a rep, and their row is upserted by `ensureBrowserRep` on first use
 * or at assignment time, whichever comes first.
 */
export const campaignReps = pgTable(
  "campaign_reps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id").notNull(),
    repId: uuid("rep_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("campaign_reps_uniq").on(t.campaignId, t.repId),
    index("campaign_reps_rep_idx").on(t.repId),
  ],
);

/**
 * call_attempts — one row per outbound dial. Records the full state-machine
 * timeline and the outcome used for metrics + abandonment tracking.
 */
export const callAttempts = pgTable(
  "call_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Nullable so the rep console can log a MANUAL call (no dialer lead/campaign).
    leadId: uuid("lead_id"),
    campaignId: uuid("campaign_id"),
    phone: text("phone").notNull(),
    finalState: callStateEnum("final_state"),
    reachedHuman: boolean("reached_human").notNull().default(false),
    bridged: boolean("bridged").notNull().default(false),
    abandoned: boolean("abandoned").notNull().default(false),
    repId: uuid("rep_id"),
    disposition: text("disposition"),
    timeToHumanMs: integer("time_to_human_ms"),
    holdMs: integer("hold_ms"),
    // full ordered [{state, at}] timeline for observability.
    timeline: jsonb("timeline").$type<{ state: string; at: string }[]>(),
    // Where the record originated: dialer hand-off vs. a manual console call.
    source: text("source").notNull().default("dialer"),
    // Rep-tracked conversation breakdown (ms per bucket: right/wrong/voicemail/
    // noanswer). The dialer's pre-bridge ring/wait/hold stays in holdMs/timeline.
    repBreakdown: jsonb("rep_breakdown").$type<Record<string, number>>(),
    repNote: text("rep_note"),
    syncedToSheet: boolean("synced_to_sheet").notNull().default(false),
    // A rep dispositioning a call "booked" is a claim, not proof. A manager
    // confirms the meeting actually landed on the calendar by verifying it in the
    // Booked meetings queue; the leaderboard shows self-reported vs verified side
    // by side. Only meaningful on rows with disposition = 'booked'.
    bookingVerified: boolean("booking_verified").notNull().default(false),
    bookingVerifiedBy: uuid("booking_verified_by"), // the manager (users.id)
    bookingVerifiedAt: timestamp("booking_verified_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("call_attempts_campaign_idx").on(t.campaignId),
    index("call_attempts_lead_idx").on(t.leadId),
    index("call_attempts_started_idx").on(t.startedAt),
    // Serves the Booked meetings verification queue.
    index("call_attempts_disposition_idx").on(t.disposition),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline : lead activity timeline, follow-up queue, persistent contact ledger
// ─────────────────────────────────────────────────────────────────────────────

/** Kind of a lead-timeline entry — drives how the chat bubble renders. */
export const activityKindEnum = pgEnum("activity_kind", [
  "outcome",
  "note",
  "stage_change",
  "followup",
  "system",
]);

/**
 * lead_activities — append-only per-lead timeline rendered as chat bubbles.
 * Sourced from rep outcome logging, notes, stage changes, follow-up events, and
 * dialer system entries.
 */
export const leadActivities = pgTable(
  "lead_activities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    callAttemptId: uuid("call_attempt_id"),
    repId: uuid("rep_id"),
    kind: activityKindEnum("kind").notNull(),
    templateKey: text("template_key"), // OUTCOME_TEMPLATES key, null for custom
    body: text("body").notNull(), // the bubble text
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("lead_activities_lead_idx").on(t.leadId, t.createdAt)],
);

/** Channel for a follow-up — call the number again, or email someone. */
export const followUpChannelEnum = pgEnum("follow_up_channel", ["call", "email"]);

/** Lifecycle of a follow-up in the due queue. */
export const followUpStatusEnum = pgEnum("follow_up_status", [
  "pending",
  "done",
  "canceled",
]);

/**
 * follow_ups — the due queue. A `pending` `call` follow-up whose `dueAt` has
 * passed is the sanctioned re-dial path past the contact-ledger dedupe gate.
 */
export const followUps = pgTable(
  "follow_ups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    campaignId: uuid("campaign_id"),
    repId: uuid("rep_id"),
    channel: followUpChannelEnum("channel").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    note: text("note"), // for email: who/what to email
    status: followUpStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("follow_ups_status_due_idx").on(t.status, t.dueAt),
    index("follow_ups_lead_idx").on(t.leadId),
  ],
);

/**
 * contact_ledger — THE persistent, universal contact log. Keyed by phone (E.164)
 * so a number is never re-found (ingest) or re-called (dial) across sessions, even
 * if the originating lead row is later quarantined/deleted. It records BOTH
 * outreach channels: `callCount`/`*CalledAt` for dials and `messageCount`/
 * `*MessagedAt` for SMS/email follow-ups, so "has this number been reached out to?"
 * has one answer regardless of channel. The pre-dial gate reads `callCount` to
 * refuse a second call to the same number.
 */
export const contactLedger = pgTable(
  "contact_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    phone: text("phone").notNull(), // E.164
    leadId: uuid("lead_id"), // first lead that claimed this phone
    firstFoundAt: timestamp("first_found_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    firstCalledAt: timestamp("first_called_at", { withTimezone: true }),
    lastCalledAt: timestamp("last_called_at", { withTimezone: true }),
    callCount: integer("call_count").notNull().default(0),
    // Outbound SMS/email follow-ups (any channel) tied to this number's lead.
    firstMessagedAt: timestamp("first_messaged_at", { withTimezone: true }),
    lastMessagedAt: timestamp("last_messaged_at", { withTimezone: true }),
    messageCount: integer("message_count").notNull().default(0),
  },
  (t) => [uniqueIndex("contact_ledger_phone_uniq").on(t.phone)],
);

// ─────────────────────────────────────────────────────────────────────────────
// Messaging : outbound/inbound SMS + email follow-ups after a call
// ─────────────────────────────────────────────────────────────────────────────

/** Channel a follow-up message is sent over. */
export const messageChannelEnum = pgEnum("message_channel", ["sms", "email"]);

/** Whether a message row is one we sent or one that arrived (SMS reply). */
export const messageDirectionEnum = pgEnum("message_direction", [
  "outbound",
  "inbound",
]);

/**
 * Lifecycle of a message. `queued`→`sent` on hand-off to the provider;
 * `delivered`/`failed`/`undelivered` come from provider status callbacks;
 * `received` is the terminal state for an inbound row.
 */
export const messageStatusEnum = pgEnum("message_status", [
  "queued",
  "sent",
  "delivered",
  "failed",
  "undelivered",
  "received",
]);

/**
 * messages — the sent/received follow-up ledger. Every send is recorded here
 * (the row is written BEFORE the provider call, so a crash mid-send still leaves
 * a trace), and provider status callbacks update it by `providerId`. Mirrors the
 * audit posture of the dialer: nothing leaves without a durable record.
 *
 * `toAddress` is the resolved E.164 (sms) or email (email), filled server-side
 * from the lead — the browser never supplies it, same invariant as dialing.
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    leadId: uuid("lead_id"),
    repId: uuid("rep_id"),
    // The call this follow-up came out of, when sent from the console.
    callAttemptId: uuid("call_attempt_id"),
    channel: messageChannelEnum("channel").notNull(),
    direction: messageDirectionEnum("direction").notNull().default("outbound"),
    toAddress: text("to_address").notNull(), // E.164 or email, resolved server-side
    subject: text("subject"), // email only
    body: text("body").notNull(),
    templateKey: text("template_key"), // MESSAGE_TEMPLATES key, null for custom
    providerId: text("provider_id"), // Twilio Message SID / Resend id
    status: messageStatusEnum("status").notNull().default("queued"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("messages_lead_idx").on(t.leadId, t.createdAt),
    index("messages_provider_idx").on(t.providerId),
  ],
);

/**
 * email_suppression — the CAN-SPAM unsubscribe list. The phone `suppression_list`
 * is keyed by E.164 and can't hold an email, so email opt-outs live here. Checked
 * by the message gate before any email send. Keyed lower-cased by the caller.
 */
export const emailSuppression = pgTable(
  "email_suppression",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull().unique(),
    reason: text("reason").notNull().default("unsubscribe"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("email_suppression_email_idx").on(t.email)],
);

/**
 * app_settings — tiny server-side key/value store for singleton config that the
 * admin sets in the UI (rather than env / redeploy). First use: the central lead
 * Google Sheet URL + poller settings for the closed-loop ingester.
 */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});


/**
 * service_status — liveness + desired on/off for the standalone worker processes
 * (ingest, telephony), surfaced in the admin "Services" panel.
 *  - `heartbeatAt`: each worker upserts this every loop; the UI shows "alive" when
 *    it's fresh (within the alive window).
 *  - `enabled`: desired state the worker obeys — on = doing work, off = idling.
 *    The process keeps running either way; the toggle pauses/resumes the job.
 */
export const serviceStatus = pgTable("service_status", {
  service: text("service").primaryKey(), // currently just "ingest"
  enabled: boolean("enabled").notNull().default(true),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  detail: jsonb("detail").$type<Record<string, unknown>>(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Call analytics : the daily journal + cached agent-written reports
// ─────────────────────────────────────────────────────────────────────────────

/**
 * daily_notes — "what I did differently today", one row per calling day.
 *
 * `day` is a plain date in the reporting timezone (app_settings.analytics_timezone),
 * NOT a UTC timestamp: an 8pm ET call is stored as tomorrow in UTC, and bucketing
 * on the raw timestamp would file it under the wrong day.
 *
 * `tags` are normalized kebab-case labels for what you changed that day (e.g.
 * "new-opener", "called-mornings"). They're what makes cross-day comparison
 * possible — the trend view compares days sharing a tag against days without.
 */
export const dailyNotes = pgTable("daily_notes", {
  id: uuid("id").defaultRandom().primaryKey(),
  day: date("day").notNull().unique(),
  note: text("note").notNull(),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});


/**
 * Delivery lifecycle of an outbound follow-up text, mirroring Twilio's message
 * statuses (intermediate states like "sending" collapse into queued).
 */
export const smsStatusEnum = pgEnum("sms_status", [
  "queued",
  "sent",
  "delivered",
  "undelivered",
  "failed",
]);

/**
 * sms_messages — every follow-up text a rep approved and sent. A row exists
 * only for actual sends (cancelled drafts leave nothing); `draftBody` keeps
 * what the model proposed so edits are auditable against what went out.
 */
export const smsMessages = pgTable(
  "sms_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    callAttemptId: uuid("call_attempt_id"),
    repId: uuid("rep_id"),
    toPhone: text("to_phone").notNull(), // E.164
    fromPhone: text("from_phone").notNull(),
    draftBody: text("draft_body").notNull(),
    body: text("body").notNull(),
    status: smsStatusEnum("status").notNull().default("queued"),
    twilioSid: text("twilio_sid"),
    errorCode: integer("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true }),
  },
  (t) => [
    index("sms_messages_lead_idx").on(t.leadId),
    index("sms_messages_twilio_sid_idx").on(t.twilioSid),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// Store Discovery : Google Maps/Places API store finder
// ─────────────────────────────────────────────────────────────────────────────

export const discoveryStatusEnum = pgEnum("discovery_status", [
  "pending",
  "imported",
  "skipped",
  "duplicate",
]);

/**
 * discovered_stores — staging table for Google Places API results. Stores land
 * here after a search, and reps review + promote them into the leads table via
 * LeadIngestionService. place_id is the Google-stable dedup key.
 */
export const discoveredStores = pgTable(
  "discovered_stores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    placeId: text("place_id").notNull(),
    name: text("name").notNull(),
    address: text("address"),
    phone: text("phone"), // E.164 or local format from Google
    lat: text("lat"),
    lng: text("lng"),
    rating: text("rating"),
    userRatingCount: integer("user_rating_count"),
    businessStatus: text("business_status"), // OPERATIONAL, CLOSED_TEMPORARILY, etc.
    types: jsonb("types").$type<string[]>(), // Google place types
    searchQuery: text("search_query"), // the query that found this store
    status: discoveryStatusEnum("status").notNull().default("pending"),
    importedLeadId: uuid("imported_lead_id"), // links to leads.id after import
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("discovered_stores_place_id_uniq").on(t.placeId),
    index("discovered_stores_status_idx").on(t.status),
  ],
);

/**
 * saved_searches — named search presets so reps can re-run proven territory
 * searches without re-entering parameters.
 */
export const savedSearches = pgTable("saved_searches", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  query: text("query").notNull(), // search keywords
  location: text("location").notNull(), // city, zip, or area
  radiusMiles: integer("radius_miles").notNull().default(25),
  userId: uuid("user_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Store Lists : named collections of discovered stores for outreach planning
// ─────────────────────────────────────────────────────────────────────────────

/**
 * store_lists — named collections of discovered stores. E.g. "Duluth area
 * bodegas" or "I-85 corridor". Independent of the pipeline — a store can be
 * in a list AND in the pipeline simultaneously.
 */
export const storeLists = pgTable("store_lists", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  userId: uuid("user_id"),
  storeCount: integer("store_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * store_list_items — join table linking store_lists to discovered_stores.
 * Caches key fields for table display without re-joining. `position` tracks
 * visit order (set by route optimization).
 */
export const storeListItems = pgTable(
  "store_list_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    listId: uuid("list_id")
      .notNull()
      .references(() => storeLists.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => discoveredStores.id, { onDelete: "cascade" }),
    // Cached from discovered_stores + enrichment for fast table display
    storeName: text("store_name").notNull(),
    storeAddress: text("store_address"),
    storePhone: text("store_phone"),
    storeLat: text("store_lat"),
    storeLng: text("store_lng"),
    storeRating: text("store_rating"),
    ownerName: text("owner_name"),
    ownerPhone: text("owner_phone"),
    // Visit ordering (set by route optimization)
    position: integer("position"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("store_list_items_list_store_uniq").on(t.listId, t.storeId),
    index("store_list_items_list_idx").on(t.listId),
  ],
);
