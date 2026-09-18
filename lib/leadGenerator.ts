import * as XLSX from "xlsx";
import { CO_NO_TO_COUNTY } from "./floridaCounties";

const FDOR_LAYER_URL =
  "https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0";

export type LeadRow = Record<string, unknown>;

export type ParsedUpload = {
  rows: LeadRow[];
  parcelColumnKey: string;
};

const PARCEL_COLUMN_HINTS = ["parcel"];

function findColumnKey(headers: string[], hints: string[]): string | null {
  const lower = headers.map((h) => h.toLowerCase());
  for (const hint of hints) {
    const idx = lower.findIndex((h) => h.includes(hint));
    if (idx !== -1) return headers[idx];
  }
  return null;
}

export function parseUploadedWorkbook(buffer: Buffer): ParsedUpload {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("The uploaded file has no sheets.");
  const sheet = workbook.Sheets[sheetName];
  const rows: LeadRow[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  if (!rows.length) throw new Error("The uploaded file has no data rows.");

  const headers = Object.keys(rows[0]);
  const parcelColumnKey = findColumnKey(headers, PARCEL_COLUMN_HINTS);
  if (!parcelColumnKey) {
    throw new Error(
      'Could not find a parcel number column. Make sure one of the column headers contains "Parcel".'
    );
  }

  return { rows, parcelColumnKey };
}

function normalizeVariants(raw: string): string[] {
  const trimmed = raw.trim();
  const stripped = trimmed.replace(/[-\s/]/g, "");
  return Array.from(new Set([trimmed, stripped])).filter(Boolean);
}

export type MailingMatch = {
  ownerName: string | null;
  addr1: string | null;
  addr2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  matchedCounty: string | null;
  acreage: number | null;
};

export const MIN_ACRES = 1;

type ArcGISFeature = { attributes: Record<string, unknown> };
type ArcGISQueryResponse = { features?: ArcGISFeature[]; error?: { code: number; message: string } };

async function queryFDORBatch(variants: string[], attempts = 3): Promise<ArcGISFeature[]> {
  const escape = (s: string) => s.replace(/'/g, "''");
  const where = `PARCEL_ID IN (${variants.map((v) => `'${escape(v)}'`).join(",")})`;

  const url = new URL(`${FDOR_LAYER_URL}/query`);
  url.searchParams.set("where", where);
  url.searchParams.set(
    "outFields",
    "PARCEL_ID,OWN_NAME,OWN_ADDR1,OWN_ADDR2,OWN_CITY,OWN_STATE,OWN_ZIPCD,CO_NO,LND_SQFOOT"
  );
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("f", "json");

  let lastErr: Error = new Error("FDOR query failed");
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url.toString(), { next: { revalidate: 0 } });
      if (!res.ok) throw new Error(`FDOR HTTP ${res.status}`);
      const data: ArcGISQueryResponse = await res.json();
      if (data.error) throw new Error(`FDOR error ${data.error.code}: ${data.error.message}`);
      return data.features ?? [];
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

function str(v: unknown): string | null {
  if (v == null || (typeof v === "string" && v.trim() === "")) return null;
  return String(v).trim();
}

// Batches parcel-ID variants into IN() queries (chunked to keep URLs a
// reasonable size) and returns a lookup keyed by every variant string that
// matched, so callers can look up by either the raw or separator-stripped form.
export async function lookupMailingAddresses(
  parcelNumbers: string[],
  concurrency = 4,
  chunkSize = 40
): Promise<Map<string, MailingMatch>> {
  const allVariants = new Set<string>();
  const variantsByInput = parcelNumbers.map((p) => normalizeVariants(p));
  for (const vs of variantsByInput) for (const v of vs) allVariants.add(v);

  const uniqueVariants = Array.from(allVariants);
  const chunks: string[][] = [];
  for (let i = 0; i < uniqueVariants.length; i += chunkSize) {
    chunks.push(uniqueVariants.slice(i, i + chunkSize));
  }

  const results = new Map<string, MailingMatch>();

  let nextChunk = 0;
  async function worker() {
    while (nextChunk < chunks.length) {
      const idx = nextChunk++;
      const chunk = chunks[idx];
      let features: ArcGISFeature[];
      try {
        features = await queryFDORBatch(chunk);
      } catch {
        continue; // leave this chunk's parcels unmatched rather than failing the whole run
      }
      for (const f of features) {
        const a = f.attributes;
        const parcelId = str(a.PARCEL_ID);
        if (!parcelId) continue;
        const coNo = typeof a.CO_NO === "number" ? a.CO_NO : Number(a.CO_NO);
        const sqft = a.LND_SQFOOT != null ? Number(a.LND_SQFOOT) : null;
        const match: MailingMatch = {
          ownerName: str(a.OWN_NAME),
          addr1: str(a.OWN_ADDR1),
          addr2: str(a.OWN_ADDR2),
          city: str(a.OWN_CITY),
          state: str(a.OWN_STATE),
          zip: str(a.OWN_ZIPCD),
          matchedCounty: CO_NO_TO_COUNTY[coNo] ?? null,
          acreage: sqft && !isNaN(sqft) ? Math.round((sqft / 43560) * 100) / 100 : null,
        };
        // Index by both the raw PARCEL_ID from the service and its stripped
        // form, so a lookup by either input variant finds it.
        results.set(parcelId, match);
        results.set(parcelId.replace(/[-\s/]/g, ""), match);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));
  return results;
}

export function buildOutputWorkbook(
  rows: LeadRow[],
  parcelColumnKey: string,
  matches: Map<string, MailingMatch>,
  selectedCounty: string
): Buffer {
  const matched = rows
    .map((row) => {
      const rawParcel = str(row[parcelColumnKey]) ?? "";
      const variants = normalizeVariants(rawParcel);
      const match = variants.map((v) => matches.get(v)).find((m) => m);
      return { row, match };
    })
    // Drop parcels we couldn't find (no acreage to verify) and anything
    // under the minimum lot size.
    .filter((r): r is { row: LeadRow; match: MailingMatch } =>
      r.match != null && r.match.acreage != null && r.match.acreage >= MIN_ACRES
    )
    .sort((a, b) => (b.match.acreage ?? 0) - (a.match.acreage ?? 0));

  if (!matched.length) {
    throw new Error(
      `No parcels matched with ${MIN_ACRES}+ acres. Nothing to export.`
    );
  }

  const outRows = matched.map(({ row, match }) => {
    const status =
      match.matchedCounty && match.matchedCounty !== selectedCounty
        ? `Found in ${match.matchedCounty} (verify)`
        : "Matched";

    return {
      ...row,
      "Acreage": match.acreage,
      "Owner Mailing Address 1": match.addr1 ?? "",
      "Owner Mailing Address 2": match.addr2 ?? "",
      "Owner Mailing City": match.city ?? "",
      "Owner Mailing State": match.state ?? "",
      "Owner Mailing Zip": match.zip ?? "",
      "Matched County": match.matchedCounty ?? "",
      "Match Status": status,
    };
  });

  const sheet = XLSX.utils.json_to_sheet(outRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Mailing List");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
