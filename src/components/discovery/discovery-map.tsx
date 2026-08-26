"use client";

/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  interface Window {
    google?: typeof google;
  }
  namespace google.maps {
    class Map {
      constructor(el: HTMLElement, opts: MapOptions);
      fitBounds(bounds: LatLngBounds, padding?: number): void;
      getBounds(): LatLngBounds | undefined;
      getCenter(): LatLng | undefined;
      getZoom(): number;
      setZoom(zoom: number): void;
      addListener(event: string, handler: () => void): void;
    }
    class Marker {
      constructor(opts: MarkerOptions);
      setMap(map: Map | null): void;
      setIcon(icon: SymbolOptions): void;
      getPosition(): LatLng | null;
      addListener(event: string, handler: () => void): void;
    }
    class InfoWindow {
      constructor(opts?: InfoWindowOptions);
      open(opts: { anchor: Marker; map: Map }): void;
      close(): void;
    }
    class LatLngBounds {
      extend(point: LatLng | { lat: number; lng: number }): void;
      getNorthEast(): LatLng;
      getSouthWest(): LatLng;
    }
    class LatLng {
      lat(): number;
      lng(): number;
    }
    interface MapOptions {
      center: { lat: number; lng: number };
      zoom: number;
      mapTypeControl?: boolean;
      streetViewControl?: boolean;
      fullscreenControl?: boolean;
      gestureHandling?: string;
      maxZoom?: number;
      styles?: Array<{ featureType?: string; elementType?: string; stylers: Array<Record<string, string>> }>;
    }
    interface MarkerOptions {
      position: { lat: number; lng: number };
      map: Map;
      title?: string;
      icon?: SymbolOptions;
    }
    interface InfoWindowOptions {
      content?: string;
      disableAutoPan?: boolean;
    }
    interface SymbolOptions {
      path: number;
      scale: number;
      fillColor: string;
      fillOpacity: number;
      strokeColor: string;
      strokeWeight: number;
    }
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class SymbolPath {
      static CIRCLE: number;
    }
  }
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  name: string;
}

export interface MapBounds {
  centerLat: number;
  centerLng: number;
  radiusMiles: number;
}

export interface MapViewport {
  neLat: number;
  neLng: number;
  swLat: number;
  swLng: number;
}

interface DiscoveryMapProps {
  markers: MapMarker[];
  selectedId: string | null;
  keepViewport?: boolean;
  onSearchThisArea?: (bounds: MapBounds) => void;
  onMarkerClick: (id: string) => void;
  onViewportChanged?: (viewport: MapViewport) => void;
}

const DEFAULT_CENTER = { lat: 33.749, lng: -84.388 }; // Atlanta, GA
const DEFAULT_ZOOM = 7;

let googleMapsPromise: Promise<void> | null = null;

function loadGoogleMaps(): Promise<void> {
  if (googleMapsPromise) return googleMapsPromise;

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
  if (!apiKey) {
    return Promise.reject(new Error("NEXT_PUBLIC_GOOGLE_MAPS_KEY is not set"));
  }

  googleMapsPromise = new Promise<void>((resolve, reject) => {
    if (typeof window !== "undefined" && window.google?.maps) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(script);
  });

  return googleMapsPromise;
}

/**
 * Find the densest cluster of markers and return a bounds that contains
 * the majority of results, ignoring distant outliers.
 */
function getDenseBounds(markers: MapMarker[]): google.maps.LatLngBounds {
  const bounds = new google.maps.LatLngBounds();

  if (markers.length <= 3) {
    markers.forEach((m) => bounds.extend({ lat: m.lat, lng: m.lng }));
    return bounds;
  }

  // Compute centroid
  const centLat = markers.reduce((s, m) => s + m.lat, 0) / markers.length;
  const centLng = markers.reduce((s, m) => s + m.lng, 0) / markers.length;

  // Sort by distance from centroid
  const sorted = [...markers].sort((a, b) => {
    const dA = (a.lat - centLat) ** 2 + (a.lng - centLng) ** 2;
    const dB = (b.lat - centLat) ** 2 + (b.lng - centLng) ** 2;
    return dA - dB;
  });

  // Include the closest 80% of markers (drop far outliers)
  const cutoff = Math.max(3, Math.ceil(sorted.length * 0.8));
  for (let i = 0; i < cutoff; i++) {
    bounds.extend({ lat: sorted[i].lat, lng: sorted[i].lng });
  }

  return bounds;
}

