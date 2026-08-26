# Technology Stack — Store Discovery Addition

**Project:** Poveda Distributors — Store Discovery Module
**Context:** Brownfield addition to existing Next.js 16 + Drizzle + Postgres stack
**Researched:** 2026-08-11
**Scope:** Only new additions needed for store discovery. Existing stack (Next.js 16, Tailwind, shadcn, Drizzle, Postgres, Twilio, Resend, Anthropic) is locked in.

---

## TL;DR Additions

| What | Add | Why |
|------|-----|-----|
| Map rendering | `@vis.gl/react-google-maps` | Google-endorsed React wrapper, actively maintained |
| Places search (server) | `@googlemaps/places` v3.x | Only Node.js client for Places API New |
| Geocoding (server) | `@googlemaps/google-maps-services-js` | Handles geocoding, keeps key server-side |
| Geospatial storage | PostGIS via Drizzle geometry column | Co-located with existing Postgres, no new service |
| Container runtime | Docker Compose with Next.js standalone output | Moving off Vercel, consistent with project direction |

---

## Google APIs to Enable

### Places API (New) — Required

**Confidence: HIGH** — Verified via official Google Maps Platform documentation.

Use **Places API (New)**, not the legacy Places API. The legacy API is in maintenance-only status and Google is directing all new development to the new API. The two APIs use different endpoints, different billing SKUs, and different field mask patterns.

APIs to enable in Google Cloud Console:
- **Places API (New)** — for Nearby Search and Text Search
- **Maps JavaScript API** — for the browser map tile rendering
- **Geocoding API** — for converting city/address input to lat/lng coordinates

Do NOT enable the legacy "Places API" (without "New"). Enabling both causes billing confusion and the Node.js client libraries target different endpoints.

---

## Map Rendering Library

### Recommended: `@vis.gl/react-google-maps`

**Confidence: HIGH** — This is the officially endorsed React library from Google Maps Platform. Google announced it as the production-ready, preferred option. The alternative `@react-google-maps/api` is community-maintained by a private individual; the vis.gl team explicitly built their library to avoid that dependency.

**Install:**
```bash
npm install @vis.gl/react-google-maps
```

**Version:** 1.x (reached production-stable 1.0 release; verify exact version at install time with `npm info @vis.gl/react-google-maps version`).

**What it gives you:**
- `<APIProvider>` — loads Google Maps JS API with your key
- `<Map>` — renders a map tile
- `<Marker>` and `<AdvancedMarker>` — pins for discovered stores
- `<InfoWindow>` — popups showing store details
- `useMapsLibrary('places')` — dynamically loads the Places library for browser-side Autocomplete
- `useMap()` — access to the map instance for imperative operations

**Key pattern for this project:**

The browser key (used in `<APIProvider>`) must be restricted to HTTP referrers (your domain). The server key (used in API routes) must be restricted to server IP addresses. These should be two separate API keys.

**Alternatives considered:**

| Library | Status | Why Not |
|---------|--------|---------|
| `@react-google-maps/api` | Community, unmaintained-ish | Single-owner, vis.gl team avoided it for this reason |
| Mapbox GL JS | Separate vendor, different tiles | Extra cost, different API surface, no Places equivalent |
| Leaflet + OSM | Free tiles | No built-in Places API integration; search would still need Google |
| Google Maps JS API raw (no wrapper) | Works | No React component model; useRef + imperative code against existing React patterns |

Mapbox is a legitimate alternative only if you want to decouple map tiles from Google entirely. For this project, you're using Google Places data, so rendering with Google Maps tiles is the natural fit and avoids cross-origin complications.

---

## Server-Side Places Search

### Recommended: `@googlemaps/places` (Places API New client)

**Confidence: MEDIUM** — The package exists and is at v3.0.0 (as of research date), but it is explicitly marked as "preview / work-in-progress" by Google. The API surface is stable enough to use; the preview warning means Google reserves the right to make breaking changes. For a single-milestone feature build, this is acceptable — just pin the version.

