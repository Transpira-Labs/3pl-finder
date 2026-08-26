"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Compass,
  List,
  Loader2,
  MapPin,
  Plus,
  Search,
  Star,
  Bookmark,
  Check,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge as _Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DiscoveryMap, type MapMarker, type MapBounds, type MapViewport } from "./discovery-map";

// ---------- Types ----------

interface DiscoveryResult {
  id: string;
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  rating?: number;
  ratingCount?: number;
  businessStatus?: string;
  inPipeline: boolean;
  pipelineStage?: string;
}

interface StoreDetail {
  name: string;
  address: string;
  phone: string | null;
  rating: number | null;
  ratingCount: number | null;
  googleMapsUrl: string | null;
  website: string | null;
  hours: string[] | null;
  photos: string[];
  types: string[] | null;
}

interface StoreEnrichment {
  owner: {
    name: string | null;
    title: string | null;
    email: string | null;
    phone: string | null;
    linkedin: string | null;
  } | null;
  summary: {
    overview: string;
    productsCarried: string[];
    estimatedSize: string;
    estimatedRevenue: string;
    salesAngle: string;
    customerBase: string;
  } | null;
  reviewSnippets: string[];
  sources: string[];
}

interface SavedSearch {
  id: string;
  name: string;
  location: string;
  radiusMiles: number;
  keywords?: string;
}

// ---------- Constants ----------

const RADIUS_OPTIONS = [5, 10, 25, 50, 100];
const SE_STATES = ["GA"] as const;
const STATE_NAMES: Record<(typeof SE_STATES)[number], string> = {
  GA: "Georgia",
};

// ---------- Main Component ----------

