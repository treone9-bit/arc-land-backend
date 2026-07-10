import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const EnvironmentalSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});

export interface EnvironmentalResult {
  floodZone: string | null;
  sfha: boolean | null;
  floodZoneDesc: string | null;
  wetlandsOnSite: boolean;
  wetlandType: string | null;
}

const FLOOD_ZONE_DESCS: Record<string, string> = {
  A: "High risk — 1% annual flood chance, no base flood elevation",
  AE: "High risk — 1% annual flood chance, BFE determined",
  AH: "High risk — 1% annual flood chance, ponding",
  AO: "High risk — 1% annual flood chance, sheet flow",
  VE: "High risk coastal — 1% annual flood chance with wave action",
  X: "Moderate or minimal flood risk",
  D: "Flood risk undetermined",
};

async function queryFEMAFloodZone(
  lat: number,
  lng: number
): Promise<{ zone: string | null; sfha: boolean | null }> {
  const url = new URL(
    "https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query"
  );
  url.searchParams.set("geometry", `${lng},${lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", "FLD_ZONE,SFHA_TF");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("f", "json");

  const res = await fetch(url.toString(), {
    next: { revalidate: 0 },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return { zone: null, sfha: null };

  const data = await res.json();
  if (!data.features?.length) return { zone: null, sfha: null };

  const attrs = data.features[0].attributes;
  return {
    zone: attrs.FLD_ZONE ?? null,
    sfha: attrs.SFHA_TF === "T",
  };
}

async function queryNWIWetlands(
  lat: number,
  lng: number
): Promise<{ onSite: boolean; type: string | null }> {
  const url = new URL(
    "https://fwsprimary.wim.usgs.gov/server/rest/services/Wetlands/MapServer/0/query"
  );
  url.searchParams.set("geometry", `${lng},${lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", "WETLAND_TYPE,ATTRIBUTE");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("f", "json");

  const res = await fetch(url.toString(), {
    next: { revalidate: 0 },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return { onSite: false, type: null };

  const data = await res.json();
  if (!data.features?.length) return { onSite: false, type: null };

  const attrs = data.features[0].attributes;
  return {
    onSite: true,
    type: attrs.WETLAND_TYPE ?? null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = EnvironmentalSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: z.flattenError(parsed.error) },
        { status: 400 }
      );
    }

    const { lat, lng } = parsed.data;

    const [flood, wetlands] = await Promise.all([
      queryFEMAFloodZone(lat, lng).catch(() => ({ zone: null, sfha: null })),
      queryNWIWetlands(lat, lng).catch(() => ({ onSite: false, type: null })),
    ]);

    const result: EnvironmentalResult = {
      floodZone: flood.zone,
      sfha: flood.sfha,
      floodZoneDesc: flood.zone
        ? (FLOOD_ZONE_DESCS[flood.zone] ?? `Zone ${flood.zone}`)
        : null,
      wetlandsOnSite: wetlands.onSite,
      wetlandType: wetlands.type,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("Environmental lookup error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
