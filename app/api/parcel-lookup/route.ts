import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const ParcelLookupSchema = z.object({
  lat: z.number().optional(),
  lng: z.number().optional(),
  parcelId: z.string().min(1).optional(),
  county: z.string().min(1),
  state: z.string().min(2).max(2),
});

export interface ParcelResult {
  parcelId: string | null;
  acreage: number | null;
  zoning: string | null;
  ownerName: string | null;
  source: string;
  lat?: number;
  lng?: number;
  rings?: number[][][];
}

type CountyConfig = {
  url: string;
  source: string;
  fields: string[];
  parcelIdField: string;
  normalize: (attrs: Record<string, unknown>) => ParcelResult;
};

// The FDOR statewide cadastral layer (and some county ArcGIS services) are hosted
// feature services that occasionally throw a transient 400 "Invalid query parameters"
// under load on an otherwise well-formed query. Retry a couple of times with a short
// backoff before giving up, rather than surfacing a one-shot flake to the user.
async function fetchArcGISQuery(url: string, attempts = 3): Promise<any> {
  let lastErr: Error = new Error("ArcGIS query failed");
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { next: { revalidate: 0 } });
      if (!res.ok) throw new Error(`ArcGIS HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(`ArcGIS error ${data.error.code}: ${data.error.message}`);
      return data;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 350 * (i + 1)));
      }
    }
  }
  throw lastErr;
}

async function queryArcGISPoint(
  layerUrl: string,
  lat: number,
  lng: number,
  outFields: string[]
): Promise<{ attrs: Record<string, unknown>; rings: number[][][] | null } | null> {
  const url = new URL(`${layerUrl}/query`);
  url.searchParams.set("geometry", `${lng},${lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", outFields.join(","));
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("f", "json");

  const data = await fetchArcGISQuery(url.toString());
  if (!data.features?.length) return null;

  const feature = data.features[0];
  return {
    attrs: feature.attributes as Record<string, unknown>,
    rings: feature.geometry?.rings ?? null,
  };
}

function ringCentroid(rings: number[][][]): { lat: number; lng: number } | null {
  const ring = rings?.[0];
  if (!ring?.length) return null;
  const lng = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return { lat, lng };
}

async function queryArcGISById(
  layerUrl: string,
  parcelIdField: string,
  parcelId: string,
  outFields: string[]
): Promise<{ attrs: Record<string, unknown>; centroid: { lat: number; lng: number } | null; rings: number[][][] | null } | null> {
  // Build WHERE that matches both the raw input and the separator-stripped variant
  // so "12-34-56", "12/34/56", and "123456" all find the same record.
  const escape = (s: string) => s.replace(/'/g, "''");
  const stripped = parcelId.replace(/[-\s/]/g, "");
  const variants = Array.from(new Set([parcelId, stripped])).filter(Boolean);
  const where = variants
    .map((v) => `${parcelIdField} = '${escape(v)}'`)
    .join(" OR ");

  const url = new URL(`${layerUrl}/query`);
  url.searchParams.set("where", where);
  url.searchParams.set("outFields", outFields.join(","));
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("f", "json");

  const data = await fetchArcGISQuery(url.toString());
  if (!data.features?.length) return null;

  const feature = data.features[0];
  const rings: number[][][] | null = feature.geometry?.rings ?? null;
  const centroid = ringCentroid(rings ?? []);
  return { attrs: feature.attributes as Record<string, unknown>, centroid, rings };
}

function str(v: unknown): string | null {
  if (v == null || v === "") return null;
  return String(v);
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// ---------------------------------------------------------------------------
// Florida — single FDOR statewide service covers all 67 counties
// ---------------------------------------------------------------------------
const FL_CONFIG: CountyConfig = {
  url: "https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0",
  source: "FDOR Statewide Cadastral 2025",
  fields: ["PARCEL_ID", "OWN_NAME", "DOR_UC", "LND_SQFOOT"],
  parcelIdField: "PARCEL_ID",
  normalize: (a) => ({
    parcelId: str(a.PARCEL_ID),
    acreage: a.LND_SQFOOT ? Math.round((Number(a.LND_SQFOOT) / 43560) * 10000) / 10000 : null,
    zoning: str(a.DOR_UC),
    ownerName: str(a.OWN_NAME),
    source: "FDOR Statewide Cadastral 2025",
  }),
};

// ---------------------------------------------------------------------------
// Georgia — county-by-county (no statewide REST service exists)
// ---------------------------------------------------------------------------
const GA_COUNTIES: Record<string, CountyConfig> = {
  "Bibb County": {
    url: "https://services2.arcgis.com/zPFLSOZ5HzUzzTQb/arcgis/rest/services/Parcels/FeatureServer/0",
    source: "Macon-Bibb County Open Data",
    fields: ["PARCELID", "OWNERNME1", "OWNERNME2", "USEDSCRP", "STATEDAREA"],
    parcelIdField: "PARCELID",
    normalize: (a) => ({
      parcelId: str(a.PARCELID),
      acreage: num(a.STATEDAREA),
      zoning: str(a.USEDSCRP),
      ownerName: [a.OWNERNME1, a.OWNERNME2].filter(Boolean).join("; ") || null,
      source: "Macon-Bibb County Open Data",
    }),
  },

  "Lowndes County": {
    url: "https://www.valorgis.com/arcgis/rest/services/Valor/Parcels/MapServer/0",
    source: "VALOR GIS – Lowndes County",
    fields: ["PARCEL_NO", "FIRSTNAME", "LASTNAME", "ZONINGCODE", "TOTALACRES"],
    parcelIdField: "PARCEL_NO",
    normalize: (a) => ({
      parcelId: str(a.PARCEL_NO),
      acreage: num(a.TOTALACRES),
      zoning: str(a.ZONINGCODE),
      ownerName: [a.FIRSTNAME, a.LASTNAME].filter(Boolean).join(" ") || null,
      source: "VALOR GIS – Lowndes County",
    }),
  },

  "Glynn County": {
    url: "https://gis-web.glynncounty-ga.gov/gis-server/rest/services/Parcels/Parcels/FeatureServer/0",
    source: "Glynn County GIS",
    fields: ["PARCEL_ID", "ZONE_1", "ZONE_2", "Shape__Area"],
    parcelIdField: "PARCEL_ID",
    normalize: (a) => ({
      parcelId: str(a.PARCEL_ID),
      acreage: a["Shape__Area"] ? Math.round((Number(a["Shape__Area"]) / 43560) * 10000) / 10000 : null,
      zoning: [a.ZONE_1, a.ZONE_2].filter(Boolean).join("/") || null,
      ownerName: null,
      source: "Glynn County GIS",
    }),
  },

  "Coffee County": {
    url: "https://www.sgrcmaps.com/arcgis/rest/services/Coffee/TaxInformation/MapServer/0",
    source: "SGRC – Coffee County",
    fields: ["Parcel_No", "TOTALACRES", "ZONINGCODE"],
    parcelIdField: "Parcel_No",
    normalize: (a) => ({
      parcelId: str(a.Parcel_No),
      acreage: num(a.TOTALACRES),
      zoning: str(a.ZONINGCODE),
      ownerName: null,
      source: "SGRC – Coffee County",
    }),
  },

  "Berrien County": {
    url: "https://www.sgrcmaps.com/arcgis/rest/services/Berrien/TaxParcelBoundaries/MapServer/0",
    source: "SGRC – Berrien County",
    fields: ["PARCEL_NO", "PARCELNO", "FIRSTNAME", "LASTNAME", "TOTALACRES"],
    parcelIdField: "PARCEL_NO",
    normalize: (a) => ({
      parcelId: str(a.PARCEL_NO ?? a.PARCELNO),
      acreage: num(a.TOTALACRES),
      zoning: null,
      ownerName: [a.FIRSTNAME, a.LASTNAME].filter(Boolean).join(" ") || null,
      source: "SGRC – Berrien County",
    }),
  },

  "Echols County": {
    url: "https://www.sgrcmaps.com/arcgis/rest/services/Echols/echols_parcels/MapServer/0",
    source: "SGRC – Echols County",
    fields: ["PARCEL", "PARCELNO", "FIRSTNAME", "LASTNAME", "ZONINGCODE", "DRWN_ACRE"],
    parcelIdField: "PARCEL",
    normalize: (a) => ({
      parcelId: str(a.PARCEL ?? a.PARCELNO),
      acreage: num(a.DRWN_ACRE),
      zoning: str(a.ZONINGCODE),
      ownerName: [a.FIRSTNAME, a.LASTNAME].filter(Boolean).join(" ") || null,
      source: "SGRC – Echols County",
    }),
  },

  "Dougherty County": {
    url: "https://services6.arcgis.com/VKHi8CC6pMIyYUIs/arcgis/rest/services/Parcels_Public_View/FeatureServer/0",
    source: "Dougherty County GIS Open Data",
    fields: ["ParcelNum", "Name", "TotalAcerage", "CalcAcre", "Zone_", "Address"],
    parcelIdField: "ParcelNum",
    normalize: (a) => ({
      parcelId: str(a.ParcelNum),
      acreage: num(a.TotalAcerage) ?? num(a.CalcAcre),
      zoning: str(a.Zone_)?.trim() || null,
      ownerName: str(a.Name)?.trim() || null,
      source: "Dougherty County GIS Open Data",
    }),
  },

  "Chatham County": {
    url: "https://pub.sagis.org/arcgis/rest/services/OpenData/Parcels/MapServer/27",
    source: "SAGIS – Chatham County 2025",
    fields: ["PIN", "Owner", "Acres", "Property_Use", "PropAddress_Full"],
    parcelIdField: "PIN",
    normalize: (a) => ({
      parcelId: str(a.PIN),
      acreage: num(a.Acres),
      zoning: str(a.Property_Use),
      ownerName: str(a.Owner)?.trim() || null,
      source: "SAGIS – Chatham County 2025",
    }),
  },
};

function normalizeCounty(raw: string): string {
  const trimmed = raw.trim();
  // Title-case each word
  const titled = trimmed
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  // Append "County" if not already present
  return titled.endsWith(" County") ? titled : `${titled} County`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = ParcelLookupSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: z.flattenError(parsed.error) },
        { status: 400 }
      );
    }

    const { lat, lng, parcelId, state } = parsed.data;
    const county = normalizeCounty(parsed.data.county);

    const isSpatial = lat != null && lng != null;
    const isById = !!parcelId;

    if (!isSpatial && !isById) {
      return NextResponse.json(
        { error: "Provide either lat+lng for address lookup or parcelId for ID lookup" },
        { status: 400 }
      );
    }

    if (state !== "FL" && state !== "GA") {
      return NextResponse.json(
        { error: "Only FL and GA are currently supported", state },
        { status: 422 }
      );
    }

    let config: CountyConfig;

    if (state === "FL") {
      config = FL_CONFIG;
    } else {
      const gaConfig = GA_COUNTIES[county];
      if (!gaConfig) {
        const slug = county.replace(" County", "").replace(/\s+/g, "") + "GA";
        return NextResponse.json(
          {
            error: "This county's parcel data is only available via qPublic",
            county,
            fallback: `https://qpublic.schneidercorp.com/Application.aspx?App=${slug}&Layer=Parcels&PageType=Search`,
          },
          { status: 422 }
        );
      }
      config = gaConfig;
    }

    let attrs: Record<string, unknown> | null;
    let centroid: { lat: number; lng: number } | null = null;
    let rings: number[][][] | null = null;

    if (isById) {
      const result = await queryArcGISById(config.url, config.parcelIdField, parcelId!, config.fields);
      attrs = result?.attrs ?? null;
      centroid = result?.centroid ?? null;
      rings = result?.rings ?? null;
    } else {
      const result = await queryArcGISPoint(config.url, lat!, lng!, config.fields);
      attrs = result?.attrs ?? null;
      rings = result?.rings ?? null;
      centroid = attrs ? { lat: lat!, lng: lng! } : null;
    }

    if (!attrs) {
      const notFoundDetail = isById ? { parcelId, county } : { lat, lng, county };
      return NextResponse.json({ error: "No parcel found", ...notFoundDetail }, { status: 404 });
    }

    const result = config.normalize(attrs);
    if (centroid) {
      result.lat = centroid.lat;
      result.lng = centroid.lng;
    }
    if (rings) result.rings = rings;
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Parcel lookup error:", msg);
    return NextResponse.json({ error: `Parcel lookup failed: ${msg}` }, { status: 500 });
  }
}