export function DiscoveryPage() {
  const { t, locale } = useI18n();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Search state — initialize from URL params
  const [location, setLocation] = useState(searchParams.get("q") ?? "");
  const [radius, setRadius] = useState(Number(searchParams.get("r")) || 25);
  const [keywords, setKeywords] = useState(searchParams.get("kw") ?? "");
  const initialSearchDone = useRef(false);

  // Results state
  const [results, setResults] = useState<DiscoveryResult[]>([]);
  const [resultCount, setResultCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Selection state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  // Saved searches
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [savedDropdownOpen, setSavedDropdownOpen] = useState(false);

  // Importing
  const [importing, setImporting] = useState<Set<string>>(new Set());
  const [batchImporting, setBatchImporting] = useState(false);

  // Map viewport lock — prevents re-zoom after auto-search
  const keepViewportRef = useRef(false);

  // Viewport filtering — only show results visible on the map
  const [viewport, setViewport] = useState<MapViewport | null>(null);

  // Detail panel
  const [detailStore, setDetailStore] = useState<DiscoveryResult | null>(null);
  const [detail, setDetail] = useState<StoreDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Enrichment
  const [enrichment, setEnrichment] = useState<StoreEnrichment | null>(null);
  const [enrichLoading, setEnrichLoading] = useState(false);

  // Save to list
  const [saveToListOpen, setSaveToListOpen] = useState(false);
  const [userLists, setUserLists] = useState<{ id: string; name: string }[]>([]);
  const [newListName, setNewListName] = useState("");
  const [savingToList, setSavingToList] = useState(false);
  const [savedToList, setSavedToList] = useState(false);

  // ---------- Detail ----------

  const openDetail = useCallback(async (store: DiscoveryResult) => {
    setDetailStore(store);
    setDetail(null);
    setEnrichment(null);
    setDetailLoading(true);
    setEnrichLoading(false);

    try {
      const res = await fetch(`/api/discovery/detail?placeId=${store.placeId}`);
      if (res.ok) {
        const detailData = await res.json();
        setDetail(detailData);

        // Start enrichment in background after detail loads
        setEnrichLoading(true);
        fetch("/api/discovery/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            placeId: store.placeId,
            storeName: store.name,
            storeAddress: store.address,
            storePhone: detailData.phone,
            rating: detailData.rating,
            ratingCount: detailData.ratingCount,
            websiteUrl: detailData.website,
            hours: detailData.hours,
            locale,
          }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => { if (data) setEnrichment(data); })
          .catch(() => {})
          .finally(() => setEnrichLoading(false));
      }
    } catch {
      // silently fail
    } finally {
      setDetailLoading(false);
    }
  }, [locale]);

  // Auto-search on mount if URL has search params (e.g. coming back from detail page)
  useEffect(() => {
    if (initialSearchDone.current) return;
    initialSearchDone.current = true;

    const q = searchParams.get("q");
    const lat = searchParams.get("lat");
    const lng = searchParams.get("lng");
    const vr = searchParams.get("vr");

    if (lat && lng) {
      // Viewport-based search (from drag/zoom)
      const centerLat = parseFloat(lat);
      const centerLng = parseFloat(lng);
      const radiusMiles = Number(vr) || 25;
      const kw = searchParams.get("kw");

      setHasSearched(true);
      setLoading(true);
      keepViewportRef.current = false; // let map zoom to results on restore

      fetch("/api/discovery/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location: "stores",
          radiusMiles,
          keywords: kw || undefined,
          centerLat,
          centerLng,
        }),
      })
        .then((r) => r.ok ? r.json() : Promise.reject())
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then((data) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mapped: DiscoveryResult[] = (data.results ?? []).map((r: any) => ({
            id: r.id, placeId: r.placeId ?? "", name: r.name ?? "Unknown",
            address: r.address ?? "", lat: r.lat ?? 0, lng: r.lng ?? 0,
            rating: r.rating ?? undefined, ratingCount: r.userRatingCount ?? undefined,
            businessStatus: r.businessStatus ?? undefined,
            inPipeline: r.alreadyInPipeline ?? false, pipelineStage: r.pipelineStage ?? undefined,
          }));
          setResults(mapped);
          setResultCount(data.count ?? mapped.length);
        })
        .catch(() => setError("Search failed"))
        .finally(() => setLoading(false));
    } else if (q) {
      // Text-based search
      runSearch(q);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch enrichment when locale changes while detail panel is open
  const prevLocaleRef = useCallback(() => locale, [locale]);
  useEffect(() => {
    if (!detailStore || !detail) return;
    // Re-run enrichment with new locale
    setEnrichLoading(true);
    setEnrichment(null);
    fetch("/api/discovery/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        placeId: detailStore.placeId,
        storeName: detailStore.name,
        storeAddress: detailStore.address,
        storePhone: detail.phone,
        rating: detail.rating,
        ratingCount: detail.ratingCount,
        websiteUrl: detail.website,
        hours: detail.hours,
        locale,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setEnrichment(data); })
      .catch(() => {})
      .finally(() => setEnrichLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  // ---------- Search ----------

  const runSearch = useCallback(
    async (loc?: string) => {
      const searchLocation = loc ?? location;
      if (!searchLocation.trim()) return;

      // Persist search to URL params
      const params = new URLSearchParams();
      params.set("q", searchLocation.trim());
      if (radius !== 25) params.set("r", String(radius));
      if (keywords.trim()) params.set("kw", keywords.trim());
      router.replace(`/discovery?${params.toString()}`, { scroll: false });

      setLoading(true);
      setError(null);
      setHasSearched(true);
      setSelected(new Set());
      setHighlightedId(null);
      keepViewportRef.current = false;

      try {
        const res = await fetch("/api/discovery/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            location: searchLocation.trim(),
            radiusMiles: radius,
            keywords: keywords.trim() || undefined,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? `Search failed (${res.status})`);
        }

        const data = await res.json();
        // Map backend fields to frontend type
        const mapped: DiscoveryResult[] = (data.results ?? []).map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (r: any) => ({
            id: r.id,
            placeId: r.placeId ?? "",
            name: r.name ?? "Unknown",
            address: r.address ?? "",
            lat: r.lat ?? 0,
            lng: r.lng ?? 0,
            rating: r.rating ?? undefined,
            ratingCount: r.userRatingCount ?? undefined,
            businessStatus: r.businessStatus ?? undefined,
            inPipeline: r.alreadyInPipeline ?? false,
            pipelineStage: r.pipelineStage ?? undefined,
          }),
        );
        setResults(mapped);
        setResultCount(data.count ?? mapped.length);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "An unexpected error occurred",
        );
        setResults([]);
        setResultCount(null);
      } finally {
        setLoading(false);
      }
    },
    [location, radius, keywords],
  );

  // ---------- Import ----------

  const importStore = useCallback(async (storeId: string) => {
    setImporting((prev) => new Set(prev).add(storeId));
    try {
      const res = await fetch("/api/discovery/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, enrichmentData: enrichment?.summary ? { summary: enrichment.summary, sources: enrichment.sources } : undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Import failed");
      }
      setResults((prev) =>
        prev.map((r) =>
          r.id === storeId
            ? { ...r, inPipeline: true, pipelineStage: "new_lead" }
            : r,
        ),
      );
    } catch {
      // Silently handle - user sees button didn't change
    } finally {
      setImporting((prev) => {
        const next = new Set(prev);
        next.delete(storeId);
        return next;
      });
    }
  }, []);

  const importSelected = useCallback(async () => {
    if (selected.size === 0) return;
    setBatchImporting(true);
    try {
      const storeIds = Array.from(selected).filter(
        (id) => !results.find((r) => r.id === id)?.inPipeline,
      );
      if (storeIds.length === 0) return;

      const res = await fetch("/api/discovery/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeIds }),
      });
      if (!res.ok) throw new Error("Batch import failed");

      setResults((prev) =>
        prev.map((r) =>
          storeIds.includes(r.id)
            ? { ...r, inPipeline: true, pipelineStage: "new_lead" }
            : r,
        ),
      );
      setSelected(new Set());
    } catch {
      // Silently handle
    } finally {
      setBatchImporting(false);
    }
  }, [selected, results]);

  // ---------- Saved Searches ----------

  const saveCurrentSearch = useCallback(async () => {
    if (!saveName.trim() || !location.trim()) return;
    try {
      const res = await fetch("/api/discovery/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: saveName.trim(),
          location: location.trim(),
          radiusMiles: radius,
          keywords: keywords.trim() || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSavedSearches((prev) => [...prev, data]);
      }
    } catch {
      // Silently handle
    }
    setSaveName("");
    setSaveDialogOpen(false);
  }, [saveName, location, radius, keywords]);

  const loadSavedSearch = useCallback(
    (saved: SavedSearch) => {
      setLocation(saved.location);
      setRadius(saved.radiusMiles);
      setKeywords(saved.keywords ?? "");
      setSavedDropdownOpen(false);
      // Run search with the saved location after state updates
      setTimeout(() => runSearch(saved.location), 0);
    },
    [runSearch],
  );

  const deleteSavedSearch = useCallback(async (id: string) => {
    try {
      await fetch("/api/discovery/saved", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setSavedSearches((prev) => prev.filter((s) => s.id !== id));
    } catch {
      // Silently handle
    }
  }, []);

  // Load saved searches on mount
  useState(() => {
    fetch("/api/discovery/saved")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setSavedSearches(data);
        else if (data?.searches) setSavedSearches(data.searches);
      })
      .catch(() => {});
  });

  // ---------- Save to List ----------

  const openSaveToList = useCallback(async () => {
    setSaveToListOpen(true);
    setSavedToList(false);
    setNewListName("");
    try {
      const res = await fetch("/api/lists");
      if (res.ok) {
        const data = await res.json();
        setUserLists(data.lists ?? []);
      }
    } catch {
      // silently handle
    }
  }, []);

  // storeIds to save — either batch (selected) or single (detailStore)
  const getStoreIdsToSave = useCallback((): { ids: string[]; items: DiscoveryResult[] } => {
    if (selected.size > 0) {
      const items = results.filter((r) => selected.has(r.id));
      return { ids: items.map((r) => r.id), items };
    }
    if (detailStore) {
      return { ids: [detailStore.id], items: [detailStore] };
    }
    return { ids: [], items: [] };
  }, [selected, results, detailStore]);

  const saveToExistingList = useCallback(
    async (listId: string) => {
      const { ids, items } = getStoreIdsToSave();
      if (ids.length === 0) return;
      setSavingToList(true);
      try {
        if (ids.length === 1) {
          const store = items[0];
          await fetch(`/api/lists/${listId}/items`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              storeId: store.id,
              storeName: store.name,
              storeAddress: store.address,
              storePhone: detail?.phone ?? null,
              storeLat: String(store.lat),
              storeLng: String(store.lng),
              storeRating: store.rating != null ? String(store.rating) : null,
              ownerName: enrichment?.owner?.name ?? null,
              ownerPhone: enrichment?.owner?.phone ?? null,
            }),
          });
        } else {
          // Batch — send all store IDs
          await fetch(`/api/lists/${listId}/items`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ storeIds: ids }),
          });
        }
        setSavedToList(true);
        setSelected(new Set());
        setTimeout(() => setSaveToListOpen(false), 800);
      } catch {
        // silently handle
      } finally {
        setSavingToList(false);
      }
    },
    [getStoreIdsToSave, detail, enrichment],
  );

  const saveToNewList = useCallback(async () => {
    if (!newListName.trim()) return;
    const { ids } = getStoreIdsToSave();
    if (ids.length === 0) return;
    setSavingToList(true);
    try {
      const createRes = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newListName.trim() }),
      });
      if (createRes.ok) {
        const newList = await createRes.json();
        await saveToExistingList(newList.id);
      }
    } catch {
      // silently handle
    } finally {
      setSavingToList(false);
    }
  }, [newListName, getStoreIdsToSave, saveToExistingList]);

  // ---------- Selection helpers ----------

  const lastCheckedRef = useRef<number | null>(null);

  const toggleSelect = (id: string, shiftKey?: boolean) => {
    const idx = results.findIndex((r) => r.id === id);

    if (shiftKey && lastCheckedRef.current !== null && idx !== -1) {
      // Shift-click: select range between last clicked and current
      const start = Math.min(lastCheckedRef.current, idx);
      const end = Math.max(lastCheckedRef.current, idx);
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          next.add(results[i].id);
        }
        return next;
      });
    } else {
      // Normal click: toggle single
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }

    lastCheckedRef.current = idx;
  };

  const selectAll = () => {
    if (selected.size === results.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(results.map((r) => r.id)));
    }
  };

  const selectableCount = results.filter(
    (r) => !r.inPipeline && selected.has(r.id),
  ).length;

  // Map markers (all results — map shows everything)
  const mapMarkers: MapMarker[] = results
    .filter((r) => r.lat && r.lng)
    .map((r) => ({
      id: r.id,
      lat: r.lat,
      lng: r.lng,
      name: r.name,
    }));

  // Visible results — filtered to what's on screen in the map
  const visibleResults = viewport
    ? results.filter((r) => {
        if (!r.lat || !r.lng) return true; // show items without coords
        return (
          r.lat >= viewport.swLat &&
          r.lat <= viewport.neLat &&
          r.lng >= viewport.swLng &&
          r.lng <= viewport.neLng
        );
      })
    : results;

  // ---------- Render ----------

  return (
    <main className="h-[calc(100vh)] overflow-y-auto px-3 py-3 md:px-5 md:py-5">
      {/* Header */}
      <div className="mb-5">
        <h1 className="font-display text-xl font-bold">{t("discovery.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("discovery.subtitle")}
        </p>
      </div>

      {/* Map + panel container */}
      <div className="relative overflow-hidden rounded-xl border border-border/50 shadow-sm" style={{ height: "calc(100vh - 130px)" }}>
        {/* Map fills the rounded box */}
        <div className="absolute inset-0">
          <DiscoveryMap
            markers={mapMarkers}
            selectedId={highlightedId}
            keepViewport={keepViewportRef.current}
            onViewportChanged={setViewport}
            onMarkerClick={(id) => {
              setHighlightedId(id);
              const el = document.getElementById(`result-${id}`);
              el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
              const store = results.find((r) => r.id === id);
              if (store) openDetail(store);
            }}
            onSearchThisArea={async (bounds: MapBounds) => {
              // Persist viewport to URL
              const params = new URLSearchParams();
              params.set("lat", bounds.centerLat.toFixed(5));
              params.set("lng", bounds.centerLng.toFixed(5));
              params.set("vr", String(bounds.radiusMiles));
              if (keywords.trim()) params.set("kw", keywords.trim());
              router.replace(`/discovery?${params.toString()}`, { scroll: false });

              setLoading(true);
              setError(null);
              setHasSearched(true);
              setSelected(new Set());
              setHighlightedId(null);
              keepViewportRef.current = true;
              try {
                const res = await fetch("/api/discovery/search", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    location: location.trim() || "stores",
                    radiusMiles: bounds.radiusMiles,
                    keywords: keywords.trim() || undefined,
                    centerLat: bounds.centerLat,
                    centerLng: bounds.centerLng,
                  }),
                });
                if (!res.ok) throw new Error("Search failed");
                const data = await res.json();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const mapped: DiscoveryResult[] = (data.results ?? []).map((r: any) => ({
                  id: r.id,
                  placeId: r.placeId ?? "",
                  name: r.name ?? "Unknown",
                  address: r.address ?? "",
                  lat: r.lat ?? 0,
                  lng: r.lng ?? 0,
                  rating: r.rating ?? undefined,
                  ratingCount: r.userRatingCount ?? undefined,
                  businessStatus: r.businessStatus ?? undefined,
                  inPipeline: r.alreadyInPipeline ?? false,
                  pipelineStage: r.pipelineStage ?? undefined,
                }));
                setResults(mapped);
                setResultCount(data.count ?? mapped.length);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Search failed");
              } finally {
                setLoading(false);
              }
            }}
          />
        </div>

        {/* Left overlay panel */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 md:inset-y-0 md:inset-x-auto md:left-0 z-10 flex w-full md:w-[380px] flex-col p-2 md:p-3">
          <div className="pointer-events-auto flex flex-col gap-2 overflow-hidden rounded-xl bg-background/95 max-h-[55vh] md:max-h-none shadow-xl ring-1 ring-foreground/10 backdrop-blur-sm">
          {/* Search controls */}
          <div className="space-y-2 p-3 pb-0">
            <div className="flex items-center gap-2">
              <Input
                placeholder={t("discovery.search.placeholder")}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
                className="flex-1"
              />
              <select
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="h-8 w-20 md:w-24 shrink-0 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring"
              >
                {RADIUS_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r} mi
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                onClick={() => runSearch()}
                disabled={loading || !location.trim()}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </Button>
            </div>

            {/* Keywords */}
            <Input
              placeholder={locale === "es" ? "Palabras clave: 3PL, cumplimiento, almacenamiento frío, flete..." : "Keywords: 3PL, fulfillment, cold storage, freight..."}
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              className="text-xs h-7"
            />
            <p className="text-[10px] text-muted-foreground/60 -mt-1 px-1">
              {locale === "es"
                ? "Dejar vacío para buscar: 3PL warehouse, third party logistics, fulfillment center, warehouse logistics, freight broker"
                : "Leave empty for defaults: 3PL warehouse, third party logistics, fulfillment center, warehouse logistics, freight broker"}
            </p>

            {/* State quick filters */}
            <div className="flex flex-wrap items-center gap-1 overflow-x-auto">
              {SE_STATES.map((state) => (
                <button
                  key={state}
                  type="button"
                  onClick={() => {
                    setLocation(STATE_NAMES[state]);
                    setTimeout(() => runSearch(STATE_NAMES[state]), 0);
                  }}
                  className={cn(
                    "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
                    location === STATE_NAMES[state]
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                  )}
                >
                  {state}
                </button>
              ))}

              {/* Saved searches */}
              <div className="ml-auto flex items-center gap-1">
                {savedSearches.length > 0 && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setSavedDropdownOpen(!savedDropdownOpen)}
                      className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Bookmark className="h-3 w-3 fill-current" />
                      {savedSearches.length}
                    </button>
                    {savedDropdownOpen && (
                      <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded-lg border bg-popover p-1 shadow-lg ring-1 ring-foreground/10">
                        {savedSearches.map((s) => (
                          <div
                            key={s.id}
                            className="group flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                          >
                            <button
                              type="button"
                              className="flex-1 text-left"
                              onClick={() => loadSavedSearch(s)}
                            >
                              <span className="font-medium">{s.name}</span>
                              <span className="ml-1 text-xs text-muted-foreground">
                                {s.radiusMiles}mi
                              </span>
                            </button>
                            <button
                              type="button"
                              className="ml-2 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                              onClick={() => deleteSavedSearch(s.id)}
                            >
                              x
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Results list */}
          <div className="overflow-y-auto flex-1 min-h-0" style={{ maxHeight: "calc(50vh - 120px)" }}>
            {/* Empty state */}
            {!hasSearched && !loading && (
              <div className="px-3 py-8 text-center">
                <Compass className="mx-auto h-8 w-8 text-muted-foreground/40" />
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("discovery.search.empty")}
                </p>
              </div>
            )}

            {/* Loading */}
            {loading && (
              <div className="px-3 py-8 text-center">
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
                <p className="mt-2 text-sm text-muted-foreground animate-pulse">
                  {locale === "es" ? "Buscando empresas..." : "Searching companies..."}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground/50">
                  {locale === "es"
                    ? "Las busquedas por estado pueden tomar 15-20 segundos"
                    : "State-wide searches may take 15-20 seconds"}
                </p>
              </div>
            )}

            {/* Error */}
            {error && !loading && (
              <div className="px-3 py-6 text-center">
                <p className="text-sm text-destructive">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => runSearch()}
                >
                  Retry
                </Button>
              </div>
            )}

            {/* No results */}
            {hasSearched && !loading && !error && results.length === 0 && (
              <div className="px-3 py-8 text-center">
                <MapPin className="mx-auto h-8 w-8 text-muted-foreground/40" />
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("discovery.noResults")}
                </p>
              </div>
            )}

            {/* Results */}
            {hasSearched && !loading && !error && results.length > 0 && (
              <div className="space-y-0">
                {/* Header — sticky */}
                <div className="sticky top-0 z-10 flex items-center gap-2 bg-background/95 backdrop-blur-sm px-3 py-1.5 border-b border-border/30">
                  {/* Select all checkbox */}
                  <button
                    type="button"
                    onClick={selectAll}
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                      selected.size === results.length && results.length > 0
                        ? "border-primary bg-primary text-primary-foreground"
                        : selected.size > 0
                          ? "border-primary bg-primary/20"
                          : "border-input hover:border-primary/50",
                    )}
                  >
                    {selected.size === results.length && results.length > 0 && (
                      <Check className="h-3 w-3" />
                    )}
                    {selected.size > 0 && selected.size < results.length && (
                      <span className="h-1.5 w-1.5 rounded-sm bg-primary" />
                    )}
                  </button>

                  <p className="text-xs font-medium text-muted-foreground flex-1">
                    {selected.size > 0
                      ? `${selected.size} / ${resultCount} ${locale === "es" ? "seleccionadas" : "selected"}`
                      : visibleResults.length < results.length
                        ? `${visibleResults.length} / ${resultCount} ${locale === "es" ? "visibles" : "visible"}`
                        : `${resultCount} ${t("discovery.storesFound")}`}
                  </p>

                  {/* Batch actions */}
                  {selected.size > 0 && (
                    <div className="flex items-center gap-1">
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={openSaveToList}
                      >
                        <List className="h-3 w-3" />
                        {locale === "es" ? "Guardar" : "Save"} {selected.size}
                      </Button>
                    </div>
                  )}
                </div>

                {/* Cards */}
                {visibleResults.map((result) => (
                  <ResultCard
                    key={result.id}
                    result={result}
                    isSelected={detailStore?.id === result.id}
                    isChecked={selected.has(result.id)}
                    isHighlighted={highlightedId === result.id}
                    isImporting={importing.has(result.id)}
                    onToggleSelect={() => openDetail(result)}
                    onToggleCheck={(shiftKey) => toggleSelect(result.id, shiftKey)}
                    onImport={() => importStore(result.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

        {/* Right detail panel */}
        {detailStore && (
          <div className="pointer-events-none absolute inset-0 md:inset-y-0 md:inset-x-auto md:right-0 z-10 flex w-full md:w-[360px] flex-col p-2 md:p-3">
            <div className="pointer-events-auto flex flex-col overflow-hidden rounded-xl bg-background/95 shadow-xl ring-1 ring-foreground/10 backdrop-blur-sm">
              {/* Close button */}
              <div className="flex items-center justify-between border-b px-3 py-2">
                <p className="text-sm font-semibold truncate">{detailStore.name}</p>
                <button
                  type="button"
                  onClick={() => { setDetailStore(null); setDetail(null); }}
                  className="text-muted-foreground hover:text-foreground text-lg leading-none"
                >
                  &times;
                </button>
              </div>

              <div className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 240px)" }}>
                {detailLoading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                )}

                {detail && (
                  <div className="space-y-3 p-3">
                    {/* Photos */}
                    {detail.photos.length > 0 && (
                      <div className="flex gap-1.5 overflow-x-auto pb-1">
                        {detail.photos.map((url, i) => (
                          <img
                            key={i}
                            src={url}
                            alt={`${detailStore.name} photo ${i + 1}`}
                            className="h-32 w-44 shrink-0 rounded-lg object-cover"
                          />
                        ))}
                      </div>
                    )}

                    {/* Address */}
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">{t("detail.address")}</p>
                      <p className="text-sm">{detail.address}</p>
                    </div>

                    {/* Phone */}
                    {detail.phone && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">{t("detail.phone")}</p>
                        <a href={`tel:${detail.phone}`} className="text-sm text-primary hover:underline">
                          {detail.phone}
                        </a>
                      </div>
                    )}

                    {/* Rating */}
                    {detail.rating != null && (
                      <div className="flex items-center gap-1">
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                        <span className="text-sm font-medium">{detail.rating.toFixed(1)}</span>
                        {detail.ratingCount != null && (
                          <span className="text-xs text-muted-foreground">
                            ({detail.ratingCount} {t("detail.reviews")})
                          </span>
                        )}
                      </div>
                    )}

                    {/* Hours */}
                    {detail.hours && detail.hours.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">{t("detail.hours")}</p>
                        <div className="space-y-0.5">
                          {detail.hours.map((h, i) => (
                            <p key={i} className="text-xs text-muted-foreground">{h}</p>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Links */}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {detail.googleMapsUrl && (
                        <a
                          href={detail.googleMapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs font-medium hover:bg-secondary/80"
                        >
                          <MapPin className="h-3 w-3" />
                          {locale === "es" ? "Ver en Mapa" : "Google Maps"}
                        </a>
                      )}
                      {detail.website && (
                        <a
                          href={detail.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs font-medium hover:bg-secondary/80"
                        >
                          {locale === "es" ? "Sitio Web" : "Website"}
                        </a>
                      )}
                    </div>

                    {/* Enrichment — AI Sales Brief */}
                    {enrichLoading && (
                      <div className="border-t pt-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          {locale === "es" ? "Analizando empresa — leyendo reseñas, sitio web..." : "Analyzing company — reading reviews, website..."}
                        </div>
                      </div>
                    )}

                    {enrichment?.owner && (
                      <div className="border-t pt-3 space-y-1">
                        <p className="text-xs font-semibold text-primary uppercase tracking-wider">{locale === "es" ? "Contacto Principal" : "Key Contact"}</p>
                        {enrichment.owner.name && (
                          <p className="text-sm font-medium">{enrichment.owner.name}
                            {enrichment.owner.title && (
                              <span className="ml-1 text-xs text-muted-foreground">— {enrichment.owner.title}</span>
                            )}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                          {enrichment.owner.phone && (
                            <a href={`tel:${enrichment.owner.phone}`} className="text-primary hover:underline">
                              {enrichment.owner.phone}
                            </a>
                          )}
                          {enrichment.owner.email && (
                            <a href={`mailto:${enrichment.owner.email}`} className="text-primary hover:underline">
                              {enrichment.owner.email}
                            </a>
                          )}
                          {enrichment.owner.linkedin && (
                            <a href={enrichment.owner.linkedin} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                              LinkedIn
                            </a>
                          )}
                        </div>
                      </div>
                    )}

                    {enrichment?.summary && (
                      <div className="border-t pt-3 space-y-2.5">
                        <p className="text-xs font-semibold text-primary uppercase tracking-wider">
                          {locale === "es" ? "Resumen de Ventas IA" : "AI Sales Brief"}
                        </p>

                        {/* Overview */}
                        <p className="text-xs leading-relaxed">{enrichment.summary.overview}</p>

                        {/* Products */}
                        {enrichment.summary.productsCarried.length > 0 && (
                          <div>
                            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                              {locale === "es" ? "Servicios Ofrecidos" : "Services Offered"}
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {enrichment.summary.productsCarried.map((p, i) => (
                                <span key={i} className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium">
                                  {p}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Size + Revenue */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-lg bg-muted/50 p-2">
                            <p className="text-[10px] text-muted-foreground">
                              {locale === "es" ? "Tamaño" : "Size"}
                            </p>
                            <p className="text-xs font-semibold">{enrichment.summary.estimatedSize}</p>
                          </div>
                          <div className="rounded-lg bg-muted/50 p-2">
                            <p className="text-[10px] text-muted-foreground">
                              {locale === "es" ? "Ingresos Est." : "Est. Revenue"}
                            </p>
                            <p className="text-xs font-semibold">{enrichment.summary.estimatedRevenue}</p>
                          </div>
                        </div>

                        {/* Customer Base */}
                        <div>
                          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
                            {locale === "es" ? "Base de Clientes" : "Customer Base"}
                          </p>
                          <p className="text-xs text-muted-foreground">{enrichment.summary.customerBase}</p>
                        </div>

                        {/* Sales Angle */}
                        <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5">
                          <p className="text-[10px] font-semibold text-primary uppercase tracking-wider mb-0.5">
                            {locale === "es" ? "Ángulo de Venta" : "Sales Angle"}
                          </p>
                          <p className="text-xs leading-relaxed">{enrichment.summary.salesAngle}</p>
                        </div>

                        {/* Sources */}
                        <p className="text-[10px] text-muted-foreground/50">
                          {locale === "es" ? "Fuentes" : "Sources"}: {enrichment.sources.join(", ")}
                        </p>
                      </div>
                    )}

                    {/* View full details link */}
                    <div className="border-t pt-3">
                      <Link
                        href={`/discovery/store/${detailStore.id}`}
                        className="flex items-center justify-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
                      >
                        {locale === "es" ? "Ver detalles completos" : "View full details"}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>

                    {/* Actions */}
                    <div className="border-t pt-3 space-y-2">
                      {detailStore.inPipeline ? (
                        <div className="flex items-center gap-1.5 text-sm text-emerald-600">
                          <Check className="h-4 w-4" />
                          {t("discovery.alreadyInPipeline")}
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          className="w-full"
                          disabled={importing.has(detailStore.id)}
                          onClick={() => importStore(detailStore.id)}
                        >
                          {importing.has(detailStore.id) ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Plus className="h-4 w-4" />
                          )}
                          {t("discovery.addToPipeline")}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={openSaveToList}
                      >
                        <List className="h-4 w-4" />
                        {t("lists.saveToList")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Save search dialog */}
        <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("discovery.saveSearch")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Input
                placeholder={t("discovery.saveSearch.placeholder")}
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveCurrentSearch()}
              />
              <p className="text-xs text-muted-foreground">
                {location} — {radius} mi
              </p>
            </div>
            <DialogFooter>
              <Button onClick={saveCurrentSearch} disabled={!saveName.trim()}>
                {t("discovery.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Save to list dialog */}
        <Dialog open={saveToListOpen} onOpenChange={setSaveToListOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("lists.saveToList")}</DialogTitle>
            </DialogHeader>
            {savedToList ? (
              <div className="flex items-center justify-center gap-2 py-4 text-emerald-600">
                <Check className="h-5 w-5" />
                <span className="font-medium">{t("lists.saved")}</span>
              </div>
            ) : (
              <div className="space-y-3">
                {userLists.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t("lists.selectList")}
                    </p>
                    <div className="max-h-48 space-y-1 overflow-y-auto">
                      {userLists.map((list) => (
                        <button
                          key={list.id}
                          type="button"
                          onClick={() => saveToExistingList(list.id)}
                          disabled={savingToList}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-left hover:bg-muted transition-colors disabled:opacity-50"
                        >
                          <List className="h-4 w-4 shrink-0 text-muted-foreground" />
                          {list.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t("lists.orCreateNew")}
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder={t("lists.namePlaceholder")}
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && saveToNewList()}
                      className="flex-1"
                    />
                    <Button
                      size="sm"
                      onClick={saveToNewList}
                      disabled={!newListName.trim() || savingToList}
                    >
                      {savingToList ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </main>
  );
}

// ---------- Sub-components ----------

function EmptyState() {
  return (
    <div className="py-24 text-center">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-primary/10">
        <Compass className="h-8 w-8 text-primary" />
      </div>
      <h2 className="mt-4 font-display text-lg">Discover 3PLs</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Search for 3PL warehouses, fulfillment centers, and logistics companies
        in the Atlanta area. Find partners and add them directly to your pipeline.
      </p>
    </div>
  );
}

function ResultCard({
  result,
  isSelected,
  isChecked,
  isHighlighted,
  isImporting,
  onToggleSelect,
  onToggleCheck,
  onImport,
}: {
  result: DiscoveryResult;
  isSelected: boolean;
  isChecked: boolean;
  isHighlighted: boolean;
  isImporting: boolean;
  onToggleSelect: () => void;
  onToggleCheck: (shiftKey: boolean) => void;
  onImport: () => void;
}) {
  const { t, locale } = useI18n();
  return (
    <div
      id={`result-${result.id}`}
      onClick={onToggleSelect}
      className={cn(
        "cursor-pointer border-b border-border/50 px-3 py-2.5 transition-colors hover:bg-muted/50",
        isSelected && "bg-primary/10 border-l-2 border-l-primary",
        isHighlighted && !isSelected && "bg-muted/70",
      )}
    >
      <div className="flex items-start gap-2">
        {/* Checkbox */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleCheck(e.shiftKey); }}
          className={cn(
            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
            isChecked
              ? "border-primary bg-primary text-primary-foreground"
              : "border-input hover:border-primary/50",
          )}
        >
          {isChecked && <Check className="h-3 w-3" />}
        </button>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-tight truncate">
            {result.name}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground truncate">
            {result.address}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {result.rating != null && (
              <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                {result.rating.toFixed(1)}
                {result.ratingCount != null && (
                  <span className="text-muted-foreground/70">
                    ({result.ratingCount})
                  </span>
                )}
              </span>
            )}
            {result.inPipeline && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                <Check className="h-2.5 w-2.5" />
                {t("discovery.inPipeline")}
              </span>
            )}
            <Link
              href={`/discovery/store/${result.id}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-0.5 text-[10px] font-medium text-primary hover:underline"
            >
              {locale === "es" ? "Ver detalles" : "View details"}
              <ArrowRight className="h-2.5 w-2.5" />
            </Link>
          </div>
        </div>

        <Button
          variant="outline"
          size="xs"
          disabled={result.inPipeline || isImporting}
          onClick={(e) => {
            e.stopPropagation();
            onImport();
          }}
          className="shrink-0 mt-0.5"
        >
          {isImporting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : result.inPipeline ? (
            <Check className="h-3 w-3" />
          ) : (
            <Plus className="h-3 w-3" />
          )}
          {result.inPipeline ? t("discovery.added") : t("discovery.add")}
        </Button>
      </div>
    </div>
  );
}
