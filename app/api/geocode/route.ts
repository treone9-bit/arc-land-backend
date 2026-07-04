import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const GeocodeRequestSchema = z.object({
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  zip: z.string().min(1),
});

export interface GeocodeResult {
  formattedAddress: string;
  lat: number;
  lng: number;
  county: string | null;
  placeId: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = GeocodeRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: z.flattenError(parsed.error) },
        { status: 400 }
      );
    }

    const { address, city, state, zip } = parsed.data;
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      console.error("GOOGLE_MAPS_API_KEY is not set");
      return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
    }

    const fullAddress = `${address}, ${city}, ${state} ${zip}`;
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", fullAddress);
    url.searchParams.set("key", apiKey);
    // Bias to Florida to reduce mismatches on ambiguous street names
    url.searchParams.set("region", "us");

    const geoRes = await fetch(url.toString());
    const geoData = await geoRes.json();

    if (geoData.status !== "OK" || !geoData.results?.length) {
      // Google's status codes worth distinguishing for the user-facing error:
      // ZERO_RESULTS = bad/incomplete address, OVER_QUERY_LIMIT = your issue not theirs
      return NextResponse.json(
        {
          error: "Could not locate that address",
          googleStatus: geoData.status,
        },
        { status: 422 }
      );
    }

    const result = geoData.results[0];
    const location = result.geometry.location;

    // County comes back as an "administrative_area_level_2" component in Florida
    const countyComponent = result.address_components.find((c: { types: string[] }) =>
      c.types.includes("administrative_area_level_2")
    );

    const output: GeocodeResult = {
      formattedAddress: result.formatted_address,
      lat: location.lat,
      lng: location.lng,
      county: countyComponent?.long_name ?? null,
      placeId: result.place_id,
    };

    return NextResponse.json(output);
  } catch (err) {
    console.error("Geocoding error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
