# Architecture: Store Discovery Integration

**Domain:** Brownfield — adding Google Maps/Places store discovery to GTM Pipeline fork
**Researched:** 2026-08-11
**Confidence:** HIGH (API capabilities verified via official docs, integration pattern follows established codebase conventions)

---

## Overview

The store discovery feature adds a new vertical slice to the existing GTM Pipeline architecture. The design principle: discovery is a separate pre-pipeline stage. Discovered stores sit in a `discovered_stores` staging table until a rep promotes them to the live lead pipeline via the existing `LeadIngestionService`. No existing tables, routes, or services are modified.

```
Google Places API
      │
      ▼
StoreDiscoveryService          (lib/services/discovery.ts)
      │
      ├── discovered_stores table   (staging, not leads)
      │
      ▼
LeadIngestionService           (lib/services/ingestion.ts — unchanged)
      │
      ▼
leads table                    (existing, unchanged)
```

---

## New Components

### 1. Service Layer: `lib/services/discovery.ts`

Single new service file. Encapsulates all Google Places API calls. Pattern matches existing services (ingestion.ts, telephony.ts, etc.).

**Responsibilities:**
- Execute Text Search (New) against Places API
- Accept `textQuery` (e.g., "Hispanic grocery store Atlanta GA") and optional `locationBias` circle
- Return normalized `DiscoveredStore[]` objects
- De-duplicate across multiple queries in a single search session by `placeId`
- Never write directly to `leads` — returns data for the route handler to store in `discovered_stores`

**Key implementation details:**

The Places API (New) uses Text Search as the primary mechanism. Nearby Search is available but requires a circle center + radius; Text Search is more flexible and handles city/state area queries that reps will naturally type. Use Text Search for the discovery UI.

Field mask for each request (only request fields needed — controls billing tier):
```
places.id,places.displayName,places.formattedAddress,places.location,
places.nationalPhoneNumber,places.websiteUri,places.regularOpeningHours,
places.types
```

Note: `nationalPhoneNumber` and `websiteUri` are Enterprise tier fields — they add cost per result. They are included because phone number is required for LeadIngestionService and is the primary dedup key against the existing `leads` table.

**Pagination:** Text Search (New) returns max 20 results per page, max 60 total (3 pages). The `nextPageToken` from a response is passed back into the next request. Token must not be used within ~2 seconds of receipt — implement a 2-second delay between paginated calls. For a discovery UI, fetching page 1 (20 results) on initial search is sufficient; expose a "Load more" flow if needed.

**Multi-query dedup:** Hispanic grocery stores require multiple search terms to surface all results (`"tienda latina"`, `"bodega"`, `"mercado latino"`, `"hispanic grocery"`). Run queries sequentially, accumulate results in a Map keyed by `placeId`. This eliminates cross-query duplicates before returning.

**npm package:** Use `@googlemaps/google-maps-services-js` for server-side calls. It is the official Node.js client, maintained by Google, and works in Next.js API routes and Server Actions. Do not use `@googlemaps/places` (in preview, unstable as of 2026-08). Do not call the REST endpoint manually — the SDK handles retries and auth.

---

### 2. Database: `discovered_stores` table

New staging table. Never replaces `leads`. Acts as a review queue.

```sql
CREATE TABLE discovered_stores (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id        text NOT NULL UNIQUE,         -- Google Place ID, primary dedup key
  name            text NOT NULL,
  formatted_address text NOT NULL,
  phone           text,                          -- normalized E.164 via same util as ingestion
  website         text,
  lat             numeric(10,7),
  lng             numeric(10,7),
  place_types     text[],                        -- e.g. ["grocery_store","food_store"]
  raw_payload     jsonb,                         -- full Places API response, for re-processing
  status          text NOT NULL DEFAULT 'pending',
                  -- pending | imported | skipped | duplicate
  lead_id         uuid REFERENCES leads(id),    -- set when imported
  searched_query  text,                          -- the textQuery that found this store
  searched_area   text,                          -- human label e.g. "Atlanta, GA"
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_discovered_stores_status ON discovered_stores(status);
CREATE INDEX idx_discovered_stores_place_id ON discovered_stores(place_id);
```