export function DiscoveryMap({
  markers,
  selectedId,
  keepViewport,
  onMarkerClick,
  onSearchThisArea,
  onViewportChanged,
}: DiscoveryMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const markerIdMapRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const prevSelectedRef = useRef<string | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const programmaticMoveRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable refs to avoid recreating listeners on callback changes
  const onMarkerClickRef = useRef(onMarkerClick);
  onMarkerClickRef.current = onMarkerClick;
  const onSearchThisAreaRef = useRef(onSearchThisArea);
  onSearchThisAreaRef.current = onSearchThisArea;
  const onViewportChangedRef = useRef(onViewportChanged);
  onViewportChangedRef.current = onViewportChanged;

  const defaultIcon: google.maps.SymbolOptions = useMemo(() => ({
    path: loaded && window.google?.maps?.SymbolPath ? google.maps.SymbolPath.CIRCLE : 0,
    scale: 7,
    fillColor: "#3b82f6",
    fillOpacity: 0.9,
    strokeColor: "#fff",
    strokeWeight: 1.5,
  }), [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedIcon: google.maps.SymbolOptions = useMemo(() => ({
    path: loaded && window.google?.maps?.SymbolPath ? google.maps.SymbolPath.CIRCLE : 0,
    scale: 10,
    fillColor: "#7c3aed",
    fillOpacity: 1,
    strokeColor: "#fff",
    strokeWeight: 2,
  }), [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load Google Maps script
  useEffect(() => {
    loadGoogleMaps()
      .then(() => setLoaded(true))
      .catch((err) => setError(err.message));
  }, []);

  // Initialize map once loaded
  useEffect(() => {
    if (!loaded || !containerRef.current || mapRef.current) return;
    const map = new google.maps.Map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      gestureHandling: "greedy",
      maxZoom: 18,
      styles: [
        {
          featureType: "poi",
          elementType: "labels",
          stylers: [{ visibility: "off" }],
        },
      ],
    });
    mapRef.current = map;
    infoWindowRef.current = new google.maps.InfoWindow({ disableAutoPan: true });

    // Auto-search when user stops panning/zooming (debounced 800ms)
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let userInteracted = false;

    // Suppress auto-search for 2 seconds after programmatic fitBounds
    programmaticMoveRef.current = false;

    map.addListener("dragstart", () => { userInteracted = true; });
    map.addListener("zoom_changed", () => {
      // Ignore zoom changes caused by fitBounds
      if (programmaticMoveRef.current) return;
      if (markersRef.current.length > 0) userInteracted = true;
    });

    map.addListener("idle", () => {
      // Always report viewport bounds
      const idleBounds = map.getBounds?.();
      if (idleBounds && onViewportChangedRef.current) {
        const ne = idleBounds.getNorthEast();
        const sw = idleBounds.getSouthWest();
        onViewportChangedRef.current({
          neLat: ne.lat(), neLng: ne.lng(),
          swLat: sw.lat(), swLng: sw.lng(),
        });
      }

      if (!userInteracted || !onSearchThisAreaRef.current) return;
      userInteracted = false;

      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        const bounds = map.getBounds?.();
        const center = map.getCenter?.();
        if (!center || !bounds) return;

        const ne = bounds.getNorthEast();
        const sw = bounds.getSouthWest();
        const latDiff = Math.abs(ne.lat() - sw.lat()) / 2;
        const lngDiff = Math.abs(ne.lng() - sw.lng()) / 2;
        const radiusMiles = Math.round(Math.min(Math.max(latDiff, lngDiff) * 69, 100));

        onSearchThisAreaRef.current!({
          centerLat: center.lat(),
          centerLng: center.lng(),
          radiusMiles,
        });
      }, 800);
    });
  }, [loaded]);

  // Effect 1: Create/destroy markers when marker data changes (debounced)
  useEffect(() => {
    if (!loaded || !mapRef.current) return;

    // Debounce rapid marker changes (e.g. during search)
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);

    syncTimerRef.current = setTimeout(() => {
      // Clear old markers
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      markerIdMapRef.current.clear();
      infoWindowRef.current?.close();

      if (markers.length === 0) return;

      markers.forEach((m) => {
        const isSelected = m.id === selectedId;
        const marker = new google.maps.Marker({
          position: { lat: m.lat, lng: m.lng },
          map: mapRef.current!,
          title: m.name,
          icon: isSelected ? selectedIcon : defaultIcon,
        });

        // Hover: show store name
        marker.addListener("mouseover", () => {
          if (infoWindowRef.current && mapRef.current) {
            infoWindowRef.current.close();
            (infoWindowRef.current as unknown as { setContent: (s: string) => void }).setContent(
              `<div style="font-weight:600;font-size:13px;padding:2px 0">${m.name}</div>`
            );
            infoWindowRef.current.open({ anchor: marker, map: mapRef.current });
          }
        });
        marker.addListener("mouseout", () => {
          infoWindowRef.current?.close();
        });

        marker.addListener("click", () => onMarkerClickRef.current(m.id));
        markersRef.current.push(marker);
        markerIdMapRef.current.set(m.id, marker);
      });

      // Zoom to fit results — skip if keepViewport is true (e.g. auto-search)
      if (!keepViewport) {
        programmaticMoveRef.current = true;
        const bounds = getDenseBounds(markers);
        mapRef.current!.fitBounds(bounds, 40);

        setTimeout(() => {
          if (mapRef.current && mapRef.current.getZoom() > 15) {
            mapRef.current.setZoom(15);
          }
          // Re-enable user interaction detection after fitBounds settles
          setTimeout(() => { programmaticMoveRef.current = false; }, 500);
        }, 300);
      }

      prevSelectedRef.current = selectedId;
    }, 80);

    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [loaded, markers, defaultIcon, selectedIcon]); // eslint-disable-line react-hooks/exhaustive-deps

  // Effect 2: Update marker icons when selectedId changes (no recreation)
  useEffect(() => {
    if (!loaded || markerIdMapRef.current.size === 0) return;

    const prevId = prevSelectedRef.current;
    if (prevId === selectedId) return;

    // Reset previous marker to default icon
    if (prevId) {
      const prevMarker = markerIdMapRef.current.get(prevId);
      if (prevMarker) prevMarker.setIcon(defaultIcon);
    }

    // Set new marker to selected icon
    if (selectedId) {
      const newMarker = markerIdMapRef.current.get(selectedId);
      if (newMarker) newMarker.setIcon(selectedIcon);
    }

    prevSelectedRef.current = selectedId;
  }, [selectedId, loaded, defaultIcon, selectedIcon]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border bg-muted/30 p-4">
        <p className="text-sm text-muted-foreground">
          Map unavailable: {error}
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full w-full" />
  );
}
