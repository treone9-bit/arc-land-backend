import * as XLSX from "xlsx";
import { CO_NO_TO_COUNTY } from "./floridaCounties";

const FDOR_LAYER_URL =
  "https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0";

export type LeadRow = Record<string, unknown>;

export type ParsedUpload = {
  rows: LeadRow[];
  parcelColumnKey: string;
  ownerColumnKey: string | null;
};

// "STRAP" is Florida's standard cross-county parcel identifier and matches
// FDOR's PARCEL_ID once punctuation is stripped — prefer it when present,
// since some counties' own "Parcel ID" export column is an internal
// database key that doesn't match the statewide data at all.
const PARCEL_COLUMN_HINTS = ["strap", "parcel"];

// A county's own sales/parcel export reflects its current owner of record —
// Florida's statewide layer is an annual snapshot and lags recent sales, so
// prefer whatever owner name the upload already provides.
const OWNER_COLUMN_HINTS = ["owner"];

function findColumnKey(headers: string[], hints: string[]): string | null {
  const lower = headers.map((h) => h.toLowerCase());
  for (const hint of hints) {
    const idx = lower.findIndex((h) => h.includes(hint));
    if (idx !== -1) return headers[idx];
  }
  return null;
}

function findColumnKeys(headers: string[], hint: string): string[] {
  return headers.filter((h) => h.toLowerCase().includes(hint));
}

// County exports commonly include a land-size column in raw square feet
// (e.g. "Land area", "Lot Size") rather than acres. Detect those and convert
// them in place so nothing downstream (the 1+ acre filter, the final
// spreadsheet) is ever looking at an unconverted sqft number.
const SQFT_AREA_COLUMN_HINTS = ["land area", "lot size", "lot area"];

function convertSqFtAreaColumns(rows: LeadRow[]): LeadRow[] {
  if (!rows.length) return rows;
  const headers = Object.keys(rows[0]);
  const targets = headers.filter((h) => {
    const lower = h.toLowerCase();
    return SQFT_AREA_COLUMN_HINTS.some((hint) => lower.includes(hint)) && !lower.includes("acre");
  });
  if (!targets.length) return rows;

  return rows.map((row) => {
    const out: LeadRow = {};
    for (const [key, value] of Object.entries(row)) {
      if (!targets.includes(key)) {
        out[key] = value;
        continue;
      }
      const sqft = typeof value === "number" ? value : parseFloat(String(value));
      out[`${key} (acres)`] = !isNaN(sqft) ? Math.round((sqft / 43560) * 100) / 100 : "";
    }
    return out;
  });
}

