# Poveda Outreach Tool

## What This Is

A full-featured outbound sales platform for Poveda Distributors — a Hispanic food & beverage wholesale distributor based in Duluth, GA. Forked from Transpira Labs' GTM Pipeline, rebranded for Poveda, with all existing capabilities retained (Twilio browser calling, SalesHandy integration, pipeline management, analytics, compliance gates) plus a new **store discovery** feature powered by Google Maps/Places API to help find Hispanic grocery stores and bodegas across the Southeast US.

## Core Value

Help Poveda's team discover Hispanic grocery stores they didn't know existed and systematically reach out — by phone, email, or in person — to turn them into wholesale customers.

## Requirements

### Validated

These come from the forked GTM Pipeline codebase — already built and working:

- ✓ Lead ingestion via CSV/XLSX upload with validation (phone normalization, dedup, consent, DNC) — existing
- ✓ SalesHandy integration for lead import (daily cron pull) — existing
- ✓ Browser-based calling via Twilio softphone (rep-initiated, one lead at a time) — existing
- ✓ Call queue with claim logic (FOR UPDATE SKIP LOCKED) — existing
- ✓ Pre-dial compliance gates (consent, DNC, calling hours, frequency cap) — existing
- ✓ Pipeline view with stages (new → contacted → follow_up → qualified → won/lost/do_not_contact) — existing
- ✓ Lead detail with activity timeline (outcomes, notes, stage changes) — existing
- ✓ Follow-up queue (due today, by channel) — existing
- ✓ Disposition tagging and outcome templates — existing
- ✓ Per-day call analytics and journal — existing
- ✓ Rep leaderboard with booking verification — existing
- ✓ Admin dashboard (KPI tiles, rep presence, live call feed) — existing
- ✓ Campaign management (create, assign leads, assign reps) — existing
- ✓ Email follow-ups via Resend (CAN-SPAM compliant) — existing
- ✓ SMS follow-ups via Twilio — existing
- ✓ AI-drafted SMS templates (Claude API) — existing
- ✓ Google Sheets call log export (daily cron) — existing
- ✓ Multi-user auth with roles (admin, rep) — existing
- ✓ Contact ledger for cross-session deduplication — existing
- ✓ Immutable audit log — existing

### Active

- [ ] Store discovery via Google Maps/Places API — search for Hispanic grocery stores, bodegas, Latin markets by geographic area
- [ ] Discovery-to-pipeline flow — add discovered stores directly into the lead pipeline
- [ ] Search by geographic area — target Southeast US (GA, FL, SC, NC, TN, AL) with expandable radius
- [ ] Discovery deduplication — don't import a store that's already in the pipeline (match by phone or address)
- [ ] Poveda branding — rebrand UI (logo, colors, copy) from "GTM Console" to Poveda identity
- [ ] Docker-based local deployment — `docker compose up` runs everything (Postgres + Next.js app)
- [ ] Poveda-specific outcome templates and dispositions — customize rep vocabulary for wholesale food distribution context
- [ ] Settings page for Google Maps API key configuration

### Out of Scope

- Predictive dialing / auto-dial — removed from GTM pipeline already, not re-adding
- Inbound call routing / IVR — Poveda doesn't need a call center
- Product catalog management — Poveda manages inventory separately (Squarespace store)
- Order management / invoicing — separate system
- Route planning / delivery logistics — separate concern
- Vercel deployment — running locally via Docker only for now

## Context

- **Source codebase:** Transpira Labs' GTM Pipeline (github.com/Transpira-Labs/gtm_pipeline) — Next.js 16, Drizzle ORM, Postgres, Twilio, 24 DB tables, full compliance stack
- **Current state:** Poveda has no outbound tooling — broken Squarespace site, single contact form, word-of-mouth only. Biggest pain is discovering stores to sell to.
- **Team:** Hugo Poveda (founder, Colombian heritage) + 1-2 people. Founded 2019. ~500 product SKUs (beverages, chips, Colombian/Venezuelan products, comestibles, condiments, sauces, sweets, pharmacy/herbal).
- **Target customers:** Hispanic grocery stores, bodegas, Latin markets across the Southeast US (GA, FL, SC, NC, TN, AL)
- **Value prop for stores:** Competitive wholesale pricing on ~500 authentic Latin American products with direct delivery
- **SalesHandy:** Will get a subscription — keeps the existing lead import pipeline intact
- **Twilio:** Will set up an account — keeps browser-based calling capability

## Constraints

- **Tech stack**: Next.js 16 (App Router) + TypeScript + Tailwind CSS + Drizzle ORM + Postgres — inherited from GTM Pipeline
- **Deployment**: Local-first via Docker Compose (Postgres + Next.js app)
- **API dependencies**: Google Maps/Places API (store discovery), Twilio (calling + SMS), Resend (email), SalesHandy (lead import), Anthropic (AI SMS drafting)
- **Team size**: Must be simple enough for a non-technical founder to use
- **Source repo**: Fork of GTM Pipeline — maintain compatibility with upstream patterns where possible

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fork GTM Pipeline instead of building fresh | Full capabilities already built (calling, pipeline, analytics, compliance). Adding discovery on top is faster than rebuilding from scratch | — Pending |
| Keep all GTM Pipeline features | Poveda can use SalesHandy, Twilio calling, email/SMS follow-ups, analytics — full toolkit even if they start with just discovery + pipeline | — Pending |
| Add Google Maps/Places API store discovery | Poveda's core bottleneck is finding stores. This directly solves it and doesn't exist in the original GTM pipeline | — Pending |
| Docker Compose for local deployment | One-command setup for a non-technical team; avoids Vercel deployment complexity | — Pending |
| Rebrand but don't restructure | Change branding (logo, colors, copy, templates) without changing the app's architecture or component structure | — Pending |

---
*Last updated: 2026-08-12 after direction change to fork GTM Pipeline*
