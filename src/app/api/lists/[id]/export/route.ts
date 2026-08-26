import { NextRequest, NextResponse } from "next/server";
import { getList, getListItems, buildListCsv } from "@/lib/lists/service";

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
    const csv = buildListCsv(items);
    const filename = `${list.name.replace(/[^a-zA-Z0-9_-]/g, "_")}-${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("Export list error:", err);
    return NextResponse.json(
      { error: "Failed to export list" },
      { status: 500 },
    );
  }
}
