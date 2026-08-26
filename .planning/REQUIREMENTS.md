# Requirements: Poveda Outreach Tool

**Defined:** 2026-08-12
**Core Value:** Help Poveda's team discover Hispanic grocery stores and systematically reach out to turn them into wholesale customers.

## v1 Requirements

### Foundation

- [ ] **FOUND-01**: Fork GTM Pipeline repo and set up as independent project
- [ ] **FOUND-02**: Docker Compose setup — `docker compose up` runs Postgres (PostGIS) + Next.js app
- [ ] **FOUND-03**: Postgres healthcheck with `pg_isready` to prevent startup race condition
- [ ] **FOUND-04**: Named Docker volumes for Postgres data persistence
- [ ] **FOUND-05**: Environment variable template (`.env.example`) with all required keys documented

### Store Discovery — Core

- [ ] **DISC-01**: Text search by area — search for stores by keyword + city/zip with configurable radius
- [ ] **DISC-02**: Multi-keyword fan-out — auto-search "bodega", "tienda latina", "mercado latino", "Hispanic grocery", "Latin market" in a single action, deduplicated by `place_id`
- [ ] **DISC-03**: Results list view — name, address, phone, business status, rating for each result
- [ ] **DISC-04**: Map view — pins on Google Maps matching search results, sidebar-list + map layout
- [ ] **DISC-05**: "Already in pipeline" badge — show which results are already in the leads table (match by `place_id`)
- [ ] **DISC-06**: Add to pipeline — single button to promote a discovered store into the lead pipeline via `LeadIngestionService`
- [ ] **DISC-07**: Batch add — select multiple results and add them all to pipeline at once
- [ ] **DISC-08**: Pagination — handle Google Places API 60-result cap across 3 pages with `nextPageToken`

### Store Discovery — Enhancements

- [ ] **DISC-09**: Saved searches — save search presets (keyword + area + radius) to re-run later
- [ ] **DISC-10**: Southeast US quick-filters — one-click buttons for GA, FL, SC, NC, TN, AL
- [ ] **DISC-11**: `discovered_stores` staging table — persist search results for review before pipeline import
- [ ] **DISC-12**: Filter results to `OPERATIONAL` businesses only

### Data & Integration

- [ ] **DATA-01**: Google Maps API key configuration via settings page or environment variable
- [ ] **DATA-02**: Two-key architecture — browser key (referrer-restricted) for Maps JS, server key (IP-restricted) for Places API
- [ ] **DATA-03**: Two-phase field mask — Essentials tier on search, Enterprise tier (phone) only on import
- [ ] **DATA-04**: Discovery deduplication — don't re-import a store already in the pipeline (match by `place_id` on leads table)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Discovery Enhancements

- **DISC-V2-01**: CSV export of search results
- **DISC-V2-02**: Search history / session notes
- **DISC-V2-03**: Pin clustering on map for dense areas
- **DISC-V2-04**: Store rating/review count sorting
- **DISC-V2-05**: Website URL display (Enterprise SKU cost)
- **DISC-V2-06**: Places API response caching in Postgres (30-day per place_id)

### Branding & Infrastructure

- **BRAND-01**: Poveda branding (logo, colors, copy)
- **BRAND-02**: Custom disposition templates for wholesale food context
- **INFRA-01**: Supabase-to-Postgres migration (RLS audit)
- **INFRA-02**: Twilio/SalesHandy webhook tunnel for local Docker

## Out of Scope

| Feature | Reason |
|---------|--------|
| Custom business database | Anti-feature — Google Places is the source of truth |
| ML store scoring | Over-engineering for a 2-3 person team |
| Auto-import without review | Anti-feature — reps must review before importing |
| Map-first UI | Anti-pattern — list is primary, map is supplemental |
| Territory routing | Team is too small for territory management |
| Social media enrichment | Unnecessary complexity, low ROI |
| Phone validation at discovery | Handled by LeadIngestionService on import |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Pending |
| FOUND-02 | Phase 1 | Pending |
| FOUND-03 | Phase 1 | Pending |
| FOUND-04 | Phase 1 | Pending |
| FOUND-05 | Phase 1 | Pending |
| DISC-01 | Phase 2 | Pending |
| DISC-02 | Phase 2 | Pending |
| DISC-03 | Phase 3 | Pending |
| DISC-04 | Phase 3 | Pending |
| DISC-05 | Phase 3 | Pending |
| DISC-06 | Phase 3 | Pending |
| DISC-07 | Phase 3 | Pending |
| DISC-08 | Phase 2 | Pending |
| DISC-09 | Phase 4 | Pending |
| DISC-10 | Phase 3 | Pending |
| DISC-11 | Phase 2 | Pending |
| DISC-12 | Phase 2 | Pending |
| DATA-01 | Phase 2 | Pending |
| DATA-02 | Phase 2 | Pending |
| DATA-03 | Phase 2 | Pending |
| DATA-04 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 21 total
- Mapped to phases: 21
- Unmapped: 0 ✓

---
*Requirements defined: 2026-08-12*
*Last updated: 2026-08-11 — traceability confirmed after roadmap creation*
