import { NextRequest, NextResponse } from "next/server";
import {
  addItemToList,
  addItemsToList,
  removeItemFromList,
  removeItemsFromList,
} from "@/lib/lists/service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: listId } = await params;
    const body = await req.json();

    // Batch add: { storeIds: string[] }
    if (Array.isArray(body.storeIds)) {
      const added = await addItemsToList(listId, body.storeIds);
      return NextResponse.json({ added }, { status: 201 });
    }

    // Single add: { storeId, storeName, ... }
    const { storeId, storeName, storeAddress, storePhone, storeLat, storeLng, storeRating, ownerName, ownerPhone, notes } = body;
    if (!storeId) {
      return NextResponse.json(
        { error: "storeId is required" },
        { status: 400 },
      );
    }

    const item = await addItemToList({
      listId,
      storeId,
      storeName: storeName ?? "",
      storeAddress,
      storePhone,
      storeLat,
      storeLng,
      storeRating,
      ownerName,
      ownerPhone,
      notes,
    });
    return NextResponse.json(item, { status: 201 });
  } catch (err) {
    console.error("Add item error:", err);
    return NextResponse.json(
      { error: "Failed to add item" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: listId } = await params;
    const body = await req.json();

    // Batch remove: { storeIds: string[] }
    if (Array.isArray(body.storeIds)) {
      await removeItemsFromList(listId, body.storeIds);
      return NextResponse.json({ success: true });
    }

    // Single remove: { storeId }
    const { storeId } = body;
    if (!storeId) {
      return NextResponse.json(
        { error: "storeId is required" },
        { status: 400 },
      );
    }

    await removeItemFromList(listId, storeId);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Remove item error:", err);
    return NextResponse.json(
      { error: "Failed to remove item" },
      { status: 500 },
    );
  }
}
