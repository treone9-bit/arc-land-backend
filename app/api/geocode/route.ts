import { NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  zip: z.string().min(1),
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

  // TODO: call Google Maps Geocoding API
  return NextResponse.json({
    lat: null,
    lng: null,
    formattedAddress: null,
    stub: true,
  });
}
