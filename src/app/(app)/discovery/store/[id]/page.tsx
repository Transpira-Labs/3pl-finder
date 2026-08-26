"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Clock,
  ExternalLink,
  Globe,
  Loader2,
  MapPin,
  Phone,
  Plus,
  Star,
  User,
  Mail,
  Check,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

// ---------- Types ----------

interface DiscoveredStore {
  id: string;
  placeId: string;
  name: string;
  address: string | null;
  phone: string | null;
  lat: string | null;
  lng: string | null;
  rating: string | null;
  userRatingCount: number | null;
  businessStatus: string | null;
  types: string[] | null;
  status: string;
  importedLeadId: string | null;
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
    source: string | null;
  } | null;
  summary: {
    overview: string;
    productsCarried: string[];
    productsDetailed: { category: string; items: string[] }[];
    estimatedSize: string;
    estimatedRevenue: string;
    salesAngle: string;
    customerBase: string;
    ownerInsights: string | null;
  } | null;
  sosData: {
    officers: { name: string; title: string }[];
    registeredAgent: string | null;
    formationDate: string | null;
    entityType: string | null;
    status: string | null;
  } | null;
  reviewSnippets: string[];
  sources: string[];
}

// ---------- Label helpers ----------

function useLabels() {
  const { locale } = useI18n();
  const es = locale === "es";
  return {
    backToDiscovery: es ? "Volver a Descubrimiento" : "Back to Discovery",
    addToPipeline: es ? "Agregar al Pipeline" : "Add to Pipeline",
    alreadyInPipeline: es ? "Ya en Pipeline" : "Already in Pipeline",
    ownerContact: es ? "Contacto Principal" : "Key Contact",
    companyOverview: es ? "Resumen de la Empresa" : "Company Overview",
    companyInfo: es ? "Información de la Empresa" : "Company Info",
    businessRegistry: es ? "Registro Comercial" : "Business Registry",
    keyFindings: es ? "Hallazgos Clave" : "Key Findings",
    clientBase: es ? "Clientes Típicos" : "Typical Clients",
    size: es ? "Tamaño" : "Company Size",
    estRevenue: es ? "Ingresos Est." : "Est. Revenue",
    services: es ? "Servicios y Capacidades" : "Services & Capabilities",
    clientReviews: es ? "Reseñas de Clientes" : "Client Reviews",
    hours: es ? "Horario" : "Hours",
    phone: es ? "Teléfono" : "Phone",
    website: es ? "Sitio Web" : "Website",
    googleMaps: es ? "Ver en Mapa" : "Google Maps",
    entity: es ? "Tipo de Entidad" : "Entity Type",
    formed: es ? "Fecha de Formación" : "Formed",
    regStatus: es ? "Estado" : "Status",
    overview: es ? "Resumen" : "Overview",
    sources: es ? "Fuentes" : "Sources",
    loading: es ? "Cargando datos de la empresa..." : "Loading company data...",
    enriching: es ? "Investigando empresa — analizando reseñas, sitio web, servicios..." : "Researching company — analyzing reviews, website, services...",
    notFound: es ? "Empresa no encontrada" : "Company not found",
    contactInsights: es ? "Información de Contacto" : "Contact Information",
  };
}

// ---------- Photo Carousel ----------

