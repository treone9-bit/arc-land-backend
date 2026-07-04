import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({
  lat: z.number(),
  lng: z.number(),
  county: z.string().min(1),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  // TODO: query county parcel API / GIS source for the given coordinates
  return NextResponse.json({
    parcelId: null,
    acreage: null,
    zoning: null,
    ownerName: null,
    stub: true,
  });
}
