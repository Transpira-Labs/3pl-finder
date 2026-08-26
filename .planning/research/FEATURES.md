# Feature Landscape: Store Discovery for Wholesale Distributor

**Domain:** B2B store discovery — wholesale distributor finding retail stores to prospect
**Researched:** 2026-08-11
**Scope:** Discovery features ONLY. Pipeline management, calling, email, analytics are already built.

---

## Table Stakes

Features the discovery module MUST have to be useful. Missing any one of these makes the
tool not worth opening.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Geographic search by city or zip code | The entire workflow starts here — "find stores near Atlanta" | Low | Google Places Text Search handles this; `textQuery` + `locationRestriction` |
| Radius search (miles) | Reps plan by territory, not arbitrary zip boundaries | Low | Google Places supports `locationRestriction` as a circle with radius |
| Keyword-based query | "bodega", "tienda", "Latin market", "Hispanic grocery" are not Google place types — text query is the only reliable way to find them | Low | `grocery_store` type won't catch bodegas; free-text query is required |
| Store result list with name, address, phone | The minimum data needed to call or visit a store | Low–Med | Google Places Pro SKU returns name, address, phone number, business status |
| Map view alongside results list | Industry-standard for location discovery; allows visual territory scanning | Med | Sidebar-list + map is the dominant UX pattern per MapUIPatterns |
| Add store to pipeline (single) | The outcome of discovery is a pipeline lead — must be one click | Low | Creates a lead record in the existing pipeline |
| Duplicate prevention — block re-adding | If a store is already in the pipeline, the rep must see that before adding it | Med | Match on phone number OR normalized address; show badge/disabled state on result card |
| Duplicate detection confidence | Phone + address matching catches ~80–90% of dupes; fuzzy name matching catches edge cases | Med | Exact match on E.164 phone or normalized address string is the baseline |
| Business status filter | Only show `OPERATIONAL` businesses — avoid closed stores | Low | Google Places returns `businessStatus`; filter before showing results |
| Pagination / load more | Google Places Text Search returns max 20 per page, 60 total across 3 pages | Low | Must handle `nextPageToken` or paginated API calls |

---

## Differentiators

Features that would make discovery significantly more powerful for Poveda's specific use case.
Not expected at launch, but each has real business value.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Saved searches / search presets | Reps run the same searches weekly — save "bodegas in Atlanta 25mi" | Low | Store query params + label in DB; no new API cost |
| Multi-keyword search in one run | Run "bodega", "tienda", "supermercado", "carneceria" in one session and deduplicate results by place_id | Med | Google Places has no multi-keyword call; must fan-out and deduplicate client-side |
| Batch add to pipeline | Select multiple results and add all at once vs one by one | Med | Reduce friction when doing a territory sweep |
| Existing pipeline status on result card | Show which pipeline stage a store is already in (not just "already added") | Med | Join on place_id or normalized phone against lead records |
| Store rating / review count display | Higher-rated stores with more reviews = more established business = better prospect | Low | Rating is in Google Places Pro SKU; no extra cost |
| Website URL on result | Lets reps research the store before calling; also signals legitimacy | Low | Website is Enterprise SKU — adds cost per lookup |
| Export discovered stores to CSV | Backup discovery sessions; share with Hugo for review | Low | Client-side export; no new API dependency |
| Search history (recent searches) | Reps can return to a previous session's results | Low | Store last N searches in session/DB |
| Notes on search session | "Did this territory on Aug 11 — found 12 new stores" | Low | Simple text field on saved search record |
| Southeast US state quick-filters | Pre-set buttons for GA, FL, SC, NC, TN, AL — Poveda's target region | Low | Just populates the search form; no new API logic |
| Pin clustering on map at high zoom | When searching "Florida", pins overlap — clustering prevents visual noise | Med | Leaflet or Google Maps JS SDK clustering; adds map complexity |

---

## Anti-Features

