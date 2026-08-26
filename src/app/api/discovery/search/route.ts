import { NextRequest, NextResponse } from "next/server";
import { discoverStores } from "@/lib/discovery/service";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { location, radiusMiles, keywords, centerLat, centerLng } = body;

    if (!location) {
      return NextResponse.json({ error: "Location is required" }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Google Places API key not configured" },
        { status: 500 },
      );
    }

    // keywords can be a comma-separated string or an array
    const parsedKeywords = typeof keywords === "string" && keywords.trim()
      ? keywords.split(",").map((k: string) => k.trim()).filter(Boolean)
      : Array.isArray(keywords) ? keywords : undefined;

    const results = await discoverStores({
      location: location || "stores",
      radiusMiles: radiusMiles ?? 25,
      keywords: parsedKeywords,
      apiKey,
      center: centerLat && centerLng ? { lat: centerLat, lng: centerLng } : undefined,
    });

    return NextResponse.json({ results, count: results.length });
  } catch (err) {
    console.error("Discovery search error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Search failed" },
      { status: 500 },
    );
  }
}
