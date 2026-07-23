import { z } from "zod";
import { createHash, randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { adminDb, adminStorage } from "./firebaseAdmin";
import { analyzePdfVectorContent, formatVectorSummaryForPrompt } from "./pdfVectorAnalysis";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type Bbox = { minLng: number; maxLng: number; minLat: number; maxLat: number };

type SaveEstimateParams = {
  quote: unknown;
  fromCache: boolean;
  serviceType: "land_clearing" | "upload_plans";
  county: string;
  state: string;
  zipCode?: string | null;
  address?: string | null;
  parcelId?: string | null;
  ownerName?: string | null;
  zoning?: string | null;
  acreage?: number | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  additionalNotes?: string | null;
  trades?: string[] | null;
  serviceTypes?: string[] | null;
  files?: { path: string; type: string }[] | null;
  mapBbox?: Bbox | null;
  parcelRings?: number[][][] | null;
  source: "customer" | "admin_free";
  estMeta: EstMeta;
};

export type EstMeta = { num: string; date: string };

function makeEstMeta(): EstMeta {
  const now = new Date();
  return {
    num: `ARC-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(Math.floor(Math.random() * 900) + 100)}`,
    date: now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
  };
}

// Persists the estimate + any uploaded plan files for the admin dashboard.
// Never allowed to break quote generation — failures are logged, not thrown.
// Returns the saved doc's id + display metadata, or null if the save itself
// failed/was skipped.
async function saveEstimateRecord(params: SaveEstimateParams): Promise<{ id: string } | null> {
  if (!process.env.FIREBASE_PROJECT_ID) return null; // Firebase not configured — skip silently
  try {
    const id = randomUUID();
    const planFilePaths: string[] = [];

    if (params.files?.length) {
      const bucket = adminStorage().bucket();
      for (let i = 0; i < params.files.length; i++) {
        const f = params.files[i];
        const ext = f.type === "application/pdf" ? "pdf" : f.type.split("/")[1] ?? "bin";
        const path = `plans/${id}/${i}.${ext}`;
        // Files already live in Storage (uploaded directly by the client) —
        // move them into the permanent per-estimate path rather than
        // re-uploading bytes through our server.
        await bucket.file(f.path).move(path);
        planFilePaths.push(path);
      }
    }

    await adminDb()
      .collection("estimates")
      .doc(id)
      .set({
        serviceType: params.serviceType,
        county: params.county,
        state: params.state,
        zipCode: params.zipCode ?? null,
        address: params.address ?? null,
        parcelId: params.parcelId ?? null,
        ownerName: params.ownerName ?? null,
        zoning: params.zoning ?? null,
        acreage: params.acreage ?? null,
        contactName: params.contactName ?? null,
        contactPhone: params.contactPhone ?? null,
        contactEmail: params.contactEmail ?? null,
        additionalNotes: params.additionalNotes ?? null,
        trades: params.trades ?? null,
        serviceTypes: params.serviceTypes ?? null,
        quote: params.quote,
        planFilePaths,
        fromCache: params.fromCache,
        source: params.source,
        estNum: params.estMeta.num,
        estDate: params.estMeta.date,
        mapBbox: params.mapBbox ?? null,
        // Firestore rejects arrays nested directly inside arrays.
        parcelRings: params.parcelRings ? JSON.stringify(params.parcelRings) : null,
        createdAt: new Date(),
      });
    return { id };
  } catch (err) {
    console.error("Failed to save estimate record:", err);
    return null;
  }
}

const QUOTE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const quoteCache = new Map<string, { data: unknown; expiresAt: number }>();

function cacheKeyFor(data: unknown): string {
  // Include the live prompt text so editing LAND_CLEARING_PROMPT/PLANS_PROMPT
  // automatically invalidates old cached quotes instead of serving stale pricing.
  return createHash("sha256")
    .update(JSON.stringify(data))
    .update(LAND_CLEARING_PROMPT)
    .update(PLANS_PROMPT)
    .digest("hex");
}

function getCachedQuote(key: string): unknown | null {
  const entry = quoteCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    quoteCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedQuote(key: string, data: unknown) {
  quoteCache.set(key, { data, expiresAt: Date.now() + QUOTE_CACHE_TTL_MS });
}

const BboxSchema = z.object({
  minLng: z.number(), maxLng: z.number(),
  minLat: z.number(), maxLat: z.number(),
});

const FileSchema = z.object({
  path: z.string(),
  type: z.enum(["application/pdf", "image/png", "image/jpeg", "image/webp"]),
});

// Files are uploaded directly to Storage by the client (see /api/upload-url);
// the request only carries the Storage path, so we fetch bytes here.
async function downloadFile(path: string): Promise<Buffer> {
  const [buffer] = await adminStorage().bucket().file(path).download();
  return buffer;
}

// Best-effort: pulls exact vector geometry out of a PDF's content stream to
// hand Claude alongside the visual plan (see lib/pdfVectorAnalysis.ts for
// why this only helps some plan sets and silently no-ops for the rest).
async function vectorAnalysisBlock(path: string, type: string, buffer: Buffer): Promise<string | null> {
  if (type !== "application/pdf") return null;
  const summary = await analyzePdfVectorContent(buffer, path.split("/").pop() ?? path);
  return summary ? formatVectorSummaryForPrompt(summary) : null;
}

export const QuoteRequestSchema = z.object({
  serviceType: z.enum(["land_clearing", "upload_plans"]),
  county: z.string().min(1),
  state: z.enum(["FL", "GA"]),
  zipCode: z.string().nullish(),
  mapBbox: BboxSchema.nullish(),
  // Parcel boundary polygon(s), display-only — not used in pricing/generation
  parcelRings: z.array(z.array(z.array(z.number()))).nullish(),
  // Contact info (persisted with the saved record, not used in pricing)
  contactName: z.string().nullish(),
  contactPhone: z.string().nullish(),
  contactEmail: z.string().nullish(),
  address: z.string().nullish(),
  additionalNotes: z.string().nullish(),
  // Land clearing fields
  acreage: z.number().positive().nullish(),
  parcelAcreage: z.number().positive().nullish(),
  parcelId: z.string().nullish(),
  ownerName: z.string().nullish(),
  zoning: z.string().nullish(),
  floodZone: z.string().nullish(),
  sfha: z.boolean().nullish(),
  wetlandsOnSite: z.boolean().nullish(),
  wetlandType: z.string().nullish(),
  // Upload plans fields
  trades: z.array(z.string()).nullish(),
  files: z.array(FileSchema).nullish(),
  // Rich service details (land clearing)
  serviceDetails: z.object({
    serviceTypes: z.array(z.string()).optional(),
    clearingArea: z.string().optional(),
    vegetationType: z.string().optional(),
    drainageIssues: z.boolean().optional(),
    easements: z.boolean().optional(),
    existingStructures: z.boolean().optional(),
    accessRoad: z.string().optional(),
    debrisHandling: z.string().optional(),
    startDate: z.string().optional(),
    urgency: z.string().optional(),
    permitsStatus: z.string().optional(),
    largerProject: z.boolean().optional(),
    customClearingPolygon: z.object({
      sqFt: z.number(),
    }).optional(),
    clearingPlanFiles: z.array(FileSchema).optional(),
    // Written description of the work needed — required in place of plan
    // files when no plans are uploaded (upload_plans path).
    scopeOfWork: z.string().optional(),
  }).nullish(),
});

const MaterialLineItemSchema = z.object({
  description: z.string(),
  partNumber: z.string().optional(),
  unit: z.string(),
  qty: z.number(),
  unitCost: z.number(),
  total: z.number(),
});

const LaborLineItemSchema = z.object({
  description: z.string(),
  total: z.number().int(),
});

const TreeInventorySchema = z.object({
  estimatedCount: z.number().int(),
  species: z.array(z.string()),
  sizeDistribution: z.string(),
  density: z.string(),
  notes: z.string(),
});

const QuoteSchema = z.object({
  summary: z.string(),
  treeInventory: TreeInventorySchema.optional(),
  materialLineItems: z.array(MaterialLineItemSchema),
  laborLineItems: z.array(LaborLineItemSchema),
  subtotal: z.number().int(),
  mobilization: z.number().int(),
  disposal: z.number().int(),
  total: z.number().int(),
  estimatedDuration: z.string(),
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
});

export type QuoteResult = z.infer<typeof QuoteSchema>;
export type QuoteRequestData = z.infer<typeof QuoteRequestSchema>;

export class QuoteGenerationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const LAND_CLEARING_PROMPT = `You are an expert construction cost estimator with 20+ years of experience in Florida and southern Georgia. Produce accurate, itemized land clearing takeoff estimates.

== PARTIAL LAND / UNDERBRUSH CLEARING (Forestry Mulcher ONLY) ==
When the service is "Partial Land / Underbrush Clearing", a forestry mulcher is the ONLY machine used.

If a satellite image is provided, analyze it to populate the treeInventory field:
- Estimate tree/stem count visible in the clearing area using a systematic grid method (divide the area into quadrants, count each quadrant, sum the total) rather than a single whole-image impression; round to the nearest 10 (nearest 5 if under 50)
- Identify species present (pine, oak, palm, palmetto, etc.)
- Estimate size distribution (small, medium, large)
- Note density (sparse, moderate, dense) — cross-reference against the client's selected vegetation type (Light/Medium/Heavy) and note any discrepancy

LINE ITEM 1 — Forestry Mulching (rate based on selected vegetation density):
- Light vegetation:  $1,200–$2,500/acre
- Medium vegetation: $2,500–$3,500/acre
- Heavy vegetation:  $3,500–$5,000/acre

If the aerial image shows a density that differs significantly from the client's selection (e.g., client selected Light but image shows dense canopy), note this discrepancy in the assumptions and price at the higher observed density.

MINIMUM PRICING RULE: Always price a minimum of 1 acre regardless of actual acreage. If the clearing area is less than 1 acre, set qty = 1.00 acre and use the full per-acre rate. Never calculate a total lower than the single-acre rate.

LINE ITEM 2 — Debris Handling (based on client's debris handling selection):
- "Mulch / leave on property" (no removal): $0 — do NOT add a debris line item
- "Haul off" (remove debris):
    Light vegetation:  $500–$800/acre (minimum 1 acre)
    Medium vegetation: $800–$1,500/acre (minimum 1 acre)
    Heavy vegetation:  $1,500–$2,500/acre (minimum 1 acre)
- "Burn on-site (permit required)": $300–$500/acre flat (minimum 1 acre)

Use the acreage provided (custom-drawn area if given, otherwise full parcel acreage). Apply the 1-acre minimum to all line items. Set mobilization to $0 — do not add a mobilization charge. Do not add stump grinding, root raking, or any other line items.

== COMPLETE LAND CLEARING (Conventional Equipment) ==
When the service is "Complete Land Clearing", you will receive a satellite aerial image of the parcel. Analyze the image carefully to:
1. Count the total number of visible trees using a systematic grid method — do not eyeball the whole image at once: mentally divide the clearing area into a grid of equal quadrants (4x4 for parcels under 2 acres, larger grids scaled proportionally for bigger parcels), count individual tree canopies quadrant by quadrant, then sum the quadrant counts for the total. Round the final total to the nearest 10 trees (nearest 5 for totals under 50) — this is an imagery-based estimate, not a field count, and false precision overstates confidence in the number.
2. Identify species present — use what is common for FL/GA (pine, live oak, water oak, laurel oak, sabal palm, cypress, magnolia, sweetgum, etc.)
3. Estimate size distribution: small (<6" DBH), medium (6–18" DBH), large (>18" DBH) — apply these percentages to the rounded total count from step 1, then round each size-category count to the nearest 5
4. Assess density: sparse, moderate, or dense — base this directly on the counted total ÷ clearing acreage (trees/acre), not a separate visual impression: under 15 trees/acre = sparse, 15–40 = moderate, over 40 = dense
5. Note any special observations (standing water, dense canopy, palmettos, etc.)

Populate the treeInventory field with this analysis. Use it to price the job accurately.

PRICING — use the ranges below as market benchmarks for FL / south GA (2026). Within each range, always target the LOW end of the zip code's local market rate — do not scale up for higher-cost zip codes (South FL, coastal GA included). Generate the following line items:

1. Tree Removal — Small (<6" DBH): $75–$150/tree — qty = estimated small tree count from image
2. Tree Removal — Medium (6–18" DBH): $150–$400/tree — qty = estimated medium tree count from image
3. Tree Removal — Large (>18" DBH): $400–$1,200/tree — qty = estimated large tree count from image
4. Stump Grinding: $75–$200/stump — qty = total estimated stump count (sum of all tree sizes)
5. Root Digging / Grubbing: $500–$1,500/acre — mechanical extraction of root balls and root systems after tree removal; qty = clearing acreage
6. Underbrush / Partial Clearing (Forestry Mulcher): ground-level vegetation, brush, and small stems — price per acre based on selected vegetation density:
   - Light vegetation:  $1,200–$2,500/acre
   - Medium vegetation: $2,500–$3,500/acre
   - Heavy vegetation:  $3,500–$5,000/acre
   Apply 1-acre minimum if area is less than 1 acre.
7. Tree Debris Disposal — price based on debris handling selection:
   - "Haul off": $300–$600/load — estimate number of loads based on tree count and density
   - "Chip/mulch on-site": $200–$500/acre
   - "Burn on-site (permit required)": $300–$500/acre

Within each range, always choose a rate at the low end of the zip code's local market. Do NOT add site grading, cleanup, or mobilization line items.

Line items must reflect the actual estimated tree count from your image analysis. Show qty as number of trees (by size category) for removal line items, acres for per-acre items, and loads/tons for disposal.

== COMPLETE LAND CLEARING — PLANS VS. SATELLITE COMPARISON ==
When clearingArea is "Per Construction Plans" and both a satellite image and construction plans are provided:
- Cross-reference the plans against the satellite image to identify ONLY the areas that need clearing
- Note which trees and vegetation fall within the planned clearing footprint
- Count only trees in the clearing area (not the whole parcel)
- Price accordingly — if clearing area is smaller than full parcel, adjust quantities to match
- In the summary, briefly describe what the plans show and how it compares to existing site conditions

== ALL CLEARING JOBS ==
- Wetland delineation: $1,500–$4,000 flat if wetlands present
- Flood zone SFHA: add dewatering line + elevation certificate note
- Permit requirement: if the parcel's zoning indicates agricultural use (e.g. "AG", "Agricultural", "A-1", "A-2", or similar county agricultural designations), no permit is required for land clearing itself — state this explicitly as an assumption and do NOT include a land-clearing permit warning. For all other zoning, include a warning that a land-clearing permit may be required from the county. This does not apply to the separate burn-on-site permit, which is still required whenever "Burn on-site" debris handling is selected, regardless of zoning.

Line item categorization (required): every clearing service in this scope (forestry mulching, tree removal, stump grinding, root digging/grubbing, debris handling/disposal, wetland delineation, dewatering) is an equipment/labor service with no separately purchased material — put the full cost of each into laborLineItems (description + total only). materialLineItems should be empty for standard clearing jobs unless a physical material is actually purchased and left on site.

Accounting rules:
- subtotal = sum of all materialLineItems totals + sum of all laborLineItems totals (not mobilization or disposal)
- mobilization = 0 always — do not charge a mobilization fee for any clearing service
- total = subtotal + mobilization + disposal
- Material line items: show unit, qty, and unitCost (cost per unit) — total = qty × unitCost; qty to 2 decimal places
- Labor line items: show ONLY a total dollar amount for that labor scope — no qty or per-unit rate
- All dollar amounts as integers
- Include 3–8 assumptions and all permit/wetland/flood warnings`;

const PLANS_PROMPT = `You are an expert construction cost estimator with 20+ years of experience in Florida and southern Georgia. A client has uploaded construction plans. Read them carefully and produce detailed quantity takeoffs and cost estimates for the requested trades.

TAKEOFF METHODOLOGY (required — follow this before pricing anything):
- DEFAULT CASE — PLANS ONLY, NO MATERIAL LIST PROVIDED: most jobs will include ONLY design drawings, with no supplier quote attached. This is the normal case, not a degraded one — every rule below must independently produce accurate, complete quantities directly from the drawings themselves. Never lower your rigor, hedge with vague quantities, or ask the client to supply a material list; measuring and counting directly off the plans (per the rules below) is the primary method, always available and always required.
- SUPPLIER QUOTES, WHEN PROVIDED, ARE A BONUS CROSS-CHECK — NOT A REQUIREMENT: if one of the uploaded files happens to also be a supplier price quote or invoice for THIS project (itemized part numbers, quantities, unit prices, and a subtotal — e.g. a Ferguson or similar distributor quote), treat it as an already-completed, verified takeoff for that portion of the job and use its exact quantities/prices directly instead of re-measuring those specific items. Identify it by its format (a priced order form, not a design drawing). This only ever applies on top of the plan-reading rules below — it never replaces them, since most items on most jobs will have no matching quote line at all.
- Review EVERY page/sheet provided, not just the first one. Civil plan sets typically span multiple sheets (paving/grading/drainage, water/sewer, SWPPP, details) and each sheet shows different proposed work — skipping a sheet means missing real scope.
- On each sheet, read the LEGEND first to identify every symbol used for proposed work (proposed catch basin, proposed pipe by size/type, proposed manhole, proposed water main, proposed sewer main, proposed valve, proposed backflow device, proposed fire hydrant, etc.). Distinguish PROPOSED from EXISTING — only proposed work gets a line item unless the scope explicitly covers modifying existing infrastructure.
- Count every occurrence of each proposed symbol on the plan (every catch basin marker, every valve symbol, every hydrant) — do not round or estimate a count when the plan shows discrete, countable symbols.
- PIPE MEASUREMENT (do this carefully — this is the most error-prone part of the takeoff): a printed length callout on the plan (e.g. "140 LF") always wins — use it directly and skip measuring. When no callout exists, measure using the sheet's GRAPHIC scale bar (the drawn ruler graphic), not just the printed ratio text (e.g. "1" = 30'-0""), since a PDF page can be resized during export/scanning so the printed ratio no longer matches actual on-page distances — calibrate against the graphic bar's own length. Trace each pipe run segment by segment between its actual endpoints (structure to structure — catch basin to catch basin, catch basin to manhole, tie-in point to first structure, etc.); do not eyeball the whole run as one guess. Sum the segment lengths per distinct pipe size/material for that line item's qty. After finishing a pipe quantity, re-trace the same run a second time independently — if the two measurements disagree by more than ~10%, remeasure a third time and use the median, and note the uncertainty in assumptions rather than silently picking one.
- Read any schedule or table printed on the sheet (pipe crossing tables, structure schedules, fixture counts, general notes) — these give exact quantities directly and take priority over visual estimation or measurement.
- Cross-reference every material identified against the FERGUSON WATERWORKS CATALOG, FERGUSON PVC DRAINAGE & PRESSURE PIPE, FERGUSON PVC-DWV FITTINGS & PLUMBING ACCESSORIES, and DRAINAGE STRUCTURES catalogs below by matching size and type — use the exact catalog part number and price whenever it matches. Only fall back to a benchmark range when nothing in any catalog matches.
- Produce a COMPLETE takeoff: many precise, smaller line items (one per pipe size, one per valve type, one per structure type/size) beats consolidating into a single vague line. If plans show catch basins in two different sizes, that's two line items with the correct quantity each, not one.
- Sanity-check every quantity against realistic project scale before finalizing: a quantity that implies an absurd site size (e.g. thousands of feet of pipe on a sub-acre parcel, or dozens of catch basins on a small lot) signals a measurement error — remeasure it rather than reporting it.
- Note in assumptions anything visible on the plans that couldn't be confidently sized or counted from the imagery — don't silently omit it from the takeoff.
- FINAL REVIEW PASS (required, do this last): before writing the final output, re-open every sheet one more time and check your complete draft line-item list against what's actually drawn — confirm nothing was miscounted, no size/type label was misread, and no proposed item found earlier was dropped along the way. Treat this as a required audit step, not optional polish.

Line item categorization (required for every trade below): split every cost into materialLineItems and laborLineItems — never output a single bundled line covering both.
- MATERIAL: anything with a physical unit that is purchased (concrete, block, brick, rebar/reinforcement, forming lumber, pipe, fittings, fixtures, etc.). Show unit, qty, and unitCost (cost per unit) — total = qty × unitCost.
- LABOR: installation, placement, equipment operation/rental, and crew time. Show ONLY a total dollar amount for that labor scope — no qty or per-unit rate.
- Where a benchmark below gives one bundled rate covering both material and labor, split it using standard cost-breakdown norms for that trade (material is typically 30–50% of installed cost for mechanical trades like plumbing; 40–55% for masonry/concrete) — split the SAME benchmark range given, don't invent a new total.
- Trades that are pure equipment/site services with no purchased material (grading, excavation) are entirely labor — do not fabricate a material line for them.

Wherever a rate below is tied to "the zip code's local market rate," always target the LOW end of that market rate — do not scale up for higher-cost zip codes.

Pricing benchmarks (FL / south GA, 2026):

GRADING: Read the plans carefully to extract grade elevations, cut/fill areas, drainage slopes, and site boundaries. Generate these line items:
- Rough Grading: $1,500–$2,500/acre (target the low end of the market rate for zip)
- Fine / Finish Grading: $2,500–$4,000/acre
- Cut / Fill Earthwork: $10–$18/cy — extract volume from plan contours or notes if shown; otherwise estimate from site area and elevation change
- Soil Compaction: $300–$500/test — 1 test per acre
- Fill Import (if plans show fill needed): clean fill dirt is sold by the load, not by the cy — $230.00/load, 17 cy per load (delivery/haul already included in the per-load price; do not add a separate haul line). Calculate total fill volume needed in cy from the plans, divide by 17, and round UP to the nearest whole load (partial loads aren't sold) — that whole-number load count is the qty. Material line item: unit = "load", qty = load count, unitCost = $230.00.
- Retention / Drainage Swales (if shown on plans): $25–$55/linear ft
Note: if the plans show specific grade elevations or cut/fill volumes, use those exact quantities. If not shown, state the assumption in the assumptions list.

EXCAVATION: general $8–$25/cy; foundation footings $3,000–$8,000/building; utility trenching $15–$35/lf

UNDERGROUND PLUMBING: below-slab and yard supply/waste lines —
- Underground water service (meter to structure): $2,000–$5,000
- Underground sewer/waste line: $15–$35/lf
- Under-slab rough plumbing (supply + DWV stub-outs): $4,000–$8,000/bathroom
- Lift station (if required by site grade/plans): $15,000–$40,000
- Whenever the plans call for water main/sewer utility hardware or PVC drainage/pressure pipe and fittings matching an item in the FERGUSON WATERWORKS CATALOG, FERGUSON PVC DRAINAGE & PRESSURE PIPE, or FERGUSON PVC-DWV FITTINGS & PLUMBING ACCESSORIES catalogs below (pipe, valves, hydrants, backflow preventers, taps, saddles, restraints, elbows, traps, nipples), use that exact part and unit cost as its own material line item instead of estimating within the ranges above — always include the part number in the materialLineItems "partNumber" field.

FERGUSON WATERWORKS CATALOG (Pompano Beach, FL branch — exact contractor pricing; use whenever a required material matches, quantities per job vary by takeoff, not by these reference qtys):
- A18810020DW — 18x20 F2648 Perforated HDPE Pipe: $33.75/ft
- A18650020DW — 18x20 F2648 Watertite Solid HDPE Pipe: $31.55/ft
- A15810020DW — 15x20 F2648 Perforated HDPE Pipe: $25.33/ft
- A15650020DW — 15x20 F2648 Watertite Solid HDPE Pipe: $23.69/ft
- SDR35PU14 — 6x14 SDR35 PVC Gasket-Joint Sewer Pipe: $6.89/ft
- SDR35P1014 — 10x14 SDR35 PVC Gasket-Joint Sewer Pipe: $19.45/ft
- MJTSDI12U — 12x6 MJ Tapping Sleeve for DI: $4,235.08/ea
- AFC2506MMLAOL — 6" DI MJ Resilient-Wedge OL Gate Valve L/A: $1,092.84/ea
- AFC2506TMLAOL — 6" DI MJ Resilient-Wedge OL Tapping Valve L/A: $1,699.06/ea
- AFT52PU — 6" CL52 Ductile Iron Fastite Pipe: $43.79/ft
- FPPUU — 6x6'0 Flange x PE Ductile Iron Spool: $1,006.60/ea
- CFU — 6" DI C110 125# Threaded Companion Flange for Steel: $198.52/ea
- U90U — 6" DI UL/FM Wafer Check Valve: $411.10/ea
- IGNUCL — 6" Close Galvanized Steel Nipple: $538.56/ea
- D90DCS6025F — 6x2-1/2 Angle Siamese Connection, Auto Sprinkler: $779.00/ea
- GDATRFU — 3/4x6 Hot-Dip Galvanized All-Thread Rod: $5.32/ft
- GDHNF — 3/4" Galvanized Heavy Hex Nut: $1.94/ea
- GFSWF — 3/4" Galvanized Flat Steel Washer: $0.80/ea
- SSLDE6AP — 6" DI Wedge Restraint (OneLok) W/A: $116.10/ea
- AFCB84BLAOLP — 5-1/4" Fire Hydrant, B84B, 4'0" Bury, OL, L/A: $4,417.20/ea
- R202N132072 — 12x2 IP Double Stainless Strap Nylon Saddle: $375.91/ea
- FFB11007NL — 2" MIP x CTS PJ Ball Corporation Stop (lead-free): $361.73/ea
- WLF009M2QTFSK — 2" LF RPZ Backflow Preventer Assembly: $888.33/ea

FERGUSON PVC DRAINAGE & PRESSURE PIPE (Tamarac, FL branch — exact contractor pricing, converted to $/ft from stock 10'/20' stick pricing; use whenever a plan calls for PVC pipe in these diameters):
- P40FCPM20 — 3" Schedule 40 PVC Foam Core Pipe: $1.78/ft
- P40PM20 / P40PM10 — 3" Schedule 40 PVC-DWV Plain End Drainage Pipe: $2.49/ft
- P40BEPM20 — 3" Schedule 40 Bell End x Plain End PVC Pressure Pipe: $2.63/ft
- P80PM — 3" Schedule 80 PVC Pressure Pipe, Plain End: $23.05/ft
- P80BM — 3" Schedule 80 PVC Pressure Pipe, Bell End: $24.33/ft
- P40FCPP20 — 4" Schedule 40 PVC Foam Core Pipe: $2.59/ft
- P40PP20 / P40PP10 — 4" Schedule 40 PVC-DWV Plain End Drainage Pipe: $3.39/ft
- P40FCPU20 — 6" Schedule 40 PVC Foam Core Pipe: $5.00/ft
- P40PU20 / P40PU10 — 6" Schedule 40 PVC-DWV Plain End Drainage Pipe: $6.63/ft
- P40FCPX20 — 8" Schedule 40 PVC Foam Core Pipe: $7.61/ft
- P40PX20 / P40PX10 — 8" Schedule 40 PVC-DWV Plain End Drainage Pipe: $10.35/ft
- SDR35PX20 — 8" SDR 35 PVC Gasket-Joint Drainage Pipe (green): $18.05/ft
- P40BEPF10 — 3/4" Schedule 40 PVC Pressure Pipe: $0.46/ft
- CPFGPF20 — 3/4" SDR 11 CPVC (FlowGuard Gold) Pressure Pipe: $0.79/ft
- PEXBF20WH — 3/4" PEX-B Tubing: $0.65/ft
- LHARDF20 — 3/4" Type L Hard Copper Tube: $6.57/ft

FERGUSON PVC-DWV FITTINGS & PLUMBING ACCESSORIES (Tamarac, FL branch — exact contractor pricing, each):
- PDWVS2K — 2" PVC DWV 22-1/2° Street Elbow: $8.76/ea
- PDWVS4K — 2" PVC DWV 45° Street Elbow: $3.53/ea
- PDWV2K — 2" PVC DWV 22-1/2° Elbow: $5.46/ea
- PDWVLS9K — 2" PVC DWV 90° Long Turn Elbow: $5.65/ea
- PDWVPTK — 2" PVC DWV P-Trap: $9.21/ea
- P40S9F — 3/4" PVC Schedule 40 90° Elbow: $0.87/ea
- P40SS9F — 3/4" PVC Schedule 40 90° Street Elbow: $2.81/ea
- P40S4F — 3/4" PVC Schedule 40 45° Elbow: $1.63/ea
- PFWR — PROFLO Heavy Duty Wax Ring, 3-4" waste lines: $1.90/ea
- PFX146472 — PROFLO Braided Stainless Toilet Flex Connector, 3/8" comp x 7/8" x 12": $7.36/ea
- IBNDK — PROFLO 1/2x2" MPT Black Carbon Steel Nipple: $1.96/ea
- IBNFK — PROFLO 3/4x2" MPT Black Carbon Steel Nipple: $1.99/ea
Note: pipe above is stocked in fixed 10'/20' sticks — the $/ft rate is for pricing measured field footage from the takeoff; do not round quantities up to whole stick lengths.

DRAINAGE STRUCTURES (catch basins/grates — Hampton Concrete Products, exact pricing; use whenever plans show catch basins as part of grading/site drainage. These items have no SKU — set the "partNumber" field to just "Hampton Concrete" (the vendor name), do NOT repeat the item description there):
- 22x30x36 Catch Basin w/ Bottom: $325.00/ea
- 30x38x42 Catch Basin w/ Bottom: $1,920.00/ea
- 22x30 Angle Grate: $217.00/ea
- 22x30 Heavy-Duty Angle Grate: $293.00/ea
- Freight/delivery for catch basin orders: ~$2,000 flat per delivery — classify as a labor line item ("Catch Basin Freight/Delivery"), not material, and only include once per job when catch basins are ordered.

SEPTIC: new system, tank + drainfield —
- Standard 3-bedroom system (FL/GA baseline): $8,000–$15,000
- Additional bedroom capacity: +$1,500–$2,500/bedroom over 3
- Permit & percolation test: $500–$1,200
- Aerobic treatment unit (if required by soil conditions or flood zone): +$5,000–$10,000

CONCRETE QUANTITY CALCULATION (ready-mix — apply this wherever "ready-mix concrete" pricing is called for below): cubic yards = (length in ft × width in ft × depth in ft) ÷ 27. Take length/width/depth directly from the plans (slab dimensions, footing/wall cross-section × run length, etc.) — use printed dimensions over scaled measurement wherever shown, same priority as the pipe-measurement rule above. Add a 10% waste margin to the calculated volume (round up), matching standard ready-mix supplier practice (Cemex and similar suppliers recommend a 10–15% overage for spillage and surface variance) — state the raw calculated volume and the with-waste qty used in assumptions. Ready-mix concrete has no fixed public price (suppliers quote per delivery/market) — price it to the zip code's local market rate as instructed elsewhere in this prompt, low end of range.

FOUNDATIONS: brick foundation walls, priced by brick count — not square footage.
- Extract wall linear footage and wall height from the plans; estimate total brick count (standard modular brick ≈ 7 bricks per sf of wall face — adjust if plans specify a different brick size or coursing). Subtract door/window openings from the wall area before converting to brick count.
- Labor: $6.00/brick — fixed rate, do not vary by zip
- Material: $0.55–$0.95/brick — always target the low end of the zip code's local material market rate
- Generate two line items: "Foundation Wall Labor (brick)" and "Foundation Wall Material (brick)", both with qty = total brick count
- Footings beneath the brick wall (if shown on plans): $25–$55/lf, separate line item

ELECTRICAL: service 200A $3,000–$6,000; rough-in $3–$6/sf; panel $2,000–$4,000; underground $15–$40/lf

MASONRY: CBS block walls $18–$35/sf; brick veneer $20–$40/sf; poured concrete walls $15–$30/sf; reinforced block $22–$40/sf

WOOD FRAME EXTERIOR WALL SHELL (use in place of the CBS/brick model when plans show wood or metal stud framing instead of masonry): standard platform framing, 16" o.c. stud spacing, exterior shell only — interior partition walls, roof trusses/rafters, and roof deck framing/sheathing are OUT OF SCOPE (see ROOFING below, which assumes the roof deck already exists).
- Wall studs: extract exterior wall linear footage and wall height (bottom plate to top plate) from the plans. Stud count = (linear footage × 0.75, for 16" o.c.) + 1, plus 3 extra studs per corner and 2 extra studs per wall intersection/tee shown on the plan (nailing backing) — round up. Use 2x4 unless plans call for 2x6; Home Depot contractor rate: 2x4x8 SPF/SYP stud $4.50–$7.50/ea, 2x6x8 stud $8.50–$12.50/ea.
- King studs & jack studs: for every door/window rough opening, add 2 king studs (full height) + 2 jack studs (1 each side; use 4 jack studs total — 2 each side — for openings wider than 6 ft needing a built-up header) at the same per-stud rate as wall studs above.
- Headers: one per door/window opening, spanning the opening. Header length = opening width + 16" total bearing (8" each side — same bearing convention as the CBS lintel rule below, for consistency). Built-up dimensional (2-ply/3-ply 2x, per span shown) at Home Depot contractor rate $9.00–$16.00/lf; if plans call out an LVL/engineered header, use $18.00–$32.00/lf instead.
- Sheathing: exterior wall sheathing only, net wall face area (gross wall face minus door/window openings — same net-area method as the CBS stucco calc below). 7/16" OSB, Home Depot contractor rate: material $0.70–$1.20/sf, installation labor $0.60–$1.10/sf — separate material and labor line items.
- Fasteners (framing + sheathing nails): allowance of $0.12–$0.20/lf of wall framed, one material line item — do not itemize individual nails.
- Hurricane straps/ties: one per wall stud (top-plate-to-stud tie, standard FL/GA wind-code requirement), qty = wall stud count (not king/jack studs). Simpson Strong-Tie or equivalent, Home Depot contractor rate $2.25–$4.50/ea material.
- Framing labor (erecting/nailing studs, king/jack studs, and headers — excludes sheathing installation and strap installation, both priced separately above): $2.50–$4.00/lf of wall framed, one labor line item.
- Generate separate line items: wall studs (material), king/jack studs (material), headers (material), sheathing (material), sheathing installation (labor), fasteners (material), hurricane straps (material), framing labor (labor).

ROOFING (composition shingle roof covering, standard FL/GA residential): covers roof covering materials and installation labor ONLY — roof trusses, rafters, and roof deck framing/sheathing are a separate scope and are NOT priced here; assume the roof deck already exists.
- Roof area: extract total roof plan area from the roof plan/elevations if shown (footprint × pitch multiplier). If only footprint and pitch are given, apply the standard multiplier (4:12 ≈ 1.054×, 6:12 ≈ 1.118×, 8:12 ≈ 1.202×; use 1.15× as a default and state it as an assumption if pitch isn't shown). Convert to roofing squares (1 square = 100 sf), rounding up to the nearest whole square.
- Roofing labor: $350.00/square — flat rate, do not vary by zip. One labor line item, qty = total squares.
- Roofing materials, Home Depot contractor rates: architectural asphalt shingles $38–$55/square; synthetic underlayment $28–$42/square; drip edge $0.85–$1.40/lf (roof perimeter); ridge cap shingles $3.50–$5.50/lf (ridge length); roofing nails/fasteners allowance $3–$6/square. Separate material line item for each (shingles, underlayment, drip edge, ridge cap, fasteners), qty in squares or lf as appropriate.
- If plans show a metal roof instead of shingles, use $9–$16/sf material for standing-seam metal panels in place of the shingle/underlayment lines and note the substitution as an assumption; labor stays $350/square unless plans indicate otherwise.

COMPLETE HOME BUILD: exterior shell only, from plans. Covers foundation, exterior wall shell (CBS/brick masonry OR wood/metal-frame structural framing per the plans, including the rough-opening framing — king studs, jack studs, headers — around doors/windows), and roofing (covering only). Electrical, interior finish, and the window/door units themselves (the actual products and their installation into the rough opening) remain OUT OF SCOPE — never add a line item for installing a window/door unit, only the rough-opening framing/lintel around it. Roof trusses, rafters, and roof deck framing/sheathing are also OUT OF SCOPE — the ROOFING benchmark above assumes an existing/already-priced roof deck; do not price a truss package unless the plans provide an actual truss schedule with supplier pricing attached. If land clearing (Complete Land Clearing or Partial Land / Underbrush Clearing) is also requested as part of this build, price and list those clearing line items FIRST, ahead of every trade below, using the land-clearing rates elsewhere in this system prompt. Read the plans carefully and generate line items for every applicable trade/system shown or required within that scope — do not price this as a single lump sum. In construction sequence order:
- Grading: use the GRADING rates above (rough grading, fine/finish grading, cut/fill earthwork, soil compaction, fill import, retention swales) — include whichever line items the plans/site call for
- Excavation: use the EXCAVATION rates above (general cy, foundation footings, utility trenching)
- Foundation: if plans show a brick foundation wall, use the brick model (labor $6.00/brick + $0.55–$0.95/brick zip-market material); if CBS block, use $2.00/block flat as the material cost (does not vary by zip) plus a separate block-laying labor line at standard regional masonry labor rates; if poured concrete (slab-on-grade or stem wall), calculate ready-mix concrete qty per the CONCRETE QUANTITY CALCULATION rule above and price it to the zip code's local market rate, concrete forming lumber (formwork) at Home Depot (depot.com) contractor-account rates, and rebar/reinforcement/accessories at Resteel (resteel.com) wholesale rates
- Exterior Wall Structural Shell: if brick elevations are shown, use the brick model (labor $6.00/brick + $0.55–$0.95/brick zip-market material); if CBS block, use $2.00/block flat as the material cost plus a separate block-laying labor line; if wood/metal-framed wall (no masonry shell shown), use the WOOD FRAME EXTERIOR WALL SHELL benchmark above for the full structural framing/sheathing takeoff (studs, king/jack studs, headers, sheathing, fasteners, straps, framing labor).
- Exterior Wall Finish Coat: a SEPARATE line item from the structural shell above — block/frame does not replace the finish, and the finish does not replace the structure. Stucco finish over CBS block: $4–$8/sf of wall face (3-coat stucco, materials + application labor combined). Siding over a wood/metal-framed wall (vinyl, fiber-cement/Hardie, or wood, per elevations), installed over the sheathing from the framing takeoff: $12–$25/sf of wall face. Brick veneer/elevations need no separate finish coat (brick is both structure and finish). Subtract door/window openings from the wall area for both the shell and finish-coat quantity (same net-area method as the brick-count rule above).
- Lintels & Sills (CBS block/brick openings only — wood-framed openings use the king stud/jack stud/header takeoff in the WOOD FRAME EXTERIOR WALL SHELL benchmark instead, not this line): every door and window opening in a block or brick wall needs a lintel (spanning the top of the opening) and, for windows, a sill (at the bottom). Sum the linear footage of all door/window opening widths shown on the elevations (add ~16" total bearing per opening, standard 8" bearing each side, to the raw opening width). Precast Concrete Lintel: $9.00–$14.00/lf. Precast Concrete Sill (windows only, not doors): $10.00–$16.00/lf. Two separate line items.
- Roofing: use the ROOFING benchmark above (roof covering labor + materials — shingles/underlayment/drip edge/ridge cap or metal panels, per the plans). Skip this line only if the plans explicitly show the roof as a separately-scoped/already-installed system.
- Underground Plumbing / Septic: use the rates above for whichever the plans show (municipal sewer/water connection vs. on-site septic system) — price plumbing and drainage materials at Ferguson (ferguson.com) wholesale/contractor-account rates
- Wall Pour Concrete (poured foundation/retaining walls, where separate from the Foundation line above): calculate ready-mix concrete qty per the CONCRETE QUANTITY CALCULATION rule above and price it to the zip code's local market rate, forming lumber at Home Depot (depot.com) contractor-account rates, and rebar/accessories at Resteel (resteel.com) wholesale rates
- Overhead & Builder Profit: 12–18% of the line items above — include as its own line item, not folded into mobilization
Only include line items for trades/systems actually shown in or implied by the plans — e.g. skip grading if the site is already level and plans show no cut/fill, skip septic if plans show a municipal sewer connection. Use finish-quality cues in the plans (custom millwork, upgraded elevations) to place each range near the top; track-home / builder-grade specs price near the bottom.

If dimensions are unclear from the plans, estimate from visible scale or typical construction for the region and note it as an assumption.

Accounting rules:
- subtotal = sum of all materialLineItems totals + sum of all laborLineItems totals (not mobilization or disposal)
- mobilization = 0 always — do not charge a mobilization fee for any trade
- total = subtotal + mobilization + disposal
- Material line items: show unit, qty, and unitCost (cost per unit) — total = qty × unitCost; qty to 2 decimal places. When unitCost comes from an exact supplier catalog above (Ferguson, Hampton Concrete), keep the exact cents from that catalog rather than rounding to a whole dollar; otherwise round unitCost/total to whole dollars. partNumber must stay short (an actual SKU, or a brief vendor tag like "Hampton Concrete") — never repeat the description text there, and leave it out entirely when no catalog match applies.
- Labor line items: show ONLY a total dollar amount for that labor scope — no qty or per-unit rate; whole dollars
- Include 3–8 assumptions; flag any items that need field verification`;

// Reverse-engineered from Epic Consulting Group's public instant-quote tool
// (epiconsultingroup.com/shell-contractor-services), verified linear across
// 1,000-4,000 sqft. Admin-only, opt-in — appended to the system prompt in
// code only when source is "admin_free" AND the admin's own instructions
// explicitly ask for it, never for customer-facing generation and never for
// a standalone Foundation-only job.
const EPIC_SHELL_RATES_ADDENDUM = `== EPIC CONSULTING GROUP SUBCONTRACTOR RATES (Foundation + Shell/Framing) — ADMIN-ONLY, OPT-IN ==
Only use this block if the admin's instructions explicitly ask for Epic Consulting Group / "Epic" / subcontractor rates for foundation or shell work. If not explicitly requested, ignore this block entirely and use the standard COMPLETE HOME BUILD foundation/exterior-shell rules above instead. This ONLY applies to the Complete Home Build service — never apply it to a standalone Foundation-only job, and never mention or use it unless explicitly asked for.

When explicitly requested, REPLACE the standard Foundation line item AND the Exterior Wall Structural Shell line item (CBS block cost or the WOOD FRAME EXTERIOR WALL SHELL takeoff, whichever would otherwise apply) with this subcontracted package instead — do not also separately price foundation or wall framing when this block is in use:
- Foundation base rate: $19.00/sqft of total building square footage for a Steam Wall foundation, or $16.00/sqft for a Mono Slab foundation. If the foundation type isn't specified, default to Steam Wall ($19.00/sqft) and state that as an assumption.
- Shell add-on, stacked on top of the foundation rate, based on what's specified:
  - Interior framing included (or unspecified) — add $11.00/sqft. This bundles BOTH rough carpentry/truss installation AND interior framing — do not add a separate carpentry line on top of this.
  - Only rough carpentry/truss installation included, framing explicitly excluded — add $7.00/sqft.
  - Neither carpentry nor framing included — add $0/sqft (foundation only).
- Line total = (foundation rate + add-on rate) × total building square footage. Get square footage from the plans if provided, otherwise from the admin's instructions; if truly unavailable, estimate from the stated scope and note it as an assumption.
- Add this as a single labor line item: "Foundation & Shell — Epic Consulting Group (subcontracted)" showing only the total dollar amount (flat subcontractor package price, no qty/unit).
- This package covers foundation, rough carpentry, and interior framing ONLY. Roofing, electrical, interior finish, exterior wall finish (siding/stucco), windows/doors, and every other trade are still priced separately using the standard rules elsewhere in this prompt.`;

async function fetchAerialImageBase64(bbox: { minLng: number; maxLng: number; minLat: number; maxLat: number }): Promise<string | null> {
  try {
    const url = new URL("https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export");
    url.searchParams.set("bbox", `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`);
    url.searchParams.set("bboxSR", "4326");
    url.searchParams.set("size", "1024,768");
    url.searchParams.set("format", "png");
    url.searchParams.set("transparent", "false");
    url.searchParams.set("f", "image");
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    return Buffer.from(buffer).toString("base64");
  } catch {
    return null;
  }
}

export type GeneratedQuote = { quote: QuoteResult; estimateId: string | null; estMeta: EstMeta };

// Generates a quote from an already-validated request. Callers must gate
// access to this (payment, auth, etc.) — it has no gate of its own.
export async function generateQuote(
  rawBody: unknown,
  opts: { source?: "customer" | "admin_free" } = {}
): Promise<GeneratedQuote> {
  const source = opts.source ?? "customer";
  const parsed = QuoteRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new QuoteGenerationError(
      `Invalid request: ${JSON.stringify(z.flattenError(parsed.error))}`,
      400
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new QuoteGenerationError("Server misconfiguration", 500);
  }

  const cacheKey = cacheKeyFor(parsed.data);

  const {
    serviceType,
    acreage,
    parcelAcreage,
    county,
    state,
    zipCode,
    address,
    mapBbox,
    parcelRings,
    parcelId,
    ownerName,
    zoning,
    floodZone,
    sfha,
    wetlandsOnSite,
    wetlandType,
    contactName,
    contactPhone,
    contactEmail,
    additionalNotes,
    trades,
    files,
    serviceDetails,
  } = parsed.data;

  const estMeta = makeEstMeta();

  try {
    const cached = getCachedQuote(cacheKey);
    if (cached) {
      const saved = await saveEstimateRecord({
        quote: cached,
        fromCache: true,
        serviceType,
        county,
        state,
        zipCode,
        address,
        parcelId,
        ownerName,
        zoning,
        acreage,
        contactName,
        contactPhone,
        contactEmail,
        additionalNotes,
        trades,
        serviceTypes: serviceDetails?.serviceTypes,
        files,
        mapBbox,
        parcelRings,
        source,
        estMeta,
      });
      return { quote: cached as QuoteResult, estimateId: saved?.id ?? null, estMeta };
    }

    if (serviceType === "upload_plans") {
      const scopeOfWork = serviceDetails?.scopeOfWork?.trim();
      if ((!files?.length && !scopeOfWork) || !trades?.length) {
        throw new QuoteGenerationError(
          "upload_plans requires at least one file or a written scope of work, and at least one trade",
          400
        );
      }

      const tradeList = trades.join(", ");
      const sd = serviceDetails;
      const userMessage = [
        `Produce a construction takeoff estimate for the following services: ${tradeList}.`,
        `County: ${county}, ${state}`,
        acreage ? `Site area: ${acreage} acres` : null,
        sd?.drainageIssues ? `Site drainage/slope/wetland issues: Yes` : null,
        sd?.easements ? `Easements/ROW present: Yes` : null,
        sd?.existingStructures ? `Existing structures/debris to remove: Yes` : null,
        sd?.accessRoad ? `Site access: ${sd.accessRoad}` : null,
        sd?.urgency && sd.urgency !== "Flexible" ? `Urgency: ${sd.urgency}` : null,
        sd?.startDate ? `Desired start: ${sd.startDate}` : null,
        sd?.permitsStatus ? `Permits: ${sd.permitsStatus}` : null,
        files?.length
          ? "The construction plans are attached. Read the plans and extract quantities for each service listed."
          : "No construction plans were uploaded for this job. Base the takeoff entirely on the client's written scope of work below — estimate quantities from the description as best as reasonably possible, and note in assumptions wherever a quantity had to be inferred rather than measured.",
        scopeOfWork ? `\nCLIENT'S SCOPE OF WORK (primary description of the work needed — read carefully):\n${scopeOfWork}` : null,
        additionalNotes
          ? source === "admin_free"
            ? `\nADMIN'S ESTIMATOR DIRECTIONS (from ARC's own staff, not the client — this is a direct instruction on how to build this estimate: pricing methodology, rate sources, quantities to assume, or scope to include/exclude. Follow it precisely, even where it overrides a general assumption or benchmark above):\n${additionalNotes}`
            : `\nCLIENT'S ADDITIONAL INSTRUCTIONS (read carefully, apply to the estimate — this may call out a custom request, a scope change, or a detail on the plans that overrides a general assumption above):\n${additionalNotes}`
          : null,
      ]
        .filter(Boolean)
        .join("\n");

      const includesClearing = trades.some(
        (t) => t === "Complete Land Clearing" || t === "Partial Land / Underbrush Clearing"
      );
      let system = includesClearing ? `${PLANS_PROMPT}\n\n${LAND_CLEARING_PROMPT}` : PLANS_PROMPT;
      if (source === "admin_free" && trades.includes("Complete Home Build")) {
        system += `\n\n${EPIC_SHELL_RATES_ADDENDUM}`;
      }

      let aerialImageBase64: string | null = null;
      if (includesClearing && mapBbox) {
        aerialImageBase64 = await fetchAerialImageBase64(mapBbox);
      }

      const planBlocks: Anthropic.MessageParam["content"] = files?.length
        ? (
            await Promise.all(
              files.map(async (f) => {
                const buffer = await downloadFile(f.path);
                const data = buffer.toString("base64");
                const vectorText = await vectorAnalysisBlock(f.path, f.type, buffer);
                const fileBlock =
                  f.type === "application/pdf"
                    ? ({ type: "document", source: { type: "base64", media_type: f.type, data } } as const)
                    : ({ type: "image", source: { type: "base64", media_type: f.type, data } } as const);
                return vectorText ? [{ type: "text" as const, text: vectorText }, fileBlock] : [fileBlock];
              })
            )
          ).flat()
        : [];

      const contentBlocks: Anthropic.MessageParam["content"] = aerialImageBase64
        ? [
            { type: "text", text: "AERIAL SATELLITE IMAGE of the parcel (for land clearing tree/density analysis):" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: aerialImageBase64 } },
            { type: "text", text: "CONSTRUCTION PLANS (for structural takeoff):" },
            ...planBlocks,
          ]
        : planBlocks;

      const stream = client.messages.stream({
        model: "claude-opus-4-8",
        max_tokens: 28000,
        thinking: { type: "adaptive" },
        system,
        messages: [
          {
            role: "user",
            content: [...contentBlocks, { type: "text", text: userMessage }],
          },
        ],
        output_config: { format: zodOutputFormat(QuoteSchema) },
      });
      const message = await stream.finalMessage();

      if (!message.parsed_output) {
        console.error("Quote parse failure (upload_plans):", message.stop_reason, JSON.stringify(message.content).slice(0, 2000));
        throw new QuoteGenerationError("Failed to generate quote", 500);
      }
      setCachedQuote(cacheKey, message.parsed_output);
      const saved = await saveEstimateRecord({
        quote: message.parsed_output,
        fromCache: false,
        serviceType,
        county,
        state,
        zipCode,
        address,
        parcelId,
        ownerName,
        zoning,
        acreage,
        contactName,
        contactPhone,
        contactEmail,
        additionalNotes,
        trades,
        serviceTypes: serviceDetails?.serviceTypes,
        files,
        mapBbox,
        parcelRings,
        source,
        estMeta,
      });
      return { quote: message.parsed_output, estimateId: saved?.id ?? null, estMeta };
    }

    // Land clearing path
    if (!acreage) {
      throw new QuoteGenerationError("acreage is required for land clearing", 400);
    }

    const sd = serviceDetails;
    const hasCompleteClear = sd?.serviceTypes?.includes("Complete Land Clearing");
    const hasPartialClear = sd?.serviceTypes?.includes("Partial Land / Underbrush Clearing");
    const isPlanArea = sd?.clearingArea === "Per Construction Plans";

    // Fetch aerial image for any clearing service (tree/density analysis)
    let aerialImageBase64: string | null = null;
    if ((hasCompleteClear || hasPartialClear) && mapBbox) {
      aerialImageBase64 = await fetchAerialImageBase64(mapBbox);
    }

    const userMessage = [
      "Generate a land clearing takeoff estimate for the following parcel:",
      sd?.customClearingPolygon
        ? `- Clearing Area (user-drawn partial area): ${(acreage!).toFixed(4)} acres (${Math.round(acreage! * 43560).toLocaleString()} sq ft) — base ALL line-item quantities on this area`
        : `- Acreage to Clear: ${acreage} acres`,
      parcelAcreage ? `- Total Parcel Size: ${parcelAcreage} acres (for context only — estimate based on clearing area above)` : null,
      `- County: ${county}, ${state}`,
      zipCode ? `- ZIP Code: ${zipCode} (use this for market-rate pricing)` : null,
      parcelId ? `- Parcel ID: ${parcelId}` : null,
      ownerName ? `- Owner: ${ownerName}` : null,
      zoning ? `- Zoning: ${zoning}` : null,
      `- Flood Zone: ${floodZone ?? "Unknown"}${sfha ? " — SPECIAL FLOOD HAZARD AREA" : ""}`,
      `- Wetlands on Site: ${wetlandsOnSite ? `Yes${wetlandType ? ` (${wetlandType})` : ""}` : "No"}`,
      // Service details
      sd?.serviceTypes?.length ? `- Services Requested: ${sd.serviceTypes.join(", ")}` : null,
      sd?.clearingArea ? `- Area to Clear: ${sd.clearingArea}` : null,
      sd?.vegetationType ? `- Vegetation: ${sd.vegetationType}` : null,
      sd?.drainageIssues ? `- Drainage/Slope/Wetland Issues: Yes` : null,
      sd?.easements ? `- Easements/ROW Present: Yes` : null,
      sd?.existingStructures ? `- Existing Structures/Debris to Remove: Yes` : null,
      sd?.accessRoad ? `- Access Road: ${sd.accessRoad}` : null,
      sd?.debrisHandling ? `- Debris Handling: ${sd.debrisHandling}` : null,
      sd?.urgency && sd.urgency !== "Flexible" ? `- Urgency: ${sd.urgency}` : null,
      sd?.startDate ? `- Desired Start: ${sd.startDate}` : null,
      sd?.permitsStatus ? `- Permits: ${sd.permitsStatus}` : null,
      sd?.largerProject ? `- Part of larger build project: Yes` : null,
      additionalNotes
        ? source === "admin_free"
          ? `\nADMIN'S ESTIMATOR DIRECTIONS (from ARC's own staff, not the client — this is a direct instruction on how to build this estimate: pricing methodology, rate sources, quantities to assume, or scope to include/exclude. Follow it precisely, even where it overrides a general assumption or benchmark above):\n${additionalNotes}`
          : `\nCLIENT'S ADDITIONAL INSTRUCTIONS (read carefully, apply to the estimate — this may call out a custom request or a detail that overrides a general assumption above):\n${additionalNotes}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    let landClearingContent: Anthropic.MessageParam["content"];

    if (isPlanArea && sd?.clearingPlanFiles?.length && aerialImageBase64) {
      // Plans + satellite: compare both to determine clearing scope
      const planBlocks: Anthropic.MessageParam["content"] = (
        await Promise.all(
          sd.clearingPlanFiles.map(async (f) => {
            const buffer = await downloadFile(f.path);
            const data = buffer.toString("base64");
            const vectorText = await vectorAnalysisBlock(f.path, f.type, buffer);
            const fileBlock =
              f.type === "application/pdf"
                ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data } } as const)
                : ({ type: "image", source: { type: "base64", media_type: f.type as "image/png" | "image/jpeg" | "image/webp", data } } as const);
            return vectorText ? [{ type: "text" as const, text: vectorText }, fileBlock] : [fileBlock];
          })
        )
      ).flat();
      landClearingContent = [
        { type: "text", text: "IMAGE 1 — Aerial satellite photo of the parcel (for context and tree analysis):" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: aerialImageBase64 } },
        { type: "text", text: "IMAGES BELOW — Client-uploaded construction plans (use these to determine which areas need clearing and which trees/areas should remain):" },
        ...planBlocks,
        { type: "text", text: `Compare the satellite image against the construction plans to identify: (1) which areas must be cleared, (2) which trees/vegetation should be preserved, (3) approximate clearing boundaries. Count trees in the areas to be cleared only.\n\n${userMessage}` },
      ];
    } else if (aerialImageBase64) {
      // Satellite only: tree count + density analysis
      landClearingContent = [
        { type: "image", source: { type: "base64", media_type: "image/png", data: aerialImageBase64 } },
        { type: "text", text: `Aerial satellite image of the parcel is attached above. Analyze it for tree count, species, and density as instructed.\n\n${userMessage}` },
      ];
    } else {
      landClearingContent = userMessage;
    }

    const stream = client.messages.stream({
      model: "claude-opus-4-8",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: LAND_CLEARING_PROMPT,
      messages: [{ role: "user", content: landClearingContent }],
      output_config: { format: zodOutputFormat(QuoteSchema) },
    });
    const message = await stream.finalMessage();

    if (!message.parsed_output) {
      console.error("Quote parse failure (land_clearing):", message.stop_reason, JSON.stringify(message.content).slice(0, 2000));
      throw new QuoteGenerationError("Failed to generate quote", 500);
    }
    setCachedQuote(cacheKey, message.parsed_output);
    const saved = await saveEstimateRecord({
      quote: message.parsed_output,
      fromCache: false,
      serviceType,
      county,
      state,
      zipCode,
      address,
      parcelId,
      ownerName,
      zoning,
      acreage,
      contactName,
      contactPhone,
      contactEmail,
      additionalNotes,
      trades,
      serviceTypes: serviceDetails?.serviceTypes,
      files: serviceDetails?.clearingPlanFiles,
      mapBbox,
      parcelRings,
      source,
      estMeta,
    });
    return { quote: message.parsed_output, estimateId: saved?.id ?? null, estMeta };
  } catch (err) {
    if (err instanceof QuoteGenerationError) throw err;
    console.error("Quote generation error:", err);
    throw new QuoteGenerationError("Internal error", 500);
  }
}

export type ReviseQuoteParams = {
  currentQuote: QuoteResult;
  instructions: string;
  serviceType: "land_clearing" | "upload_plans";
  trades?: string[] | null;
  serviceTypes?: string[] | null;
  county: string;
  state: string;
  zipCode?: string | null;
};

// Applies an admin's plain-English correction to an already-generated quote
// (e.g. "stump count should be 15 not 25, adjust that line and the total")
// without re-running the full takeoff from scratch. No caching — every
// correction is a fresh, deliberate edit.
export async function reviseQuote(params: ReviseQuoteParams): Promise<QuoteResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new QuoteGenerationError("Server misconfiguration", 500);
  }
  if (!params.instructions.trim()) {
    throw new QuoteGenerationError("Correction instructions are required", 400);
  }

  const trades = params.trades ?? params.serviceTypes ?? [];
  const includesClearing =
    params.serviceType === "land_clearing" ||
    trades.some((t) => t === "Complete Land Clearing" || t === "Partial Land / Underbrush Clearing");
  const includesPlans = params.serviceType === "upload_plans";
  const wantsCompleteBuild = trades.includes("Complete Home Build");
  // reviseQuote is only ever reachable via the admin-only revise route, so
  // no source check needed here — just gate on the service actually being
  // Complete Home Build, same as generateQuote's admin_free check above.
  const system = [
    includesPlans ? PLANS_PROMPT : null,
    includesClearing ? LAND_CLEARING_PROMPT : null,
    wantsCompleteBuild ? EPIC_SHELL_RATES_ADDENDUM : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const userMessage = [
    `County: ${params.county}, ${params.state}${params.zipCode ? ` (${params.zipCode})` : ""}`,
    "Here is the current estimate as JSON:",
    JSON.stringify(params.currentQuote),
    "",
    "An admin has reviewed this estimate and requested the following correction(s). Apply them precisely, recompute subtotal/total and any other dependent fields, and keep everything else unchanged unless the correction requires it. Follow the same pricing rules and catalogs as the original estimate.",
    "ADMIN CORRECTION:",
    params.instructions.trim(),
    "",
    "Return the complete corrected estimate.",
  ].join("\n");

  try {
    const stream = client.messages.stream({
      model: "claude-opus-4-8",
      max_tokens: 28000,
      thinking: { type: "adaptive" },
      system,
      messages: [{ role: "user", content: userMessage }],
      output_config: { format: zodOutputFormat(QuoteSchema) },
    });
    const message = await stream.finalMessage();

    if (!message.parsed_output) {
      console.error("Quote revision parse failure:", message.stop_reason, JSON.stringify(message.content).slice(0, 2000));
      throw new QuoteGenerationError("Failed to apply correction", 500);
    }
    return message.parsed_output;
  } catch (err) {
    if (err instanceof QuoteGenerationError) throw err;
    console.error("Quote revision error:", err);
    throw new QuoteGenerationError("Internal error", 500);
  }
}
