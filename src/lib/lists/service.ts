import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  storeLists,
  storeListItems,
  discoveredStores,
} from "@/db/schema";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CreateListInput {
  name: string;
  description?: string;
  userId?: string;
}

export interface AddItemInput {
  listId: string;
  storeId: string;
  storeName: string;
  storeAddress?: string | null;
  storePhone?: string | null;
  storeLat?: string | null;
  storeLng?: string | null;
  storeRating?: string | null;
  ownerName?: string | null;
  ownerPhone?: string | null;
  notes?: string | null;
}

export interface StoreListRow {
  id: string;
  name: string;
  description: string | null;
  storeCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoreListItemRow {
  id: string;
  listId: string;
  storeId: string;
  storeName: string;
  storeAddress: string | null;
  storePhone: string | null;
  storeLat: string | null;
  storeLng: string | null;
  storeRating: string | null;
  ownerName: string | null;
  ownerPhone: string | null;
  position: number | null;
  notes: string | null;
  createdAt: Date;
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

/** Get all lists, newest first. */
export async function getLists(): Promise<StoreListRow[]> {
  return db
    .select()
    .from(storeLists)
    .orderBy(desc(storeLists.updatedAt));
}

/** Get a single list by ID. */
export async function getList(id: string): Promise<StoreListRow | null> {
  const rows = await db
    .select()
    .from(storeLists)
    .where(eq(storeLists.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** Create a new list. */
export async function createList(input: CreateListInput): Promise<StoreListRow> {
  const [row] = await db
    .insert(storeLists)
    .values({
      name: input.name,
      description: input.description ?? null,
      userId: input.userId ?? null,
    })
    .returning();
  return row;
}

/** Update a list's name/description. */
export async function updateList(
  id: string,
  update: { name?: string; description?: string },
): Promise<StoreListRow | null> {
  const [row] = await db
    .update(storeLists)
    .set({
      ...(update.name !== undefined ? { name: update.name } : {}),
      ...(update.description !== undefined ? { description: update.description } : {}),
      updatedAt: new Date(),
    })
    .where(eq(storeLists.id, id))
    .returning();
  return row ?? null;
}

/** Delete a list (cascades to items). */
export async function deleteList(id: string): Promise<void> {
  await db.delete(storeLists).where(eq(storeLists.id, id));
}

// ─── Items ──────────────────────────────────────────────────────────────────

/** Get all items in a list, ordered by position (if set) then created. */
export async function getListItems(listId: string): Promise<StoreListItemRow[]> {
  return db
    .select()
    .from(storeListItems)
    .where(eq(storeListItems.listId, listId))
    .orderBy(storeListItems.position, storeListItems.createdAt);
}

/** Add a store to a list. Auto-populates cached fields from discovered_stores if not provided. */
export async function addItemToList(input: AddItemInput): Promise<StoreListItemRow> {
  // If name was explicitly provided, use it; otherwise look up from discovered_stores
  let itemData: Omit<AddItemInput, "listId" | "storeId"> & {
    storeName: string;
  } = {
    storeName: input.storeName,
    storeAddress: input.storeAddress,
    storePhone: input.storePhone,
    storeLat: input.storeLat,
    storeLng: input.storeLng,
    storeRating: input.storeRating,
    ownerName: input.ownerName,
    ownerPhone: input.ownerPhone,
    notes: input.notes,
  };

  if (!input.storeName) {
    // Fetch from discovered_stores
    const [store] = await db
      .select()
      .from(discoveredStores)
      .where(eq(discoveredStores.id, input.storeId))
      .limit(1);
    if (store) {
      itemData = {
        storeName: store.name,
        storeAddress: store.address,
        storePhone: store.phone,
        storeLat: store.lat,
        storeLng: store.lng,
        storeRating: store.rating,
        ownerName: input.ownerName,
        ownerPhone: input.ownerPhone,
        notes: input.notes,
      };
    }
  }

  const [row] = await db
    .insert(storeListItems)
    .values({
      listId: input.listId,
      storeId: input.storeId,
      ...itemData,
    })
    .onConflictDoNothing()
    .returning();

  // If it was a duplicate (already in list), fetch existing
  if (!row) {
    const [existing] = await db
      .select()
      .from(storeListItems)
      .where(
        and(
          eq(storeListItems.listId, input.listId),
          eq(storeListItems.storeId, input.storeId),
        ),
      )
      .limit(1);
    // Update store count regardless
    await refreshStoreCount(input.listId);
    return existing;
  }

  await refreshStoreCount(input.listId);
  return row;
}

/**
 * Fetch phone + address from Google Places detail API for a store.
 * Saves it back to discovered_stores so future lookups are instant.
 */
async function fetchAndSavePhone(
  placeId: string,
  apiKey: string,
): Promise<{ phone: string | null; address: string | null }> {
  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}`,
      {
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "internationalPhoneNumber,nationalPhoneNumber,formattedAddress",
        },
      },
    );
    if (!res.ok) return { phone: null, address: null };
    const data = await res.json();
    const phone = data.internationalPhoneNumber ?? data.nationalPhoneNumber ?? null;
    const address = data.formattedAddress ?? null;

    // Save back to discovered_stores
    if (phone || address) {
      await db
        .update(discoveredStores)
        .set({
          ...(phone ? { phone } : {}),
          ...(address ? { address } : {}),
        })
        .where(eq(discoveredStores.placeId, placeId))
        .catch(() => {});
    }

    return { phone, address };
  } catch {
    return { phone: null, address: null };
  }
}

/** Add multiple stores to a list at once. Fetches phone numbers from Google if missing. */
export async function addItemsToList(
  listId: string,
  storeIds: string[],
): Promise<number> {
  if (storeIds.length === 0) return 0;

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  // Fetch all stores
  const stores = await db
    .select()
    .from(discoveredStores)
    .where(sql`${discoveredStores.id} IN (${sql.join(storeIds.map((id) => sql`${id}`), sql`, `)})`);

  const storeMap = new Map(stores.map((s) => [s.id, s]));
  let added = 0;

  for (const storeId of storeIds) {
    const store = storeMap.get(storeId);
    if (!store) continue;

    let phone = store.phone;
    let address = store.address;

    // Fetch phone from Google if we don't have it
    if (!phone && apiKey && store.placeId) {
      const fetched = await fetchAndSavePhone(store.placeId, apiKey);
      phone = fetched.phone;
      if (!address) address = fetched.address;
    }

    const result = await db
      .insert(storeListItems)
      .values({
        listId,
        storeId,
        storeName: store.name,
        storeAddress: address,
        storePhone: phone,
        storeLat: store.lat,
        storeLng: store.lng,
        storeRating: store.rating,
      })
      .onConflictDoNothing()
      .returning();

    if (result.length > 0) added++;
  }

  await refreshStoreCount(listId);
  return added;
}

/** Remove a store from a list. */
export async function removeItemFromList(
  listId: string,
  storeId: string,
): Promise<void> {
  await db
    .delete(storeListItems)
    .where(
      and(
        eq(storeListItems.listId, listId),
        eq(storeListItems.storeId, storeId),
      ),
    );
  await refreshStoreCount(listId);
}

/** Remove multiple stores from a list. */
export async function removeItemsFromList(
  listId: string,
  storeIds: string[],
): Promise<void> {
  if (storeIds.length === 0) return;
  for (const storeId of storeIds) {
    await db
      .delete(storeListItems)
      .where(
        and(
          eq(storeListItems.listId, listId),
          eq(storeListItems.storeId, storeId),
        ),
      );
  }
  await refreshStoreCount(listId);
}

/** Refresh the cached store_count on a list. */
async function refreshStoreCount(listId: string): Promise<void> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(storeListItems)
    .where(eq(storeListItems.listId, listId));

  await db
    .update(storeLists)
    .set({ storeCount: count, updatedAt: new Date() })
    .where(eq(storeLists.id, listId));
}

// ─── CSV Export ─────────────────────────────────────────────────────────────

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV string from list items. */
export function buildListCsv(items: StoreListItemRow[]): string {
  const header = [
    "Store Name",
    "Address",
    "Phone",
    "Rating",
    "Owner Name",
    "Owner Phone",
    "Notes",
    "Position",
  ];
  const rows = items.map((item) => [
    item.storeName,
    item.storeAddress ?? "",
    item.storePhone ?? "",
    item.storeRating ?? "",
    item.ownerName ?? "",
    item.ownerPhone ?? "",
    item.notes ?? "",
    item.position != null ? String(item.position) : "",
  ]);
  return [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
}

// ─── Route Optimization ────────────────────────────────────────────────────

interface Waypoint {
  storeId: string;
  lat: number;
  lng: number;
}

interface OptimizeResult {
  orderedStoreIds: string[];
  /** Google Maps URL for turn-by-turn navigation */
  googleMapsUrl: string;
  /** Total distance in meters */
  totalDistanceMeters: number;
  /** Total duration string */
  totalDuration: string;
}

/**
 * Optimize the visit order for stores in a list using Google Routes API.
 * Updates item positions in DB and returns the optimized order.
 * Max 25 waypoints per Google API limit.
 */
/**
 * Call Google Routes API for a single chunk of up to 23 intermediates.
 */
async function optimizeChunk(
  origin: Record<string, unknown>,
  destination: Record<string, unknown>,
  intermediates: Waypoint[],
  apiKey: string,
): Promise<{ orderedWaypoints: Waypoint[]; distanceMeters: number; durationSeconds: number }> {
  const body = {
    origin,
    destination,
    intermediates: intermediates.map((wp) => ({
      location: { latLng: { latitude: wp.lat, longitude: wp.lng } },
    })),
    travelMode: "DRIVE",
    optimizeWaypointOrder: true,
    routingPreference: "TRAFFIC_AWARE",
  };

  const res = await fetch(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "routes.optimizedIntermediateWaypointIndex,routes.distanceMeters,routes.duration",
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    console.error("Google Routes API error:", errText);
    throw new Error("Route optimization failed: " + res.status);
  }

  const data = await res.json();
  const route = data.routes?.[0];
  if (!route) throw new Error("No route returned from Google Routes API");

  const optimizedIndices: number[] =
    route.optimizedIntermediateWaypointIndex ?? intermediates.map((_, i) => i);

  const durationStr: string = route.duration ?? "0s";
  const durationSeconds = parseInt(durationStr.replace("s", ""), 10) || 0;

  return {
    orderedWaypoints: optimizedIndices.map((i: number) => intermediates[i]),
    distanceMeters: route.distanceMeters ?? 0,
    durationSeconds,
  };
}

export async function optimizeRoute(listId: string, startAddress?: string): Promise<OptimizeResult> {
  const items = await getListItems(listId);
  const waypoints: Waypoint[] = items
    .filter((i) => i.storeLat && i.storeLng)
    .map((i) => ({
      storeId: i.storeId,
      lat: parseFloat(i.storeLat!),
      lng: parseFloat(i.storeLng!),
    }));

  if (waypoints.length < 2) {
    throw new Error("Need at least 2 stores with coordinates to optimize a route");
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_SERVER_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new Error("Google API key is required for route optimization");
  }

  const useStartAddress = !!startAddress?.trim();
  const MAX_INTERMEDIATES = 23; // Google allows 25 total (origin + dest + 23 intermediates)

  let fullOrder: Waypoint[];
  let totalDistance = 0;
  let totalDurationSec = 0;

  if (waypoints.length <= MAX_INTERMEDIATES + 2 || (useStartAddress && waypoints.length <= MAX_INTERMEDIATES)) {
    // Small enough for a single API call
    const originWp = useStartAddress
      ? { address: startAddress!.trim() }
      : { location: { latLng: { latitude: waypoints[0].lat, longitude: waypoints[0].lng } } };
    const destinationWp = useStartAddress
      ? { address: startAddress!.trim() }
      : { location: { latLng: { latitude: waypoints[waypoints.length - 1].lat, longitude: waypoints[waypoints.length - 1].lng } } };
    const intermediates = useStartAddress ? waypoints : waypoints.slice(1, -1);

    const result = await optimizeChunk(originWp, destinationWp, intermediates, apiKey);
    fullOrder = useStartAddress
      ? result.orderedWaypoints
      : [waypoints[0], ...result.orderedWaypoints, waypoints[waypoints.length - 1]];
    totalDistance = result.distanceMeters;
    totalDurationSec = result.durationSeconds;
  } else {
    // Too many waypoints — split into chunks and chain them
    // Each chunk is optimized independently, last stop of chunk N = first stop of chunk N+1
    const allStores = [...waypoints];
    fullOrder = [];

    // Split into chunks of MAX_INTERMEDIATES
    const chunks: Waypoint[][] = [];
    for (let i = 0; i < allStores.length; i += MAX_INTERMEDIATES) {
      chunks.push(allStores.slice(i, i + MAX_INTERMEDIATES));
    }

    for (let c = 0; c < chunks.length; c++) {
      const chunk = chunks[c];
      const isFirst = c === 0;
      const isLast = c === chunks.length - 1;

      // Origin: start address for first chunk, last waypoint of previous chunk otherwise
      const originWp = isFirst && useStartAddress
        ? { address: startAddress!.trim() }
        : isFirst
          ? { location: { latLng: { latitude: chunk[0].lat, longitude: chunk[0].lng } } }
          : { location: { latLng: { latitude: fullOrder[fullOrder.length - 1].lat, longitude: fullOrder[fullOrder.length - 1].lng } } };

      // Destination: start address for last chunk (round trip), or last store in chunk
      const destinationWp = isLast && useStartAddress
        ? { address: startAddress!.trim() }
        : { location: { latLng: { latitude: chunk[chunk.length - 1].lat, longitude: chunk[chunk.length - 1].lng } } };

      // Intermediates: all chunk stores except first/last (unless using start address)
      const intermediates = (isFirst && !useStartAddress)
        ? chunk.slice(1, -1)
        : chunk;

      if (intermediates.length === 0) {
        fullOrder.push(...chunk);
        continue;
      }

      const result = await optimizeChunk(originWp, destinationWp, intermediates, apiKey);
      fullOrder.push(...result.orderedWaypoints);
      totalDistance += result.distanceMeters;
      totalDurationSec += result.durationSeconds;
    }
  }

  const orderedStoreIds = fullOrder.map((wp) => wp.storeId);

  // Update positions in DB
  for (let i = 0; i < orderedStoreIds.length; i++) {
    await db
      .update(storeListItems)
      .set({ position: i + 1 })
      .where(
        and(
          eq(storeListItems.listId, listId),
          eq(storeListItems.storeId, orderedStoreIds[i]),
        ),
      );
  }

  // Build Google Maps URL (limited to 25 waypoints in URL)
  const gmCoords = fullOrder.slice(0, 25).map((wp) => `${wp.lat},${wp.lng}`);
  const gmOrigin = useStartAddress ? encodeURIComponent(startAddress!.trim()) : gmCoords[0];
  const gmDest = useStartAddress ? encodeURIComponent(startAddress!.trim()) : gmCoords[gmCoords.length - 1];
  const gmMiddle = (useStartAddress ? gmCoords : gmCoords.slice(1, -1)).join("|");
  const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${gmOrigin}&destination=${gmDest}${gmMiddle ? `&waypoints=${gmMiddle}` : ""}&travelmode=driving`;

  return {
    orderedStoreIds,
    googleMapsUrl,
    totalDistanceMeters: totalDistance,
    totalDuration: `${totalDurationSec}s`,
  };
}
