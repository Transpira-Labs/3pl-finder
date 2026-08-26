import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { discoveredStores } from "@/db/schema";

export async function GET(req: NextRequest) {
  const placeId = req.nextUrl.searchParams.get("placeId");
  if (!placeId) {
    return NextResponse.json({ error: "placeId required" }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 });
  }

  const fieldMask = [
    "displayName",
    "formattedAddress",
    "internationalPhoneNumber",
    "nationalPhoneNumber",
    "rating",
    "userRatingCount",
    "businessStatus",
    "googleMapsUri",
    "websiteUri",
    "regularOpeningHours",
    "photos",
    "types",
  ].join(",");

  const res = await fetch(
    `https://places.googleapis.com/v1/places/${placeId}`,
    {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": fieldMask,
      },
    },
  );

  if (!res.ok) {
    return NextResponse.json({ error: "Places API error" }, { status: res.status });
  }

  const data = await res.json();

  // Build photo URLs (Google Places API New returns photo resource names)
  const photos: string[] = [];
  if (data.photos?.length) {
    for (const photo of data.photos.slice(0, 3)) {
      photos.push(
        `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=400&key=${apiKey}`,
      );
    }
  }

  const phone = data.internationalPhoneNumber ?? data.nationalPhoneNumber ?? null;

  // Save phone + address back to discovered_stores so lists can use it
  if (phone || data.formattedAddress) {
    await db
      .update(discoveredStores)
      .set({
        ...(phone ? { phone } : {}),
        ...(data.formattedAddress ? { address: data.formattedAddress } : {}),
      })
      .where(eq(discoveredStores.placeId, placeId))
      .catch(() => {}); // non-critical
  }

  return NextResponse.json({
    name: data.displayName?.text ?? null,
    address: data.formattedAddress ?? null,
    phone,
    rating: data.rating ?? null,
    ratingCount: data.userRatingCount ?? null,
    businessStatus: data.businessStatus ?? null,
    googleMapsUrl: data.googleMapsUri ?? null,
    website: data.websiteUri ?? null,
    hours: data.regularOpeningHours?.weekdayDescriptions ?? null,
    photos,
    types: data.types ?? null,
  });
}