**Drizzle schema file:** `lib/db/schema/discovered-stores.ts` (follow existing schema file naming convention).

**Migration:** Additive DDL — `drizzle-kit generate` produces a new migration file with only `CREATE TABLE` and `CREATE INDEX` statements. Zero risk to existing 24 tables.

---

### 3. API Routes

Three new route handlers under `app/(app)/api/discovery/`. Pattern matches existing `app/(app)/api/` routes.

```
app/(app)/api/discovery/
  search/route.ts       POST  — calls StoreDiscoveryService, returns results (does not persist)
  stores/route.ts       GET   — list discovered_stores (filterable by status/area)
  stores/[id]/route.ts  PATCH — update status (import → calls LeadIngestionService, skip, etc.)
```

**POST `/api/discovery/search`**

Request body:
```typescript
{
  queries: string[];      // ["tienda latina Atlanta GA", "bodega Atlanta GA"]
  area: string;           // human label for display: "Atlanta, GA"
  locationBias?: {        // optional center + radius for Places API locationBias
    lat: number;
    lng: number;
    radiusMeters: number; // max 50,000
  };
  saveResults: boolean;   // if true, upsert into discovered_stores (by place_id)
}
```

Response: `DiscoveredStore[]` with a `status` field (`new` | `duplicate` | `already_imported`).

The route checks each returned `placeId` against:
1. `discovered_stores.place_id` — already discovered (show status)
2. `leads` table by normalized phone — already in pipeline (mark `duplicate`)

This check happens server-side in the route handler, not in StoreDiscoveryService, keeping the service stateless.

**PATCH `/api/discovery/stores/[id]`**

Action: `import` or `skip`.

On `import`:
1. Fetch the `discovered_stores` row
2. Map fields to `LeadIngestionService` input format
3. Call `LeadIngestionService.ingest()` — same function CSV upload uses
4. On success, set `discovered_stores.status = 'imported'`, set `lead_id` to new lead's id
5. On rejection (DNC, duplicate, etc.), surface the validation error to the UI — do not silently fail

This is the critical integration seam. The LeadIngestionService runs full compliance gates (phone normalization, consent, DNC, timezone, dedup) against discovered stores exactly as it does against CSV rows.

**Field mapping from discovered store to LeadIngestionService input:**

| discovered_stores field | LeadIngestionService input |
|------------------------|---------------------------|
| `name` | `business_name` |
| `phone` | `phone` (already normalized to E.164) |
| `formatted_address` | `address` |
| `website` | `website` |
| `lat`, `lng` | `lat`, `lng` |
| `"discovery"` (constant) | `source` |
| `place_id` | `external_id` (for audit trail) |

---

### 4. UI Components

New UI under `app/(app)/discovery/`. Existing layout, nav, and auth apply automatically via the `(app)` route group.

```
app/(app)/discovery/
  page.tsx                  -- main discovery page (Server Component shell)
  _components/
    DiscoverySearchForm.tsx  -- query + area input, submit handler
    DiscoveryResultsList.tsx -- list of stores with import/skip actions
    DiscoveryMap.tsx         -- map view with markers (Client Component)
    StoreCard.tsx            -- individual store result with status badge
    DiscoveryQueueTable.tsx  -- table of saved discovered_stores pending review
```

**DiscoveryMap.tsx** uses `@vis.gl/react-google-maps`. This is the Google Maps Platform's recommended React wrapper (vis.gl team is the Google Maps Platform React team). It provides `APIProvider`, `Map`, `AdvancedMarker`, and `InfoWindow` components.

The map requires a Maps JavaScript API key (different billing surface from Places API, but same project/key). The key is a public `NEXT_PUBLIC_GOOGLE_MAPS_KEY` env var — the JS API key is safe to expose in the browser (restrict by HTTP referrer in Google Cloud Console).

