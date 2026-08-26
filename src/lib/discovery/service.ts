import { db, schema } from "@/db";
import { eq, inArray } from "drizzle-orm";

// Default search keywords for 3PL warehouses and logistics companies
const DISCOVERY_KEYWORDS = [
  "3PL warehouse",
  "third party logistics",
  "fulfillment center",
  "warehouse logistics",
  "freight broker",
];

// Georgia-focused search areas
export const SE_US_STATES: Record<string, string> = {
  GA: "Georgia",
};

// Atlanta metro cities for exhaustive state-level search
const STATE_CITIES: Record<string, string[]> = {
  GA: ["Atlanta, GA", "Duluth, GA", "Marietta, GA", "Kennesaw, GA", "Lawrenceville, GA", "Norcross, GA", "Peachtree City, GA", "McDonough, GA", "Buford, GA", "Forest Park, GA"],
};

export type DiscoveryResult = {
  id: string; // discovered_stores.id (set after DB upsert)
  placeId: string;
  name: string;
  address: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  userRatingCount: number | null;
  businessStatus: string | null;
  types: string[] | null;
  searchQuery: string;
  alreadyInPipeline: boolean;
  pipelineStage: string | null;
};

type PlacesTextSearchResponse = {
  places?: Array<{
    id: string;
    displayName?: { text: string };
    formattedAddress?: string;
    nationalPhoneNumber?: string;
    internationalPhoneNumber?: string;
    location?: { latitude: number; longitude: number };
    rating?: number;
    userRatingCount?: number;
    businessStatus?: string;
    types?: string[];
  }>;
  nextPageToken?: string;
};

/**
 * Geocode a location string to lat/lng using Google Geocoding API.
 */
async function geocode(
  location: string,
  apiKey: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${apiKey}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const loc = data.results?.[0]?.geometry?.location;
    return loc ? { lat: loc.lat, lng: loc.lng } : null;
  } catch {
    return null;
  }
}

/**
 * Reverse geocode lat/lng to a city/state string.
 */
async function reverseGeocode(
  lat: number,
  lng: number,
  apiKey: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}&result_type=locality|administrative_area_level_1`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.results?.[0];
    return result?.formatted_address ?? null;
  } catch {
    return null;
  }
}

/**
 * Detect if a location string is a US state name (or abbreviation).
 */
function getStateCities(location: string): string[] | null {
  const normalized = location.trim().toLowerCase();
  for (const [abbr, fullName] of Object.entries(SE_US_STATES)) {
    if (normalized === fullName.toLowerCase() || normalized === abbr.toLowerCase()) {
      return STATE_CITIES[abbr] ?? null;
    }
  }
  return null;
}

/**
 * Search Google Places API (New) for stores matching the given query and location.
 * Uses Text Search with field masks to control billing tier.
 */
async function searchPlaces(
  query: string,
  location: string,
  radiusMiles: number,
  apiKey: string,
  pageToken?: string,
  center?: { lat: number; lng: number },
): Promise<PlacesTextSearchResponse> {
  const url = "https://places.googleapis.com/v1/places:searchText";

  const fieldMask = [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.location",
    "places.rating",
    "places.userRatingCount",
    "places.businessStatus",
    "places.types",
  ].join(",");

  const body: Record<string, unknown> = {
    textQuery: `${query} in ${location}`,
    languageCode: "en",
    maxResultCount: 20,
  };

  if (center && radiusMiles > 0) {
    body.locationBias = {
      circle: {
        center: { latitude: center.lat, longitude: center.lng },
        radius: radiusMiles * 1609.34,
      },
    };
  }

  if (pageToken) {
    body.pageToken = pageToken;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Places API error ${res.status}: ${text}`);
  }

  return res.json();
}

/**
 * Fetch phone number for a specific place (Enterprise tier field).
 * Called only when importing a store to the pipeline, not during search.
 */
