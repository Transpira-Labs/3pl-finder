import { NextRequest, NextResponse } from "next/server";
import { enrichStore } from "@/lib/enrichment/service";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    placeId, storeName, storeAddress, storePhone,
    rating, ratingCount, websiteUrl, hours, locale,
  } = body;

  if (!placeId || !storeName) {
    return NextResponse.json({ error: "placeId and storeName required" }, { status: 400 });
  }

  const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!googleApiKey) {
    return NextResponse.json({ error: "Google API key not configured" }, { status: 500 });
  }

  const result = await enrichStore({
    placeId,
    storeName,
    storeAddress: storeAddress ?? "",
    storePhone: storePhone ?? null,
    rating: rating ?? null,
    ratingCount: ratingCount ?? null,
    websiteUrl: websiteUrl ?? null,
    hours: hours ?? null,
    googleApiKey,
    apolloApiKey: process.env.APOLLO_API_KEY || undefined,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    opensosApiKey: process.env.OPENSOSDATA_API_KEY || undefined,
    openmartApiKey: process.env.OPENMART_API_KEY || undefined,
    saleshandyApiKey: process.env.SALESHANDY_API_KEY || undefined,
    locale: locale ?? "en",
  });

  return NextResponse.json(result);
}