The Places API calls are server-side only (in the route handler), using the secret `GOOGLE_PLACES_API_KEY` env var. Keep these as two separate env vars even if they point to the same API key value — it makes the server/client boundary explicit.

**DiscoverySearchForm.tsx** — Client Component. Predefined area options (Atlanta GA, Charlotte NC, Jacksonville FL, Nashville TN, Birmingham AL, Columbia SC) as a select, plus free-text override. Predefined query templates for Hispanic grocery search:
- "tienda latina [area]"
- "bodega [area]"
- "mercado latino [area]"
- "Hispanic grocery [area]"
- "Latin market [area]"

All five queries run on each search, results are merged and deduped by `placeId` in the service layer.

**DiscoveryResultsList.tsx** — renders results with inline "Add to Pipeline" / "Skip" buttons. Shows a `duplicate` badge when a store already exists in the leads table.

**DiscoveryQueueTable.tsx** — shows previously discovered stores that are `pending` review. Reps can return to this queue between sessions.

---

## Data Flow: End to End

```
Rep fills out DiscoverySearchForm
  │
  ▼
POST /api/discovery/search
  │
  ├── StoreDiscoveryService.search()
  │     │
  │     └── Places API Text Search (New) × 5 queries
  │           max 20 results/query, deduped by placeId → DiscoveredStore[]
  │
  ├── For each result: check discovered_stores (by placeId) + leads (by phone)
  │     → annotate status: new | already_discovered | already_in_pipeline
  │
  └── If saveResults=true: upsert into discovered_stores WHERE status='pending'
  │
  ▼
DiscoveryResultsList renders stores with status badges
  │
Rep clicks "Add to Pipeline" on a store
  │
  ▼
PATCH /api/discovery/stores/[id] { action: "import" }
  │
  ├── LeadIngestionService.ingest(mappedFields)
  │     │
  │     ├── phone normalization (E.164)
  │     ├── consent check
  │     ├── DNC check
  │     ├── timezone check
  │     ├── dedup check (leads table)
  │     └── insert into leads table
  │
  └── discovered_stores.status → 'imported', lead_id → new lead's UUID
  │
  ▼
Lead appears in Pipeline view (existing, unchanged)
```

---

## Component Boundaries

| Component | Owns | Does NOT Own |
|-----------|------|--------------|
| `StoreDiscoveryService` | Places API calls, multi-query dedup, field normalization | DB writes, compliance, pipeline state |
| `/api/discovery/search` route | Persistence to `discovered_stores`, cross-table dedup checks | Places API calls (delegated to service) |
| `/api/discovery/stores/[id]` route | Import action, calling LeadIngestionService | Compliance logic (delegated to service) |
| `LeadIngestionService` | All compliance gates, lead insertion | Discovery search, staging table |
| `discovered_stores` table | Staging/review queue | Actual lead data (that stays in `leads`) |
| `DiscoveryMap.tsx` | Client-side map rendering | Data fetching (receives props) |

---

## Environment Variables

```bash
# Server-side only (Places API REST calls)
GOOGLE_PLACES_API_KEY=...

# Client-side (Maps JS API for map display)
NEXT_PUBLIC_GOOGLE_MAPS_KEY=...
```

Both can point to the same Google Cloud API key. Split into two vars so the distinction between server and client usage is explicit and auditable. The Places API key must never appear in client-side code.

For the Settings page requirement (in PROJECT.md), store the API key in the `settings` table (if one exists) or a new `app_settings` key-value table, encrypted at rest. On startup, fall back to env var if no DB override is set.

---

## Build Order Implications

The discovery feature has a strict dependency sequence. Each layer must exist before the next can be built or tested:

**Phase 1 (Foundation — no UI needed)**
1. `lib/db/schema/discovered-stores.ts` + migration — table must exist before any route or service
2. `lib/services/discovery.ts` — service can be unit-tested without routes or UI
3. `GOOGLE_PLACES_API_KEY` env var in docker-compose.yml

