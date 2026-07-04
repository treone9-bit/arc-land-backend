import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const ParcelLookupSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  county: z.string().min(1),
  state: z.string().min(2).max(2),
});

export interface ParcelResult {
  parcelId: string | null;
  acreage: number | null;
  zoning: string | null;
  ownerName: string | null;
  source: string;
}

type CountyConfig = {
  url: string;
  source: string;
  fields: string[];
  normalize: (attrs: Record<string, unknown>) => ParcelResult;
};

async function queryArcGISPoint(
  layerUrl: string,
  lat: number,
  lng: number,
  outFields: string[]
): Promise<Record<string, unknown> | null> {
  const url = new URL(`${layerUrl}/query`);
  url.searchParams.set("geometry", `${lng},${lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", outFields.join(","));
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("f", "json");

  const res = await fetch(url.toString(), { next: { revalidate: 0 } });
  if (!res.ok) throw new Error(`ArcGIS HTTP ${res.status}`);

  const data = await res.json();
  if (data.error) throw new Error(`ArcGIS error ${data.error.code}: ${data.error.message}`);
  if (!data.features?.length) return null;

  return data.features[0].attributes as Record<string, unknown>;
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
// Source: Florida Dept of Revenue Property Tax Oversight, updated annually
// ---------------------------------------------------------------------------
const FL_CONFIG: CountyConfig = {
  url: "https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0",
  source: "FDOR Statewide Cadastral 2025",
  fields: ["PARCEL_ID", "OWN_NAME", "DOR_UC", "LND_SQFOOT"],
  normalize: (a) => ({
    parcelId: str(a.PARCEL_ID),
    acreage: a.LND_SQFOOT ? Math.round((Number(a.LND_SQFOOT) / 43560) * 10000) / 10000 : null,
    zoning: str(a.DOR_UC), // DOR use code (e.g. "001" = single-family residential)
    ownerName: str(a.OWN_NAME),
    source: "FDOR Statewide Cadastral 2025",
  }),
};

// ---------------------------------------------------------------------------
// Georgia — county-by-county (no statewide REST service exists)
// Counties not listed here return a 422 with a qPublic fallback link.
// ---------------------------------------------------------------------------
const GA_COUNTIES: Record<string, CountyConfig> = {
  // Bibb County (Macon) — Macon-Bibb County Open Data / ArcGIS Online
  "Bibb County": {
    url: "https://services2.arcgis.com/zPFLSOZ5HzUzzTQb/arcgis/rest/services/Parcels/FeatureServer/0",
    source: "Macon-Bibb County Open Data",
    fields: ["PARCELID", "OWNERNME1", "OWNERNME2", "USEDSCRP", "STATEDAREA"],
    normalize: (a) => ({
      parcelId: str(a.PARCELID),
      acreage: num(a.STATEDAREA), // stated area in acres per legal description
      zoning: str(a.USEDSCRP),   // assessing use description
      ownerName: [a.OWNERNME1, a.OWNERNME2].filter(Boolean).join("; ") || null,
      source: "Macon-Bibb County Open Data",
    }),
  },

  // Lowndes County (Valdosta) — VALOR GIS (Southern Georgia Regional Commission)
  "Lowndes County": {
    url: "https://www.valorgis.com/arcgis/rest/services/Valor/Parcels/MapServer/0",
    source: "VALOR GIS – Lowndes County",
    fields: ["PARCEL_NO", "FIRSTNAME", "LASTNAME", "ZONINGCODE", "TOTALACRES"],
    normalize: (a) => ({
      parcelId: str(a.PARCEL_NO),
      acreage: num(a.TOTALACRES),
      zoning: str(a.ZONINGCODE),
      ownerName: [a.FIRSTNAME, a.LASTNAME].filter(Boolean).join(" ") || null,
      source: "VALOR GIS – Lowndes County",
    }),
  },

  // Glynn County (Brunswick) — Glynn County GIS server
  // Note: owner name not available in this layer; zoning in ZONE_1
  "Glynn County": {
    url: "https://gis-web.glynncounty-ga.gov/gis-server/rest/services/Parcels/Parcels/FeatureServer/0",
    source: "Glynn County GIS",
    fields: ["PARCEL_ID", "ZONE_1", "ZONE_2", "Shape__Area"],
    normalize: (a) => ({
      parcelId: str(a.PARCEL_ID),
      acreage: a["Shape__Area"] ? Math.round((Number(a["Shape__Area"]) / 43560) * 10000) / 10000 : null,
      zoning: [a.ZONE_1, a.ZONE_2].filter(Boolean).join("/") || null,
      ownerName: null, // not in this layer; query the Parcels_Rectified service for owner
      source: "Glynn County GIS",
    }),
  },

  // Coffee County (Douglas) — SGRC TaxInformation MapServer
  // Note: owner name not in this layer
  "Coffee County": {
    url: "https://www.sgrcmaps.com/arcgis/rest/services/Coffee/TaxInformation/MapServer/0",
    source: "SGRC – Coffee County",
    fields: ["Parcel_No", "TOTALACRES", "ZONINGCODE"],
    normalize: (a) => ({
      parcelId: str(a.Parcel_No),
      acreage: num(a.TOTALACRES),
      zoning: str(a.ZONINGCODE),
      ownerName: null,
      source: "SGRC – Coffee County",
    }),
  },

  // Berrien County (Nashville) — SGRC TaxParcelBoundaries MapServer
  // Note: no zoning field in this dataset
  "Berrien County": {
    url: "https://www.sgrcmaps.com/arcgis/rest/services/Berrien/TaxParcelBoundaries/MapServer/0",
    source: "SGRC – Berrien County",
    fields: ["PARCEL_NO", "PARCELNO", "FIRSTNAME", "LASTNAME", "TOTALACRES"],
    normalize: (a) => ({
      parcelId: str(a.PARCEL_NO ?? a.PARCELNO),
      acreage: num(a.TOTALACRES),
      zoning: null,
      ownerName: [a.FIRSTNAME, a.LASTNAME].filter(Boolean).join(" ") || null,
      source: "SGRC – Berrien County",
    }),
  },

  // Echols County (Statenville) — SGRC echols_parcels MapServer
  "Echols County": {
    url: "https://www.sgrcmaps.com/arcgis/rest/services/Echols/echols_parcels/MapServer/0",
    source: "SGRC – Echols County",
    fields: ["PARCEL", "PARCELNO", "FIRSTNAME", "LASTNAME", "ZONINGCODE", "DRWN_ACRE"],
    normalize: (a) => ({
      parcelId: str(a.PARCEL ?? a.PARCELNO),
      acreage: num(a.DRWN_ACRE),
      zoning: str(a.ZONINGCODE),
      ownerName: [a.FIRSTNAME, a.LASTNAME].filter(Boolean).join(" ") || null,
      source: "SGRC – Echols County",
    }),
  },
};

// Georgia counties that exist but only expose data via qPublic (no public REST API).
// This list drives the 422 response with a useful fallback URL.
const QPUBLIC_GA_COUNTIES = new Set([
  "Atkinson County", "Bacon County", "Baker County", "Ben Hill County",
  "Brantley County", "Brooks County", "Calhoun County", "Camden County",
  "Charlton County", "Clinch County", "Colquitt County", "Cook County",
  "Crawford County", "Crisp County", "Decatur County", "Dooly County",
  "Dougherty County", "Early County", "Grady County", "Houston County",
  "Irwin County", "Jeff Davis County", "Lanier County", "Lee County",
  "Macon County", "Miller County", "Mitchell County", "Peach County",
  "Pierce County", "Pulaski County", "Quitman County", "Randolph County",
  "Schley County", "Seminole County", "Stewart County", "Sumter County",
  "Taylor County", "Terrell County", "Thomas County", "Tift County",
  "Turner County", "Ware County", "Wayne County", "Webster County",
  "Wilcox County", "Worth County",
]);

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

    const { lat, lng, county, state } = parsed.data;

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
        const isKnownQPublic = QPUBLIC_GA_COUNTIES.has(county);
        const slug = county.replace(" County", "").replace(/\s+/g, "") + "GA";
        return NextResponse.json(
          {
            error: isKnownQPublic
              ? "This county's parcel data is only available via qPublic"
              : "County not yet supported",
            county,
            fallback: `https://qpublic.schneidercorp.com/Application.aspx?App=${slug}&Layer=Parcels&PageType=Search`,
          },
          { status: 422 }
        );
      }
      config = gaConfig;
    }

    const attrs = await queryArcGISPoint(config.url, lat, lng, config.fields);

    if (!attrs) {
      return NextResponse.json(
        { error: "No parcel found at those coordinates", lat, lng, county },
        { status: 404 }
      );
    }

    return NextResponse.json(config.normalize(attrs));
  } catch (err) {
    console.error("Parcel lookup error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