**Install:**
```bash
npm install @googlemaps/places
```

**Pin in package.json:**
```json
"@googlemaps/places": "3.0.0"
```

Do not use `^3.0.0` while the library is in preview status. Breaking changes can land without a major version bump in preview libraries.

**What it gives you:**
- `PlacesClient.searchNearby()` — find stores within a radius
- `PlacesClient.searchText()` — find stores by keyword ("tienda latina", "bodega")
- `PlacesClient.getPlace()` — fetch full details for a single place by ID

**Why NOT `@googlemaps/google-maps-services-js`:**

This is the older Node.js client. Its own documentation states it only supports the **legacy Places API**. It does not expose `searchNearby` or `searchText` (New). It is the right choice for Geocoding (which hasn't changed), but wrong for Places search.

**Usage pattern (Next.js Route Handler):**

All Places API calls go through Next.js Route Handlers (`app/api/places/...`), never from the browser directly. This keeps the server API key (with IP restriction) out of the browser bundle.

```typescript
// app/api/places/search/route.ts
import { PlacesClient } from '@googlemaps/places';

const client = new PlacesClient({
  apiKey: process.env.GOOGLE_PLACES_SERVER_KEY,
});

export async function POST(req: Request) {
  const { lat, lng, radius, query } = await req.json();
  const response = await client.searchNearby({
    locationRestriction: {
      circle: { center: { latitude: lat, longitude: lng }, radius }
    },
    includedTypes: ['grocery_store', 'supermarket', 'convenience_store', 'food_store', 'market'],
    maxResultCount: 20,
  }, {
    otherArgs: {
      headers: {
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.nationalPhoneNumber'
      }
    }
  });
  return Response.json(response);
}
```

---

## Geocoding (City/Area to Lat/Lng)

### Recommended: `@googlemaps/google-maps-services-js`

**Confidence: HIGH** — This is the right library for Geocoding. Geocoding hasn't been deprecated; this library's Geocoding support is stable and tested.

**Install:**
```bash
npm install @googlemaps/google-maps-services-js
```

Use this when the user types a city name or ZIP code into the search area input. Convert it to lat/lng server-side, then pass coordinates to the Nearby Search call.

```typescript
import { Client } from '@googlemaps/google-maps-services-js';

const geocoder = new Client();
const result = await geocoder.geocode({
  params: { address: 'Atlanta, GA', key: process.env.GOOGLE_PLACES_SERVER_KEY }
});
const { lat, lng } = result.data.results[0].geometry.location;
```

---

## Place Types for Hispanic Grocery Discovery

**Confidence: MEDIUM** — Types verified against official Place Types documentation. No dedicated "Hispanic" or "bodega" type exists.

The Google Places taxonomy does not have a specific type for Hispanic grocery stores. The recommended multi-type strategy:

**For Nearby Search (`includedTypes`):**
```
grocery_store, supermarket, convenience_store, food_store, market
```

**For Text Search (`textQuery` + `locationBias`):**
- `"tienda latina"` — catches Spanish-named stores
- `"mercado latino"` — Hispanic markets
- `"bodega"` — urban corner stores
- `"Latin grocery"` — English-labeled stores
- `"Hispanic food"` — catches specialty shops

Text Search is more effective than Nearby Search alone for this use case because it finds stores by name/description, not just category. Run both: Nearby Search for broad area coverage, Text Search for keyword-targeted discovery. Deduplicate by `places.id` (Google Place ID is stable and unique).

---

## Field Mask Strategy and Cost Control

**Confidence: HIGH** — Verified against official Places API billing documentation.

Field masks are mandatory for Places API New. Omitting them returns an error. The tier is determined by the highest-tier field requested — you pay for the most expensive field in your mask, applied to the whole call.

### Tier breakdown (Places API New, 2026):

| Tier | Fields | Price/1K calls | Free/month |
|------|--------|---------------|------------|
| Essentials | `places.id`, `places.name`, `places.formattedAddress`, `places.location`, `places.types` | ~$5 | 10,000 |
| Pro | `places.displayName`, `places.photos`, `places.rating` | ~$32 | 5,000 |
| Enterprise | `places.nationalPhoneNumber`, `places.websiteUri`, `places.regularOpeningHours` | ~$35–$40 | 1,000 |

**Recommendation for this project:**

Use a two-phase fetch strategy:

1. **Discovery call** (Nearby Search / Text Search): Use Essentials-tier field mask only.
   ```
   X-Goog-FieldMask: places.id,places.displayName,places.formattedAddress,places.location,places.types
   ```
   This costs ~$5/1K and gives you enough to show pins on a map and a result list.

2. **Detail call** (Place Details, on user click): Fetch Enterprise fields only when the user selects a store to add to the pipeline.
   ```
   X-Goog-FieldMask: places.nationalPhoneNumber,places.websiteUri,places.regularOpeningHours
   ```
   This gates the expensive call behind an explicit user action.

With ~100 stores per search session and a sales rep running maybe 20 searches/day, you're looking at ~2,000 discovery calls/day. At Essentials pricing: 60,000 calls/month against a 10,000 free tier = ~50,000 paid calls = ~$250/month worst case. Actual usage will be lower during ramp-up.

---

## Geospatial Data Storage

### Recommended: PostGIS extension on existing Postgres

**Confidence: HIGH** — Drizzle ORM has native PostGIS geometry column support (stable since v0.28+), documented in official Drizzle guides.

This adds zero new infrastructure — PostGIS is a Postgres extension, enabled with one SQL command. The existing Supabase/Postgres instance already has PostGIS available.

**Why store coordinates at all:** Discovered stores get added to the pipeline. Storing `lat`/`lng` as PostGIS geometry enables future queries like "find all pipeline contacts within 50 miles of Atlanta" without re-hitting the Places API.

**Schema addition to existing Drizzle schema:**

```typescript
import { geometry } from 'drizzle-orm/pg-core'; // PostGIS extension

export const discoveredStores = pgTable('discovered_stores', {
  id: uuid('id').defaultRandom().primaryKey(),
  googlePlaceId: text('google_place_id').unique().notNull(),
  displayName: text('display_name').notNull(),
  formattedAddress: text('formatted_address'),
  location: geometry('location', { type: 'point', mode: 'xy', srid: 4326 }),
  types: text('types').array(),
  nationalPhoneNumber: text('national_phone_number'),
  websiteUri: text('website_uri'),
  addedToPipelineAt: timestamp('added_to_pipeline_at'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

**Enable PostGIS in migration:**
```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

**Spatial distance query (Drizzle):**
```typescript
import { sql } from 'drizzle-orm';

const nearbyStores = await db
  .select()
  .from(discoveredStores)
  .where(
    sql`ST_DWithin(
      ${discoveredStores.location}::geography,
      ST_MakePoint(${lng}, ${lat})::geography,
      ${radiusMeters}
    )`
  );
```

---

## Docker Compose Setup

**Confidence: MEDIUM** — Patterns verified against Docker official docs and Next.js standalone output documentation. Docker Compose v2 syntax (no version key needed).

### next.config.ts addition

```typescript
const nextConfig = {
  output: 'standalone', // enables Docker-optimized build
};
```

### Dockerfile (multi-stage, production-ready)

```dockerfile
FROM node:22-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
```

### docker-compose.yml

```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://postgres:password@db:5432/poveda
      GOOGLE_PLACES_SERVER_KEY: ${GOOGLE_PLACES_SERVER_KEY}
      NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY: ${NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY}
      # existing env vars: TWILIO_*, RESEND_*, ANTHROPIC_API_KEY, etc.
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgis/postgis:16-3.4-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
      POSTGRES_DB: poveda
    volumes:
      - db_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5
    ports:
      - "5432:5432"

volumes:
  db_data:
```

**Key decision: `postgis/postgis:16-3.4-alpine` image** instead of `postgres:16-alpine`. This image bundles PostGIS pre-installed, eliminating the need for a custom init script to install the extension. The `-alpine` variant keeps the image small.

---

## API Key Architecture

Two separate Google API keys are required:

| Key | Name | Restriction | Used In |
|-----|------|-------------|---------|
| Browser key | `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | HTTP Referrers: `yourdomain.com/*` | `<APIProvider>` in React component |
| Server key | `GOOGLE_PLACES_SERVER_KEY` | IP Addresses: server IP(s) | Route Handlers, Server Actions |

The browser key is exposed in the client bundle (that is unavoidable for Maps JS API rendering). Restrict it tightly to your domain referrer. The server key never leaves the container.

**Enabled APIs per key:**

| Key | APIs to Enable |
|-----|---------------|
| Browser key | Maps JavaScript API only |
| Server key | Places API (New), Geocoding API |

---

## Complete Dependency List

```bash
# New additions only (existing stack is locked)
npm install @vis.gl/react-google-maps
npm install @googlemaps/places@3.0.0
npm install @googlemaps/google-maps-services-js
```

No new dev dependencies required. PostGIS is handled at the database image level.

---

## Alternatives Rejected

### Mapbox GL JS instead of Google Maps

Rejected. This project's core value is Places API discovery (finding stores Google knows about). Mapbox provides map tiles but no equivalent business directory. You'd still need Google Places API for data, plus Mapbox for rendering — two paid APIs instead of one.

### SerpAPI / Outscraper / DataForSEO for store data

Rejected. These are Google Maps scraping proxies. They violate Google ToS, have inconsistent data freshness, and add a third-party dependency with their own uptime risk. Google Places API is the authoritative source.

### Storing results in Redis cache only (no Postgres)

Rejected. Discovered stores that get added to the pipeline need to live in the database alongside contacts. Redis could cache search results but is not a substitute for persistent storage. The existing Postgres instance is the right place.

### `react-leaflet` + OpenStreetMap

Rejected for the same reason as Mapbox. OSM has no equivalent to Google's business directory. Places API data renders most naturally on Google's own tiles.

---

## Sources

- [Google Places API (New) — Place Types](https://developers.google.com/maps/documentation/places/web-service/place-types)
- [Google Places API (New) — Nearby Search](https://developers.google.com/maps/documentation/places/web-service/nearby-search)
- [Google Places API (New) — Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search)
- [Google Places API (New) — Data Fields & Tiers](https://developers.google.com/maps/documentation/places/web-service/data-fields)
- [Google Places API (New) — Usage and Billing](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing)
- [@googlemaps/places Node.js Client v2.4.0 docs](https://docs.cloud.google.com/nodejs/docs/reference/places/latest)
- [@vis.gl/react-google-maps — Official docs](https://visgl.github.io/react-google-maps/docs)
- [vis.gl/react-google-maps GitHub](https://github.com/visgl/react-google-maps)
- [Google Maps Platform blog — React library announcement](https://mapsplatform.google.com/resources/blog/streamline-the-use-of-the-maps-javascript-api-within-your-react-applications/)
- [Drizzle ORM — PostGIS geometry point guide](https://orm.drizzle.team/docs/guides/postgis-geometry-point)
- [Google Maps Platform — API security best practices](https://developers.google.com/maps/api-security-best-practices)
- [Docker — Containerize a Next.js application](https://docs.docker.com/guides/nextjs/)
- [Google Places API (New) — Migration overview](https://developers.google.com/maps/documentation/javascript/legacy/places-migration-overview)
- [Google Maps Pricing 2026 — woosmap breakdown](https://www.woosmap.com/blog/google-maps-api-pricing-breakdown)