**Phase 2 (Backend — no UI needed)**
4. `POST /api/discovery/search` route — depends on service + table
5. `GET /api/discovery/stores` route — depends on table
6. `PATCH /api/discovery/stores/[id]` route — depends on LeadIngestionService (already built) + table

**Phase 3 (UI)**
7. `DiscoverySearchForm` + `DiscoveryResultsList` — depends on search route
8. `DiscoveryMap` + `@vis.gl/react-google-maps` install — depends on search route + `NEXT_PUBLIC_GOOGLE_MAPS_KEY`
9. `DiscoveryQueueTable` — depends on GET stores route
10. Nav link to `/discovery` in existing sidebar

**Do not build UI before routes exist.** The form has no meaningful mock-able behavior — it needs real Places API data to validate the query terms and result normalization.

---

## Architecture Anti-Patterns to Avoid

**Do not write directly from StoreDiscoveryService to `leads`.**
Discovery results must pass through `LeadIngestionService`. Bypassing the compliance gate creates DNC liability and produces leads with missing or malformed data. The staging table exists specifically to enforce this boundary.

**Do not call the Places API from Client Components.**
The API key would be exposed in the browser. All Places API calls go through the server-side route handler. The map display (which does need a client-side key) uses the Maps JavaScript API, which is a separate key with HTTP referrer restrictions.

**Do not skip the `discovered_stores` staging table.**
Importing directly from search results into `leads` without a staging row makes the audit trail incomplete and prevents reps from resuming a discovery session. The staging table is not optional.

**Do not use Nearby Search as the primary search mode.**
Nearby Search requires a precise lat/lng center point, which forces reps to provide coordinates rather than city names. Text Search accepts natural language area descriptions ("Hispanic grocery stores in Atlanta GA") which matches how reps think about territory. Use Text Search; provide `locationBias` as an optional enhancement.

**Do not implement map-first UI.**
For MVP, list view is the primary interaction surface. The map is a secondary view that adds spatial context. Map rendering (vis.gl) requires the Google Maps JS API to load, adds a dependency on `NEXT_PUBLIC_GOOGLE_MAPS_KEY`, and is harder to test. Build list view first, add map as an enhancement.

---

## Pitfall: Places API Billing on Phone Numbers

`nationalPhoneNumber` is an Enterprise tier field. Requesting it for every result (even stores the rep doesn't import) incurs cost per API call. Mitigation options:

1. **Request phone in search** (current recommendation): Phone is the dedup key against `leads`, so you need it at search time to annotate results. Accept the Enterprise tier cost as the cost of dedup accuracy.
2. **Deferred phone fetch**: Request only `places.id,places.displayName,places.formattedAddress,places.location` in the search, then call Place Details for phone only on stores the rep chooses to import. Reduces cost if import rate is low (<30% of results). Adds a second API call per import.

For Poveda's scale (a 1-3 rep team doing targeted discovery, not bulk scraping), option 1 is simpler and the billing impact is minimal. Revisit if search volume exceeds ~500 queries/month.

---

## Sources

- [Text Search (New) — Google Places API](https://developers.google.com/maps/documentation/places/web-service/text-search)
- [Nearby Search (New) — Google Places API](https://developers.google.com/maps/documentation/places/web-service/nearby-search)
- [Place Data Fields — Google Places API](https://developers.google.com/maps/documentation/places/web-service/data-fields)
- [Place Types (New) — Google Places API](https://developers.google.com/maps/documentation/places/web-service/place-types)
- [@googlemaps/google-maps-services-js — npm](https://www.npmjs.com/package/@googlemaps/google-maps-services-js)
- [@vis.gl/react-google-maps — npm](https://www.npmjs.com/package/@vis.gl/react-google-maps)
- [React Google Maps — vis.gl docs](https://visgl.github.io/react-google-maps/docs)
- [Drizzle ORM Schema Declaration](https://orm.drizzle.team/docs/sql-schema-declaration)
- [Google Places API Limits 2026 — MapsLeads](https://www.mapsleads.co/blog/google-places-api-limits-2026-complete-reference)