Things to explicitly NOT build. These are common mistakes in this type of tool.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Building a custom business database / scraper | Maintaining a database of Hispanic stores across 6 states is a data engineering project, not a sales tool. Data goes stale fast. | Use Google Places API as a live data source — always current |
| Predictive "store scoring" / ML ranking | No training data exists; Poveda has no historical won/lost store records to train on. This is a post-MVP concept at best. | Let reps use their own judgment; add pipeline status as the only ranking signal |
| Social media enrichment (Instagram, Facebook lookup) | Small bodegas often have no web presence; enrichment APIs return empty results and add latency | Skip enrichment; phone + address is enough to start a sales conversation |
| Auto-import all results to pipeline without review | Creates pipeline noise; reps lose trust in data quality when junk stores appear | Always show results first, let rep choose what to add |
| Map-first UX with no list | Full-map layouts work for brands with 1000+ locations; Poveda has ~0 to start | Keep sidebar-list as primary; map is secondary navigation aid |
| Territory management / lead routing | Team is 1–2 people; complex territory assignment is premature | Add a "claimed by" rep field on leads if/when team grows |
| Deduplication across external databases | Matching against SalesHandy imports, CSVs, and discovered stores in one dedup pass is complex. The existing contact_ledger table handles CSV/SalesHandy dedup. | Discovery dedup matches only against the pipeline (leads table) by phone or address |
| Phone number validation / lookup (Twilio Lookup API) | Adds latency and cost at discovery time; not necessary until rep is about to call | Validate at call time, which the existing Twilio compliance gate already does |
| Confidence score UI for duplicates | "70% match" language confuses non-technical users | Show binary: "Already in pipeline" badge vs no badge |
| Infinite scroll results past 60 | Google Places Text Search caps at 60 results total per query. Infinite scroll implies more data exists. | Show "60 results maximum per search — narrow your area or keyword for more" message |

---

## Feature Dependencies

```
Geographic search input
  └── Text query (required — place types alone insufficient for bodegas/tiendas)
  └── locationRestriction (city/zip → radius)
        └── Results list (name, address, phone, status)
              └── Map pins (depends on lat/lng from results)
              └── "Already in pipeline" badge
                    └── Duplicate check (phone OR address normalization)
              └── Add to pipeline (blocked if already added)
                    └── Creates lead record in existing leads table

Optional:
  Saved search → populates search form → runs same query
  Multi-keyword fan-out → merges results by place_id → feeds same result list
  Batch add → checkbox on result cards → add selected → pipeline records
```

**Critical dependency:** Google Places Text Search returns a `place_id` (unique per business).
Storing `place_id` on the lead record enables O(1) duplicate lookup and is the recommended
approach over fuzzy name/address matching for the primary dedup signal.

---

## MVP Recommendation

For the first working version of store discovery:

**Must have (MVP):**
1. Text query + city/zip + radius form
2. Results list — name, address, phone, business status
3. Map view with pins matching results
4. "Already in pipeline" badge (match by place_id stored on existing leads)
5. Single "Add to Pipeline" button per result
6. Pagination (handle 3 pages / 60 results)
7. Filter out non-OPERATIONAL businesses

**Defer to post-MVP:**
- Saved searches — useful but reps can re-type queries; low urgency
- Batch add — MVP is building the pipeline from zero; single-add is fine initially
- Website URL — Enterprise SKU adds cost; phone + address sufficient to start
- Multi-keyword fan-out — add when reps report gaps in results
- Export to CSV — useful once pipeline has data to compare against
- Pin clustering — only matters when searching large states with many results

---

## Data Source Notes

**Google Places Text Search (New API):**
- Best fit for open-ended queries like "bodega near Atlanta, GA"
- Returns max 60 results per query (20 per page, 3 pages)
- `grocery_store` type alone will NOT find bodegas — must use text query
- `place_id` is stable and unique — use as the primary dedup key
- Fields by billing tier:
  - Pro SKU: name, address, lat/lng, phone, rating, business status, photos
  - Enterprise SKU: website URL, opening hours (higher cost)
- Recommended queries for Poveda's domain: "bodega", "tienda", "Latin grocery", "Hispanic market", "supermercado", "carneceria", "Latin market"
- Searching by state ("FL") returns results biased to population centers; searching by city or zip is more reliable

**Yelp Fusion API (alternative / supplemental):**
- Supports category filters and specialty food categories
- Hispanic/Latin food grocery categories exist in Yelp's taxonomy
- Could supplement Google Places for coverage gaps — LOW confidence without testing
- Not recommended as primary source; Google Places has wider coverage

---

## Sources

- Google Places API Text Search documentation: https://developers.google.com/maps/documentation/places/web-service/text-search
- Google Places place types: https://developers.google.com/maps/documentation/places/web-service/place-types
- Map UI Patterns — location list and list+detail patterns: https://mapuipatterns.com/location-list/ and https://mapuipatterns.com/list-details/
- CRM deduplication best practices (real-time detection at point of entry): https://www.convergehub.com/blog/why-crm-creates-duplicate-leads-and-how-to-fix-it/
- B2B prospecting tool landscape (table stakes for 2026): https://www.rocket.new/blog/best-prospecting-tools-for-sales-teams
- Radius mapping best practices: https://www.maptive.com/simple-guide-to-radius-mapping/
- Store locator UX patterns (sidebar-list + map as dominant pattern): https://mapular.com/blog/store-locator-design-25-examples-that-actually-convert
