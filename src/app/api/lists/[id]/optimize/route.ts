import { NextRequest, NextResponse } from "next/server";
import { optimizeRoute } from "@/lib/lists/service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const result = await optimizeRoute(id, body.startAddress);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Optimize route error:", err);
    const message =
      err instanceof Error ? err.message : "Route optimization failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
