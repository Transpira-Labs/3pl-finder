import { NextRequest, NextResponse } from "next/server";
import { getLists, createList } from "@/lib/lists/service";

export async function GET() {
  try {
    const lists = await getLists();
    return NextResponse.json({ lists });
  } catch (err) {
    console.error("Get lists error:", err);
    return NextResponse.json(
      { error: "Failed to load lists" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, description } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 },
      );
    }

    const list = await createList({
      name: name.trim(),
      description: description?.trim() || undefined,
    });
    return NextResponse.json(list, { status: 201 });
  } catch (err) {
    console.error("Create list error:", err);
    return NextResponse.json(
      { error: "Failed to create list" },
      { status: 500 },
    );
  }
}
