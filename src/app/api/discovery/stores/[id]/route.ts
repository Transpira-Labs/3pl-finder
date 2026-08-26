import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [store] = await db
    .select()
    .from(schema.discoveredStores)
    .where(eq(schema.discoveredStores.id, id));

  if (!store) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(store);
}