export function parseUploadedWorkbook(buffer: Buffer): ParsedUpload {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("The uploaded file has no sheets.");
  const sheet = workbook.Sheets[sheetName];
  let rows: LeadRow[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  if (!rows.length) throw new Error("The uploaded file has no data rows.");
  rows = convertSqFtAreaColumns(rows);

  const headers = Object.keys(rows[0]);
  const parcelColumnKey = findColumnKey(headers, PARCEL_COLUMN_HINTS);
  if (!parcelColumnKey) {
    throw new Error(
      'Could not find a parcel number column. Make sure one of the column headers contains "Parcel".'
    );
  }
  const ownerColumnKey = findColumnKey(headers, OWNER_COLUMN_HINTS);

  return { rows, parcelColumnKey, ownerColumnKey };
}

function normalizeVariants(raw: string): string[] {
  const trimmed = raw.trim();
  const stripped = trimmed.replace(/[-.\s/]/g, "");
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

// The FDOR service occasionally just hangs on a query rather than erroring
// (observed directly — a single request can sit for 45-90s+ with zero bytes
// back). Without a hard per-request cap, a few hung chunks combined with
// retries can burn through the entire serverless function timeout on their
// own, well before we get to easier chunks. Fail fast instead.
const FDOR_REQUEST_TIMEOUT_MS = 12000;

async function queryFDORBatch(variants: string[], attempts = 2): Promise<ArcGISFeature[]> {
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
      const res = await fetch(url.toString(), {
        next: { revalidate: 0 },
        signal: AbortSignal.timeout(FDOR_REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`FDOR HTTP ${res.status}`);
      const data: ArcGISQueryResponse = await res.json();
      if (data.error) throw new Error(`FDOR error ${data.error.code}: ${data.error.message}`);
      return data.features ?? [];
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 300));
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
  concurrency = 8,
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
        results.set(parcelId.replace(/[-.\s/]/g, ""), match);
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
  selectedCounty: string,
  ownerColumnKey: string | null = null
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

    // Prefer the owner name already in the upload (reflects the county's own,
    // more current record of a recent sale) over Florida's statewide layer,
    // which is an annual snapshot and can still show the previous owner.
    const uploadedOwnerName = ownerColumnKey ? str(row[ownerColumnKey]) : null;
    const ownerName = uploadedOwnerName ?? match.ownerName ?? "";

    return {
      ...row,
      "Acreage": match.acreage,
      "Property Owner Name": ownerName,
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

// These are the exact header names buildOutputWorkbook() writes — used as a
// fallback match key when the skip-tracing service's export doesn't carry a
// parcel number column back through.
const ADDR_COLS = {
  addr1: "Owner Mailing Address 1",
  city: "Owner Mailing City",
  zip: "Owner Mailing Zip",
};

function addressKey(row: LeadRow): string | null {
  const a1 = str(row[ADDR_COLS.addr1]);
  const city = str(row[ADDR_COLS.city]);
  const zip = str(row[ADDR_COLS.zip]);
  if (!a1 || !city || !zip) return null;
  return `${a1}|${city}|${zip}`.toLowerCase();
}

export type MergeResult = { buffer: Buffer; matchedCount: number; totalCount: number };

// Merges a REISkip (or any skip-tracing service) results export back onto
// the original generated mailing list, matching rows by parcel number when
// both files have one, falling back to owner mailing address otherwise.
// Any column in the results file whose header contains "phone" or "email"
// is carried over as-is (skip-tracing exports commonly return several of
// each, e.g. "Phone 1".."Phone 5").
export function mergeReiskipResults(mailingListBuffer: Buffer, reiskipBuffer: Buffer): MergeResult {
  const mailingList = XLSX.read(mailingListBuffer, { type: "buffer" });
  const mailingSheet = mailingList.Sheets[mailingList.SheetNames[0]];
  const mailingRows: LeadRow[] = XLSX.utils.sheet_to_json(mailingSheet, { defval: "" });
  if (!mailingRows.length) throw new Error("The mailing list file has no data rows.");

  const reiskip = XLSX.read(reiskipBuffer, { type: "buffer" });
  const reiskipSheet = reiskip.Sheets[reiskip.SheetNames[0]];
  const reiskipRows: LeadRow[] = XLSX.utils.sheet_to_json(reiskipSheet, { defval: "" });
  if (!reiskipRows.length) throw new Error("The REISkip results file has no data rows.");

  const mailingHeaders = Object.keys(mailingRows[0]);
  const reiskipHeaders = Object.keys(reiskipRows[0]);

  const mailingParcelKey = findColumnKey(mailingHeaders, PARCEL_COLUMN_HINTS);
  const reiskipParcelKey = findColumnKey(reiskipHeaders, PARCEL_COLUMN_HINTS);

  const contactCols = [
    ...findColumnKeys(reiskipHeaders, "phone"),
    ...findColumnKeys(reiskipHeaders, "email"),
  ];
  if (!contactCols.length) {
    throw new Error(
      'Could not find any phone or email columns in the REISkip file. Make sure a column header contains "Phone" or "Email".'
    );
  }

  const byParcel = new Map<string, LeadRow>();
  const byAddress = new Map<string, LeadRow>();
  for (const row of reiskipRows) {
    if (reiskipParcelKey) {
      const parcel = str(row[reiskipParcelKey]);
      if (parcel) for (const v of normalizeVariants(parcel)) byParcel.set(v, row);
    }
    const key = addressKey(row);
    if (key) byAddress.set(key, row);
  }

  let matchedCount = 0;
  const outRows = mailingRows.map((row) => {
    let match: LeadRow | undefined;

    if (mailingParcelKey && reiskipParcelKey) {
      const parcel = str(row[mailingParcelKey]);
      if (parcel) match = normalizeVariants(parcel).map((v) => byParcel.get(v)).find((m) => m);
    }
    if (!match) {
      const key = addressKey(row);
      if (key) match = byAddress.get(key);
    }

    if (match) matchedCount++;

    const contactFields: LeadRow = {};
    for (const col of contactCols) contactFields[col] = match ? match[col] ?? "" : "";

    return {
      ...row,
      ...contactFields,
      "REISkip Match": match ? "Matched" : "Not found",
    };
  });

  const outSheet = XLSX.utils.json_to_sheet(outRows);
  const outWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(outWorkbook, outSheet, "Mailing List + Contacts");
  const buffer = XLSX.write(outWorkbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return { buffer, matchedCount, totalCount: mailingRows.length };
}
