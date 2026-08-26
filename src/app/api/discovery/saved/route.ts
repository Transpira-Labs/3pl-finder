import { NextRequest, NextResponse } from "next/server";
import { getSavedSearches, saveSearch, deleteSavedSearch } from "@/lib/discovery/service";

export async function GET() {
  try {
    const searches = await getSavedSearches();
    return NextResponse.json({ searches });
  } catch (err) {
    console.error("Get saved searches error:", err);
    return NextResponse.json({ error: "Failed to load saved searches" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, query, location, radiusMiles } = body;

    if (!name || !query || !location) {
      return NextResponse.json({ error: "name, query, and location are required" }, { status: 400 });
    }

    const saved = await saveSearch({ name, query, location, radiusMiles: radiusMiles ?? 25 });
    return NextResponse.json({ saved });
  } catch (err) {
    console.error("Save search error:", err);
    return NextResponse.json({ error: "Failed to save search" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    await deleteSavedSearch(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete saved search error:", err);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
