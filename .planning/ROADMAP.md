# Roadmap: Poveda Outreach Tool

## Overview

Fork GTM Pipeline to create Poveda Distributors' outbound sales platform, then layer in a store discovery module powered by Google Maps/Places API. The journey goes: get the project running locally in Docker (Phase 1), wire up the Google Maps backend with proper API key architecture and billing guards (Phase 2), build the discovery UI that lets reps search, view, and push stores into the pipeline (Phase 3), then add saved searches to help reps re-run proven territory searches (Phase 4).

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation** - Fork, Docker Compose, and environment setup so the app runs locally
- [ ] **Phase 2: Google Maps Integration** - API key architecture, schema, service, and routes — the backend that powers discovery
- [ ] **Phase 3: Discovery UI** - Search interface, map/list views, pipeline promotion, and deduplication
- [ ] **Phase 4: Enhancements** - Saved searches so reps can re-run proven territory presets

## Phase Details

### Phase 1: Foundation
**Goal**: The app runs locally via `docker compose up` with all credentials documented
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-05
**Success Criteria** (what must be TRUE):
  1. `docker compose up` starts Postgres (with PostGIS) and the Next.js app without errors
  2. Postgres data persists across `docker compose down` / `docker compose up` cycles (named volumes)
  3. The app does not start if Postgres is not yet healthy (healthcheck gate enforced)
  4. A new developer can copy `.env.example`, fill in credentials, and have the app running — all required keys are documented
  5. The app is a clean fork of GTM Pipeline, browsable at localhost, with no upstream remote references
**Plans**: TBD

Plans:
- [ ] 01-01: Fork GTM Pipeline and configure as independent project
- [ ] 01-02: Docker Compose setup with PostGIS, healthcheck, named volumes, and env template

### Phase 2: Google Maps Integration
**Goal**: The Google Maps backend is live — API keys configured, schema in place, and the Places API search route returns deduplicated store results
**Depends on**: Phase 1
**Requirements**: DISC-01, DISC-02, DISC-08, DISC-11, DISC-12, DATA-01, DATA-02, DATA-03
**Success Criteria** (what must be TRUE):
  1. An admin can configure Google Maps API keys (browser key and server key) via a settings page or environment variable
  2. A POST to the search route with a city + radius returns deduplicated Hispanic grocery store results (by `place_id`) across all 5 default keywords
  3. Results contain only `OPERATIONAL` businesses
  4. The search handles Google's 60-result cap by fetching up to 3 pages via `nextPageToken`
  5. Search results are persisted to the `discovered_stores` staging table before being returned
**Plans**: TBD

Plans:
- [ ] 02-01: Google Maps API key configuration, schema (discovered_stores table + PostGIS), and billing quota setup
- [ ] 02-02: StoreDiscoveryService — multi-keyword fan-out, deduplication, operational filter, pagination
- [ ] 02-03: API routes for search (with two-phase field mask) and settings

### Phase 3: Discovery UI
**Goal**: Reps can search for Hispanic grocery stores, view results in a list and on a map, see which stores are already in the pipeline, and promote individual or multiple stores into the pipeline
**Depends on**: Phase 2
**Requirements**: DISC-03, DISC-04, DISC-05, DISC-06, DISC-07, DISC-10, DATA-04
**Success Criteria** (what must be TRUE):
  1. A rep can type a city/zip, choose a radius, and see a list of stores with name, address, phone, business status, and rating
  2. Results also appear as pins on an embedded Google Map in a sidebar-list + map layout
  3. Stores already in the pipeline show an "Already in pipeline" badge so reps don't re-import them
  4. A rep can click "Add to pipeline" on a single store and it appears in the lead pipeline via LeadIngestionService
  5. A rep can select multiple stores with checkboxes and batch-add them to the pipeline in one action
  6. One-click state filter buttons (GA, FL, SC, NC, TN, AL) pre-populate the search area
**Plans**: TBD

Plans:
- [ ] 03-01: Discovery page layout — search controls, results list view with badges and add buttons
- [ ] 03-02: Map view — Google Maps embed with result pins, sidebar-list + map layout, SE US quick-filter buttons
- [ ] 03-03: Pipeline integration — single add + batch add wired to LeadIngestionService, deduplication by place_id

### Phase 4: Enhancements
**Goal**: Reps can save and re-run named search presets so recurring territory searches don't need to be re-entered every time
**Depends on**: Phase 3
**Requirements**: DISC-09
**Success Criteria** (what must be TRUE):
  1. A rep can save a search (keyword + area + radius) under a custom name
  2. Saved searches appear in a list and can be clicked to instantly re-run the search with the same parameters
  3. A rep can delete a saved search they no longer need
**Plans**: TBD

Plans:
- [ ] 04-01: Saved searches — UI, storage, and re-run logic

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 0/2 | Not started | - |
| 2. Google Maps Integration | 0/3 | Not started | - |
| 3. Discovery UI | 0/3 | Not started | - |
| 4. Enhancements | 0/1 | Not started | - |