export async function getPlacePhone(
  placeId: string,
  apiKey: string,
): Promise<string | null> {
  const url = `https://places.googleapis.com/v1/places/${placeId}`;
  const fieldMask = "internationalPhoneNumber,nationalPhoneNumber";

  const res = await fetch(url, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.internationalPhoneNumber || data.nationalPhoneNumber || null;
}

/**
 * Search a single location with all keywords, collecting results into the map.
 */
async function searchLocation(
  location: string,
  radiusMiles: number,
  keywords: string[],
  apiKey: string,
  allResults: Map<string, DiscoveryResult>,
) {
  // Geocode to get a proper center point
  const center = await geocode(location, apiKey);

  const MAX_RESULTS = 250;

  for (const keyword of keywords) {
    if (allResults.size >= MAX_RESULTS) break;

    try {
      let pageToken: string | undefined;
      let pageCount = 0;

      do {
        if (allResults.size >= MAX_RESULTS) break;

        const response = await searchPlaces(
          keyword, location, radiusMiles, apiKey, pageToken,
          center ?? undefined,
        );

        for (const place of response.places ?? []) {
          if (!place.id) continue;
          if (place.businessStatus && place.businessStatus !== "OPERATIONAL") continue;

          if (!allResults.has(place.id)) {
            allResults.set(place.id, {
              id: "",
              placeId: place.id,
              name: place.displayName?.text ?? "Unknown",
              address: place.formattedAddress ?? null,
              phone: null,
              lat: place.location?.latitude ?? null,
              lng: place.location?.longitude ?? null,
              rating: place.rating ?? null,
              userRatingCount: place.userRatingCount ?? null,
              businessStatus: place.businessStatus ?? null,
              types: place.types ?? null,
              searchQuery: keyword,
              alreadyInPipeline: false,
              pipelineStage: null,
            });
          }
        }

        pageToken = response.nextPageToken;
        pageCount++;
      } while (pageToken && pageCount < 3);
    } catch (err) {
      console.error(`Discovery search failed for "${keyword}" in "${location}":`, err);
    }
  }
}

/**
 * Nearby Search (New) — searches by lat/lng + radius with included types.
 * This is for "search this area" on the map where we have exact coordinates.
 */
async function nearbySearch(
  center: { lat: number; lng: number },
  radiusMiles: number,
  apiKey: string,
  textQuery?: string,
): Promise<PlacesTextSearchResponse> {
  const url = "https://places.googleapis.com/v1/places:searchText";

  const fieldMask = [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.location",
    "places.rating",
    "places.userRatingCount",
    "places.businessStatus",
    "places.types",
  ].join(",");

  // Use locationRestriction (strict) instead of locationBias (hint)
  // This guarantees results are within the circle
  const body: Record<string, unknown> = {
    textQuery: textQuery ?? "3PL warehouse logistics fulfillment",
    languageCode: "en",
    maxResultCount: 20,
    locationBias: {
      circle: {
        center: { latitude: center.lat, longitude: center.lng },
        radius: Math.min(radiusMiles * 1609.34, 50000), // cap at 50km
      },
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Nearby search error ${res.status}: ${text}`);
    return { places: [] };
  }

  return res.json();
}

/**
 * Search with a known center point (from "search this area" on map).
 * Uses the map viewport coordinates directly — no geocoding needed.
 */
async function searchLocationWithCenter(
  _label: string,
  radiusMiles: number,
  keywords: string[],
  apiKey: string,
  allResults: Map<string, DiscoveryResult>,
  center: { lat: number; lng: number },
) {
  const MAX_RESULTS = 250;

  // For viewport search, run each keyword as a direct text query with strict location
  for (const keyword of keywords) {
    if (allResults.size >= MAX_RESULTS) break;
    try {
      const response = await nearbySearch(center, radiusMiles, apiKey, keyword);
      for (const place of response.places ?? []) {
        if (!place.id) continue;
        if (place.businessStatus && place.businessStatus !== "OPERATIONAL") continue;
        if (!allResults.has(place.id)) {
          allResults.set(place.id, {
            id: "",
            placeId: place.id,
            name: place.displayName?.text ?? "Unknown",
            address: place.formattedAddress ?? null,
            phone: null,
            lat: place.location?.latitude ?? null,
            lng: place.location?.longitude ?? null,
            rating: place.rating ?? null,
            userRatingCount: place.userRatingCount ?? null,
            businessStatus: place.businessStatus ?? null,
            types: place.types ?? null,
            searchQuery: keyword,
            alreadyInPipeline: false,
            pipelineStage: null,
          });
        }
      }
    } catch (err) {
      console.error(`Viewport search failed for "${keyword}":`, err);
    }
  }
}

/**
 * Multi-keyword, multi-city fan-out search. If the location is a state name,
 * automatically searches across major cities in that state for exhaustive coverage.
 * Deduplicates by place_id, filters to OPERATIONAL only.
 */
export async function discoverStores(opts: {
  location: string;
  radiusMiles?: number;
  keywords?: string[];
  apiKey: string;
  center?: { lat: number; lng: number };
}): Promise<DiscoveryResult[]> {
  const { location, radiusMiles = 25, keywords = DISCOVERY_KEYWORDS, apiKey } = opts;

  const allResults = new Map<string, DiscoveryResult>();

  // Check if this is a state-level search
  const cities = getStateCities(location);

  if (cities) {
    // State-level: fan out across all major cities with wider radius
    const effectiveRadius = Math.max(radiusMiles, 50); // at least 50mi for state search
    // Run city searches in parallel batches of 3 to avoid rate limits
    for (let i = 0; i < cities.length; i += 3) {
      const batch = cities.slice(i, i + 3);
      await Promise.all(
        batch.map((city) =>
          searchLocation(city, effectiveRadius, keywords, apiKey, allResults),
        ),
      );
    }
  } else {
    // Single location search — use provided center if available
    if (opts.center) {
      // Direct coordinate search (e.g. "search this area" from map)
      await searchLocationWithCenter(location || "stores", radiusMiles, keywords, apiKey, allResults, opts.center);
    } else {
      await searchLocation(location, radiusMiles, keywords, apiKey, allResults);
    }
  }

  const results = Array.from(allResults.values());

  if (results.length === 0) return [];

  // Check which stores are already in the pipeline (by place_id)
  const placeIds = results.map((r) => r.placeId);
  const existingLeads = await db
    .select({ placeId: schema.leads.placeId, pipelineStage: schema.leads.pipelineStage })
    .from(schema.leads)
    .where(inArray(schema.leads.placeId, placeIds));

  const existingMap = new Map(
    existingLeads
      .filter((l) => l.placeId !== null)
      .map((l) => [l.placeId!, l.pipelineStage]),
  );

  for (const result of results) {
    if (existingMap.has(result.placeId)) {
      result.alreadyInPipeline = true;
      result.pipelineStage = existingMap.get(result.placeId) ?? null;
    }
  }

  // Persist to discovered_stores staging table (upsert by place_id)
  for (const result of results) {
    const [row] = await db
      .insert(schema.discoveredStores)
      .values({
        placeId: result.placeId,
        name: result.name,
        address: result.address,
        phone: result.phone,
        lat: result.lat?.toString() ?? null,
        lng: result.lng?.toString() ?? null,
        rating: result.rating?.toString() ?? null,
        userRatingCount: result.userRatingCount ?? null,
        businessStatus: result.businessStatus,
        types: result.types,
        searchQuery: result.searchQuery,
        status: existingMap.has(result.placeId) ? "duplicate" : "pending",
      })
      .onConflictDoUpdate({
        target: schema.discoveredStores.placeId,
        set: {
          name: result.name,
          address: result.address,
          rating: result.rating?.toString() ?? null,
          userRatingCount: result.userRatingCount ?? null,
          businessStatus: result.businessStatus,
          types: result.types,
        },
      })
      .returning({ id: schema.discoveredStores.id });
    result.id = row.id;
  }

  return results;
}

/**
 * Import a discovered store into the leads pipeline. Fetches the phone number
 * (Enterprise tier) and creates a lead via direct insert.
 */
export async function importStoreToPipeline(
  discoveredStoreId: string,
  apiKey: string,
  userId?: string,
  enrichmentData?: Record<string, unknown>,
): Promise<{ success: boolean; leadId?: string; error?: string }> {
  // Get the discovered store
  const [store] = await db
    .select()
    .from(schema.discoveredStores)
    .where(eq(schema.discoveredStores.id, discoveredStoreId));

  if (!store) return { success: false, error: "Store not found" };
  if (store.status === "imported") return { success: false, error: "Already imported" };

  // Check if already in pipeline by place_id
  const [existing] = await db
    .select({ id: schema.leads.id })
    .from(schema.leads)
    .where(eq(schema.leads.placeId, store.placeId));

  if (existing) {
    await db
      .update(schema.discoveredStores)
      .set({ status: "duplicate", importedLeadId: existing.id })
      .where(eq(schema.discoveredStores.id, discoveredStoreId));
    return { success: false, error: "Store already in pipeline" };
  }

  // Fetch phone number (Enterprise tier API call — only on import)
  let phone = store.phone;
  if (!phone) {
    phone = await getPlacePhone(store.placeId, apiKey);
  }

  // Create the lead
  const [lead] = await db
    .insert(schema.leads)
    .values({
      name: store.name,
      company: store.name,
      phone: phone,
      website: null,
      placeId: store.placeId,
      source: "google_discovery",
      notes: `Discovered via Google Maps search: "${store.searchQuery}". Address: ${store.address ?? "N/A"}`,
      validationStatus: phone ? "eligible" : "quarantined",
      validationReason: phone ? null : "No phone number available",
      consentBasisType: "b2b",
      consentStatus: "has_basis",
      pipelineStage: "new",
      enrichmentData: enrichmentData ?? null,
    })
    .returning({ id: schema.leads.id });

  // Update discovered store status
  await db
    .update(schema.discoveredStores)
    .set({ status: "imported", importedLeadId: lead.id, phone })
    .where(eq(schema.discoveredStores.id, discoveredStoreId));

  return { success: true, leadId: lead.id };
}

/**
 * Batch import multiple discovered stores.
 */
export async function batchImportStores(
  storeIds: string[],
  apiKey: string,
  userId?: string,
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const id of storeIds) {
    const result = await importStoreToPipeline(id, apiKey, userId);
    if (result.success) {
      imported++;
    } else {
      skipped++;
      if (result.error) errors.push(`${id}: ${result.error}`);
    }
  }

  return { imported, skipped, errors };
}

/**
 * Get saved searches for a user.
 */
export async function getSavedSearches(userId?: string) {
  return db.select().from(schema.savedSearches).orderBy(schema.savedSearches.createdAt);
}

/**
 * Save a search preset.
 */
export async function saveSearch(opts: {
  name: string;
  query: string;
  location: string;
  radiusMiles: number;
  userId?: string;
}) {
  const [saved] = await db
    .insert(schema.savedSearches)
    .values(opts)
    .returning();
  return saved;
}

/**
 * Delete a saved search.
 */
export async function deleteSavedSearch(id: string) {
  await db.delete(schema.savedSearches).where(eq(schema.savedSearches.id, id));
}
