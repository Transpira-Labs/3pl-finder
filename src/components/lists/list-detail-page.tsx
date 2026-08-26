"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface StoreList {
  id: string;
  name: string;
  description: string | null;
  storeCount: number;
}

interface ListItem {
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
}

interface OptimizeResult {
  googleMapsUrl: string;
  totalDistanceMeters: number;
  totalDuration: string;
}

function formatDuration(dur: string): string {
  const seconds = parseInt(dur.replace("s", ""), 10);
  if (isNaN(seconds)) return dur;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatDistance(meters: number): string {
  const miles = meters / 1609.34;
  return `${miles.toFixed(1)} mi`;
}

// Parse city from address like "123 Main St, Atlanta, GA 30309, USA"
function parseCity(address: string | null): string {
  if (!address) return "";
  const parts = address.split(",").map((s) => s.trim());
  return parts.length >= 3 ? parts[parts.length - 3] : "";
}

const DEFAULT_START = "Atlanta, GA";

export function ListDetailPage() {
  const { t, locale } = useI18n();
  const es = locale === "es";
  const params = useParams();
  const router = useRouter();
  const listId = params.id as string;

  const [list, setList] = useState<StoreList | null>(null);
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Route
  const [startAddress, setStartAddress] = useState(DEFAULT_START);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState<OptimizeResult | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    try {
      const res = await fetch(`/api/lists/${listId}`);
      if (res.ok) {
        const data = await res.json();
        setList(data.list);
        setItems(data.items ?? []);
        return data.items?.length ?? 0;
      } else if (res.status === 404) {
        router.push("/lists");
      }
    } catch {
      // silently handle
    } finally {
      setLoading(false);
    }
    return 0;
  }, [listId, router]);

  const runOptimize = useCallback(async (address?: string) => {
    setOptimizing(true);
    setRouteError(null);
    try {
      const res = await fetch(`/api/lists/${listId}/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startAddress: address ?? startAddress }),
      });
      if (res.ok) {
        const result = await res.json();
        setOptimizeResult(result);
        await fetchList(); // re-fetch to get updated positions
      } else {
        const data = await res.json().catch(() => null);
        setRouteError(data?.error ?? "Route optimization failed");
      }
    } catch {
      setRouteError("Route optimization failed");
    } finally {
      setOptimizing(false);
    }
  }, [listId, startAddress, fetchList]);

  // Load list + auto-optimize on mount
  useEffect(() => {
    let cancelled = false;
    async function init() {
      const count = await fetchList();
      if (!cancelled && count >= 2) {
        runOptimize(DEFAULT_START);
      }
    }
    init();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId]);

  const handleRemove = async (storeId: string) => {
    try {
      await fetch(`/api/lists/${listId}/items`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId }),
      });
      setItems((prev) => prev.filter((i) => i.storeId !== storeId));
      if (list) setList({ ...list, storeCount: list.storeCount - 1 });
    } catch {
      // silently handle
    }
  };

  if (loading) {
    return (
      <main className="flex h-[calc(100vh)] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </main>
    );
  }

  if (!list) return null;

  return (
    <main className="h-[calc(100vh)] overflow-y-auto px-3 py-3 md:px-6 md:py-5">
      {/* Header */}
      <div className="mb-5">
        <Link
          href="/lists"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("lists.title")}
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-bold">{list.name}</h1>
            {list.description && (
              <p className="mt-1 text-sm text-muted-foreground">{list.description}</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {list.storeCount} {t("lists.stores")}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => window.open(`/api/lists/${listId}/export`, "_blank")}>
            <Download className="mr-1.5 h-4 w-4" />
            {t("lists.export")}
          </Button>
        </div>
      </div>

      {/* Route optimizer — starting location + results */}
      {items.length >= 2 && (
        <div className="mb-5 rounded-xl border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Navigation className="h-4 w-4 text-primary shrink-0" />
            <p className="text-sm font-semibold">{es ? "Ruta Optimizada" : "Optimized Route"}</p>
          </div>

          {/* Starting location input */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="text-xs text-muted-foreground shrink-0">
              {es ? "Salida:" : "Start:"}
            </label>
            <Input
              value={startAddress}
              onChange={(e) => setStartAddress(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runOptimize()}
              placeholder={es ? "Dirección de salida..." : "Starting address..."}
              className="flex-1 h-8 text-sm"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => runOptimize()}
              disabled={optimizing || !startAddress.trim()}
            >
              {optimizing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Navigation className="h-3.5 w-3.5" />}
              {optimizing
                ? (es ? "Calculando..." : "Calculating...")
                : (es ? "Recalcular" : "Recalculate")}
            </Button>
          </div>

          {/* Route results */}
          {optimizeResult && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-lg bg-primary/5 border border-primary/20 px-3 py-3 md:px-4">
              <div className="flex items-center gap-4 text-sm">
                <span>
                  <span className="text-muted-foreground">{es ? "Distancia:" : "Distance:"}</span>{" "}
                  <span className="font-semibold">{formatDistance(optimizeResult.totalDistanceMeters)}</span>
                </span>
                <span>
                  <span className="text-muted-foreground">{es ? "Tiempo:" : "Time:"}</span>{" "}
                  <span className="font-semibold">{formatDuration(optimizeResult.totalDuration)}</span>
                </span>
              </div>
              <a
                href={optimizeResult.googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
                {t("lists.openInMaps")}
              </a>
            </div>
          )}

          {routeError && (
            <p className="text-xs text-destructive">{routeError}</p>
          )}
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <MapPin className="h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground max-w-md">
            {t("lists.noStores")}
          </p>
          <Link href="/discovery">
            <Button variant="outline" size="sm" className="mt-3">
              {t("nav.discover")}
            </Button>
          </Link>
        </div>
      )}

      {/* Table */}
      {items.length > 0 && (
        <div className="rounded-xl border shadow-sm overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>{es ? "Empresa" : "Company"}</TableHead>
                <TableHead>{es ? "Dirección" : "Address"}</TableHead>
                <TableHead>{es ? "Ciudad" : "City"}</TableHead>
                <TableHead>{es ? "Teléfono" : "Phone"}</TableHead>
                <TableHead>{es ? "Contacto" : "Contact"}</TableHead>
                <TableHead>{es ? "Tel. Contacto" : "Contact Phone"}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, idx) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {item.position ?? idx + 1}
                  </TableCell>
                  <TableCell className="font-medium">{item.storeName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[150px] md:max-w-[200px] truncate">
                    {item.storeAddress ?? "-"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {parseCity(item.storeAddress)}
                  </TableCell>
                  <TableCell>
                    {item.storePhone ? (
                      <a href={`tel:${item.storePhone}`} className="text-sm text-primary hover:underline inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {item.storePhone}
                      </a>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{item.ownerName ?? "-"}</TableCell>
                  <TableCell>
                    {item.ownerPhone ? (
                      <a href={`tel:${item.ownerPhone}`} className="text-sm text-primary hover:underline">
                        {item.ownerPhone}
                      </a>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => handleRemove(item.storeId)}
                      className="rounded-md p-1 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </main>
  );
}
