import { NextRequest, NextResponse } from "next/server";
import { importStoreToPipeline, batchImportStores } from "@/lib/discovery/service";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { storeId, storeIds, enrichmentData } = body;

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Google Places API key not configured" },
        { status: 500 },
      );
    }

    // Batch import
    if (storeIds && Array.isArray(storeIds)) {
      const result = await batchImportStores(storeIds, apiKey);
      return NextResponse.json(result);
    }

    // Single import
    if (storeId) {
      const result = await importStoreToPipeline(storeId, apiKey, undefined, enrichmentData);
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "storeId or storeIds required" }, { status: 400 });
  } catch (err) {
    console.error("Import error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 500 },
    );
  }
}