function PhotoCarousel({ photos, name }: { photos: string[]; name: string }) {
  const [idx, setIdx] = useState(0);
  if (photos.length === 0) return null;

  return (
    <div className="relative h-full w-full bg-black">
      <img
        src={photos[idx]}
        alt={`${name} photo ${idx + 1}`}
        className="absolute inset-0 h-full w-full object-cover"
      />
      {photos.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => setIdx((i) => (i - 1 + photos.length) % photos.length)}
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setIdx((i) => (i + 1) % photos.length)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70 transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
            {photos.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 w-1.5 rounded-full transition-colors ${
                  i === idx ? "bg-white" : "bg-white/50"
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Main Page Component ----------

export default function StoreDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { locale } = useI18n();
  const labels = useLabels();

  const [store, setStore] = useState<DiscoveredStore | null>(null);
  const [detail, setDetail] = useState<StoreDetail | null>(null);
  const [enrichment, setEnrichment] = useState<StoreEnrichment | null>(null);
  const [storeLoading, setStoreLoading] = useState(true);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch store + detail data (doesn't depend on locale)
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function load() {
      setStoreLoading(true);
      setError(null);
      try {
        const storeRes = await fetch(`/api/discovery/stores/${id}`);
        if (!storeRes.ok) { setError("Store not found"); return; }
        const storeData: DiscoveredStore = await storeRes.json();
        if (cancelled) return;
        setStore(storeData);

        const detailRes = await fetch(`/api/discovery/detail?placeId=${storeData.placeId}`);
        if (detailRes.ok && !cancelled) {
          setDetail(await detailRes.json());
        }
      } catch {
        if (!cancelled) setError("Failed to load store data");
      } finally {
        if (!cancelled) setStoreLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [id]);

  // Fetch enrichment (re-runs when locale changes)
  useEffect(() => {
    if (!store || !detail) return;
    let cancelled = false;

    async function loadEnrichment() {
      setEnrichLoading(true);
      setEnrichment(null);
      try {
        const res = await fetch("/api/discovery/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            placeId: store!.placeId,
            storeName: store!.name,
            storeAddress: detail!.address || store!.address,
            storePhone: detail!.phone || store!.phone,
            rating: detail!.rating,
            ratingCount: detail!.ratingCount,
            websiteUrl: detail!.website,
            hours: detail!.hours,
            locale,
          }),
        });
        if (res.ok && !cancelled) {
          setEnrichment(await res.json());
        }
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setEnrichLoading(false);
      }
    }

    loadEnrichment();
    return () => { cancelled = true; };
  }, [store, detail, locale]);

  // Import to pipeline
  const handleImport = useCallback(async () => {
    if (!store) return;
    setImporting(true);
    try {
      const res = await fetch("/api/discovery/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: store.id,
          enrichmentData: enrichment?.summary
            ? { summary: enrichment.summary, sources: enrichment.sources }
            : undefined,
        }),
      });
      if (res.ok) {
        setStore((s) => s ? { ...s, status: "imported", importedLeadId: "imported" } : s);
      }
    } catch {
      // silently fail
    } finally {
      setImporting(false);
    }
  }, [store, enrichment]);

  const isInPipeline = store?.status === "imported" || !!store?.importedLeadId;

  // ---------- Loading State ----------

  if (storeLoading) {
    return (
      <main className="h-[calc(100vh)] overflow-y-auto px-5 py-5">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-3 text-sm text-muted-foreground">{labels.loading}</span>
        </div>
      </main>
    );
  }

  // ---------- Error State ----------

  if (error || !store) {
    return (
      <main className="h-[calc(100vh)] overflow-y-auto px-5 py-5">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-1" />
          {labels.backToDiscovery}
        </Button>
        <div className="py-16 text-center">
          <p className="text-sm text-muted-foreground">{error ?? labels.notFound}</p>
        </div>
      </main>
    );
  }

  // ---------- Main Render ----------

  const storePhone = detail?.phone || store.phone;
  const storeAddress = detail?.address || store.address;

  return (
    <main className="h-[calc(100vh)] overflow-y-auto">
      {/* Hero section — photo banner + store identity */}
      <div className="relative">
        {/* Photo banner */}
        {detail && detail.photos.length > 0 ? (
          <div className="relative h-48 md:h-72 w-full overflow-hidden bg-muted">
            <PhotoCarousel photos={detail.photos} name={store.name} />
            {/* Gradient overlay so text on top is readable */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/20" />
          </div>
        ) : (
          <div className="h-40 w-full bg-gradient-to-r from-primary/10 to-primary/5" />
        )}

        {/* Back button overlay */}
        <div className="absolute top-3 left-3 md:top-4 md:left-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.back()}
            className="shadow-md"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            {labels.backToDiscovery}
          </Button>
        </div>

        {/* Pipeline action overlay */}
        <div className="absolute top-3 right-3 md:top-4 md:right-4">
          {isInPipeline ? (
            <div className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow-md">
              <Check className="h-4 w-4" />
              {labels.alreadyInPipeline}
            </div>
          ) : (
            <Button size="sm" onClick={handleImport} disabled={importing} className="shadow-md">
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {labels.addToPipeline}
            </Button>
          )}
        </div>
      </div>

      {/* Store identity bar */}
      <div className="border-b px-4 py-4 md:px-8 md:py-5">
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">{store.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 md:gap-4 text-sm text-muted-foreground">
          {storeAddress && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {storeAddress}
            </span>
          )}
          {storePhone && (
            <a href={`tel:${storePhone}`} className="inline-flex items-center gap-1 text-primary hover:underline">
              <Phone className="h-3.5 w-3.5" />
              {storePhone}
            </a>
          )}
          {detail?.rating != null && (
            <span className="inline-flex items-center gap-1">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              <span className="font-medium text-foreground">{detail.rating.toFixed(1)}</span>
              {detail.ratingCount != null && (
                <span>({detail.ratingCount})</span>
              )}
            </span>
          )}
          {detail?.googleMapsUrl && (
            <a href={detail.googleMapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
              <ExternalLink className="h-3 w-3" />
              {labels.googleMaps}
            </a>
          )}
          {detail?.website && (
            <a href={detail.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
              <Globe className="h-3 w-3" />
              {labels.website}
            </a>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-4 md:px-8 md:py-6 space-y-8">
        {/* Loading state */}
        {enrichLoading && !enrichment && (
          <div className="flex items-center gap-3 rounded-xl border border-dashed p-6 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm">{labels.enriching}</span>
          </div>
        )}

        {/* At-a-Glance row — size, revenue, rating */}
        {enrichment?.summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl border p-4">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{labels.size}</p>
              <p className="mt-1 text-xl font-bold">{enrichment.summary.estimatedSize}</p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{labels.estRevenue}</p>
              <p className="mt-1 text-xl font-bold">{enrichment.summary.estimatedRevenue}</p>
            </div>
            {detail?.rating != null && (
              <div className="rounded-xl border p-4">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Rating</p>
                <p className="mt-1 text-xl font-bold inline-flex items-center gap-1.5">
                  <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
                  {detail.rating.toFixed(1)}
                  <span className="text-sm font-normal text-muted-foreground">({detail.ratingCount})</span>
                </p>
              </div>
            )}
            {storePhone && (
              <div className="rounded-xl border p-4">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{labels.phone}</p>
                <a href={`tel:${storePhone}`} className="mt-1 text-sm font-semibold text-primary hover:underline block">
                  {storePhone}
                </a>
              </div>
            )}
          </div>
        )}

        {/* Key Findings — the most important insight */}
        {enrichment?.summary?.salesAngle && (
          <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-6">
            <h2 className="text-xs font-bold text-primary uppercase tracking-wider mb-2">{labels.keyFindings}</h2>
            <p className="text-sm leading-relaxed">{enrichment.summary.salesAngle}</p>
          </div>
        )}

        {/* Two-column layout */}
        <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
          {/* Main column */}
          <div className="space-y-8">
            {/* Company Overview */}
            {enrichment?.summary?.overview && (
              <section>
                <h2 className="text-sm font-bold mb-3">{labels.companyOverview}</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">{enrichment.summary.overview}</p>
              </section>
            )}

            {/* Services & Capabilities — the main draw */}
            {enrichment?.summary?.productsDetailed && enrichment.summary.productsDetailed.length > 0 && (
              <section>
                <h2 className="text-sm font-bold mb-4">{labels.services}</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {enrichment.summary.productsDetailed.map((cat, i) => (
                    <div key={i} className="rounded-xl border p-4">
                      <p className="text-sm font-semibold mb-2">{cat.category}</p>
                      <ul className="space-y-1.5">
                        {cat.items.map((item, j) => (
                          <li key={j} className="text-xs text-muted-foreground flex items-start gap-2">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/50" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Fallback: flat service tags */}
            {enrichment?.summary?.productsCarried &&
              enrichment.summary.productsCarried.length > 0 &&
              (!enrichment.summary.productsDetailed || enrichment.summary.productsDetailed.length === 0) && (
              <section>
                <h2 className="text-sm font-bold mb-3">{labels.services}</h2>
                <div className="flex flex-wrap gap-2">
                  {enrichment.summary.productsCarried.map((p, i) => (
                    <span key={i} className="rounded-lg border bg-muted/30 px-3 py-1.5 text-xs font-medium">{p}</span>
                  ))}
                </div>
              </section>
            )}

            {/* Typical Clients */}
            {enrichment?.summary?.customerBase && (
              <section>
                <h2 className="text-sm font-bold mb-3">{labels.clientBase}</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">{enrichment.summary.customerBase}</p>
              </section>
            )}

            {/* Client Reviews */}
            {enrichment?.reviewSnippets && enrichment.reviewSnippets.length > 0 && (
              <section>
                <h2 className="text-sm font-bold mb-3">{labels.clientReviews}</h2>
                <div className="space-y-2">
                  {enrichment.reviewSnippets.slice(0, 5).map((snippet, i) => (
                    <div key={i} className="rounded-xl border px-5 py-4">
                      <p className="text-sm italic text-muted-foreground leading-relaxed">&ldquo;{snippet}&rdquo;</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Contact */}
            <div className="rounded-xl border p-4">
              <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                <User className="h-3.5 w-3.5" />
                {labels.contactInsights}
              </h3>

              {enrichment?.owner?.name && (
                <p className="font-semibold">
                  {enrichment.owner.name}
                  {enrichment.owner.title && (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">{enrichment.owner.title}</span>
                  )}
                </p>
              )}

              {enrichment?.summary?.ownerInsights && (
                <p className="mt-2 text-xs italic text-muted-foreground">{enrichment.summary.ownerInsights}</p>
              )}

              <div className="mt-3 space-y-1.5">
                {storePhone && (
                  <a href={`tel:${storePhone}`} className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                    <Phone className="h-3.5 w-3.5" /> {storePhone}
                  </a>
                )}
                {enrichment?.owner?.email && (
                  <a href={`mailto:${enrichment.owner.email}`} className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                    <Mail className="h-3.5 w-3.5" /> {enrichment.owner.email}
                  </a>
                )}
                {detail?.website && (
                  <a href={detail.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                    <Globe className="h-3.5 w-3.5" /> {detail.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </a>
                )}
              </div>
            </div>

            {/* Hours */}
            {detail?.hours && detail.hours.length > 0 && (
              <div className="rounded-xl border p-4">
                <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                  <Clock className="h-3.5 w-3.5" />
                  {labels.hours}
                </h3>
                <div className="space-y-1">
                  {detail.hours.map((h, i) => (
                    <p key={i} className="text-xs">{h}</p>
                  ))}
                </div>
              </div>
            )}

            {/* Business Registry */}
            {enrichment?.sosData && (
              <div className="rounded-xl border p-4">
                <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                  <Building2 className="h-3.5 w-3.5" />
                  {labels.businessRegistry}
                </h3>
                <div className="space-y-2 text-sm">
                  {enrichment.sosData.entityType && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{labels.entity}</span>
                      <span className="font-medium">{enrichment.sosData.entityType}</span>
                    </div>
                  )}
                  {enrichment.sosData.formationDate && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{labels.formed}</span>
                      <span className="font-medium">{enrichment.sosData.formationDate}</span>
                    </div>
                  )}
                  {enrichment.sosData.status && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{labels.regStatus}</span>
                      <Badge variant={enrichment.sosData.status.toLowerCase() === "active" ? "default" : "secondary"}>
                        {enrichment.sosData.status}
                      </Badge>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Sources */}
            {enrichment?.sources && enrichment.sources.length > 0 && (
              <p className="text-[10px] text-muted-foreground/40 text-center">
                {labels.sources}: {enrichment.sources.join(" · ")}
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
