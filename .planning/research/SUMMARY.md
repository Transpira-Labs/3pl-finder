# Project Research Summary

**Project:** Poveda Distributors — Store Discovery Module
**Domain:** Brownfield addition — Google Maps/Places store discovery on an existing Next.js 16 sales platform
**Researched:** 2026-08-11
**Confidence:** HIGH

---

## Executive Summary

Poveda Distributors needs a store discovery module bolted onto an existing GTM Pipeline fork: a Next.js 16 + Drizzle + Postgres application already handling leads, calling (Twilio), email (Resend), and AI (Anthropic). The discovery feature is a pre-pipeline staging layer — reps search for Hispanic grocery stores (bodegas, tiendas, mercados) by city and keyword, review results on a map + list view, and promote selected stores into the existing lead pipeline.

The core technical bet is Google Places API (New) for live store data, `@vis.gl/react-google-maps` for browser-side map rendering, and a `discovered_stores` staging table in the existing Postgres instance extended with PostGIS.

---

## Key Findings

### Stack

- **Use Places API (New), not legacy** — legacy is maintenance-only
- **Two separate Google API keys required** — browser key (HTTP referrer-restricted) for Maps JS API, server key (IP-restricted) for Places API + Geocoding
- **`@vis.gl/react-google-maps`** is Google's officially endorsed React wrapper (stable 1.x)
- **`@googlemaps/google-maps-services-js`** for server-side Places + Geocoding (stable)
- **PostGIS on existing Postgres** — Drizzle has native geometry support; use `postgis/postgis:16-3.4-alpine` Docker image
- **Field mask tier discipline is critical** — requesting phone numbers jumps billing from ~$5/1K to ~$35/1K; use two-phase fetch (cheap on search, expensive on import)

### Features

**Table stakes (7):** Geographic search, radius, keyword text query, result list with contact info, map view, single add-to-pipeline, "already in pipeline" badge.

**Differentiators (10):** Saved searches, multi-keyword fan-out, batch add, pipeline stage on result card, rating/review display, website URL, CSV export, search history, session notes, SE US state quick-filters.

**Anti-features:** No custom business database, no ML store scoring, no auto-import without review, no map-first UX.

**Critical insight:** Google's `grocery_store` type is insufficient — bodegas and tiendas aren't classified by type. Text queries ("bodega near Atlanta, GA") are the only reliable approach. Multi-query fan-out with dedup by `place_id` is required.

### Architecture

- **Strict vertical slice** — no modifications to existing tables or services
- **`discovered_stores` staging table** between Places API and `leads` table
- **`StoreDiscoveryService`** is stateless — Places API calls + dedup by placeId only
- **`LeadIngestionService`** is the mandatory and only pathway into `leads` — preserves all compliance gates
- **Build order is strict:** schema → service → routes → UI
- **Multi-query strategy:** 5 parallel queries per area ("tienda latina", "bodega", "mercado latino", "Hispanic grocery", "Latin market"), dedup results by `placeId`

### Pitfalls

1. **Google Places billing spiral** — set hard daily quota before writing any code; two-phase field masks
2. **Supabase `auth.uid()` RLS breakage** — RLS policies break on plain Postgres; audit and rewrite before migration
3. **Docker Postgres data loss** — named volumes required; `docker compose down` destroys unnamed volumes
4. **Docker startup race condition** — Postgres healthcheck with `pg_isready` + `condition: service_healthy`
5. **`NEXT_PUBLIC_` variables baked at build time** — never put server API keys in NEXT_PUBLIC_

---

## Suggested Phase Structure

### Phase 1: Foundation
Fork audit, license check, Docker scaffold, Supabase-to-Postgres migration with RLS remediation, PostGIS enabled, rebranding. Unblocks everything else.

### Phase 2: Google Maps Integration
API keys + quota limits first, then schema + service + routes. Most technically risky phase — must be backend-first.

### Phase 3: Discovery UI
List view before map, full MVP table stakes, LeadIngestionService wired as compliance gate. Sidebar-list + map is the standard pattern.

### Phase 4: Operational Hardening
Caching, saved searches, batch add, webhook public URL, security maintenance process. Post-validation differentiators.

---

## Gaps to Address

- **Node.js client discrepancy:** STACK.md recommends `@googlemaps/places@3.0.0` (preview); ARCHITECTURE.md recommends `@googlemaps/google-maps-services-js` (stable). Resolve in Phase 2 by testing Text Search (New) support.
- **Places API result quality:** Unknown whether "bodega" or "tienda latina" queries return relevant results in smaller Southeast cities — needs live API testing.
- **Twilio/SalesHandy webhook access:** Local Docker can't receive webhooks without port forwarding or tunnel — assess in Phase 4.

---
*Research completed: 2026-08-11*
*Ready for roadmap: yes*
