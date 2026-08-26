import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { discoveredStores, leads } from "@/db/schema";
import { getList, updateList, deleteList, getListItems } from "@/lib/lists/service";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const list = await getList(id);
    if (!list) {
      return NextResponse.json({ error: "List not found" }, { status: 404 });
    }
    const items = await getListItems(id);

    // Enrich items with phone/address from discovered_stores and leads
    const enriched = await Promise.all(
      items.map(async (item) => {
        if (item.storePhone && item.storeAddress) return item;

        // Try discovered_stores first (updated when imported to pipeline)
        const [store] = await db
          .select({ phone: discoveredStores.phone, address: discoveredStores.address })
          .from(discoveredStores)
          .where(eq(discoveredStores.id, item.storeId))
          .limit(1);

        let phone = item.storePhone || store?.phone || null;
        let address = item.storeAddress || store?.address || null;

        // If still no phone, check leads table (phone fetched on pipeline import)
        if (!phone && store) {
          const [lead] = await db
            .select({ phone: leads.phone })
            .from(leads)
            .where(eq(leads.placeId, item.storeId))
            .limit(1);
          if (!lead) {
            // Try matching by discovered_stores.placeId -> leads.placeId
            const [ds] = await db.select({ placeId: discoveredStores.placeId }).from(discoveredStores).where(eq(discoveredStores.id, item.storeId)).limit(1);
            if (ds?.placeId) {
              const [lead2] = await db.select({ phone: leads.phone }).from(leads).where(eq(leads.placeId, ds.placeId)).limit(1);
              phone = lead2?.phone || phone;
            }
          } else {
            phone = lead.phone || phone;
          }
        }

        return { ...item, storePhone: phone, storeAddress: address };
      }),
    );

    return NextResponse.json({ list, items: enriched });
  } catch (err) {
    console.error("Get list error:", err);
    return NextResponse.json(
      { error: "Failed to load list" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { name, description } = body;

    const updated = await updateList(id, {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(description !== undefined ? { description: description.trim() } : {}),
    });

    if (!updated) {
      return NextResponse.json({ error: "List not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error("Update list error:", err);
    return NextResponse.json(
      { error: "Failed to update list" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await deleteList(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete list error:", err);
    return NextResponse.json(
      { error: "Failed to delete list" },
      { status: 500 },
    );
  }
}
