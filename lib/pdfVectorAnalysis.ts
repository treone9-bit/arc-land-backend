import type { PDFPageProxy } from "pdfjs-dist";

// pdfjs-dist's "legacy" build is meant to self-polyfill browser-only APIs
// like DOMMatrix for older/non-browser JS environments, but that internal
// detection doesn't reliably hold up across every Node runtime (confirmed:
// this crashed with "DOMMatrix is not defined" on Vercel's serverless
// runtime at module-load time, despite working locally). Installing a
// minimal polyfill ourselves before the module ever loads sidesteps needing
// pdf.js's own detection to succeed. It's only ever touched for a benign
// module-scope singleton in code paths this module doesn't exercise (we
// only use getOperatorList/getTextContent/getOptionalContentConfig, all
// verified byte-exact against known geometry), so a minimal stub — enough
// to construct without throwing — is sufficient.
function installDomMatrixPolyfillIfMissing() {
  const g = globalThis as { DOMMatrix?: unknown };
  if (typeof g.DOMMatrix !== "undefined") return;
  class DOMMatrixPolyfill {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
    constructor(init?: number[] | string) {
      if (Array.isArray(init) && init.length >= 6) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init;
      }
    }
  }
  g.DOMMatrix = DOMMatrixPolyfill;
}

type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjsPromise: Promise<PdfjsModule> | null = null;
function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    installDomMatrixPolyfillIfMissing();
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjsPromise;
}

// Extracts real vector drawing geometry directly from a PDF's content stream,
// instead of relying purely on Claude's vision to eyeball line lengths and
// areas off the rendered image. Only useful for vector-native CAD exports —
// scanned plans and PDFs that draw linework via custom glyph-substitution
// fonts (a real, observed pattern in some drafting software's PDF export)
// have little or no real path data, so this degrades to returning null and
// the caller falls straight back to vision-only, exactly as before.
//
// Coordinates/lengths are in raw PDF point units (1/72"), NOT real-world
// feet — converting that requires reading the plan's printed scale or scale
// bar, which is still a semantic task left to Claude. This module's job is
// only to hand over precise, ungueseed numbers for it to calibrate against.

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function dist(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

// Cubic bezier length via 12-segment linear subdivision — plenty for
// architectural curves (arcs, fillets), not trying to be exact.
function bezierLength(p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number]): number {
  const steps = 12;
  let len = 0;
  let prev = p0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt ** 3 * p0[0] + 3 * mt ** 2 * t * p1[0] + 3 * mt * t ** 2 * p2[0] + t ** 3 * p3[0];
    const y = mt ** 3 * p0[1] + 3 * mt ** 2 * t * p1[1] + 3 * mt * t ** 2 * p2[1] + t ** 3 * p3[1];
    const cur: [number, number] = [x, y];
    len += dist(prev, cur);
    prev = cur;
  }
  return len;
}

function shoelaceArea(points: [number, number][]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

type SubpathResult = { length: number; area: number | null; points: number };

// Decodes one packed path buffer (indexed like {0: opcode, 1: x, 2: y, 3: opcode, ...})
// into subpath length/area, applying the current transform to every point.
function decodeSubpath(buf: Record<number, number>, ctm: Matrix): SubpathResult {
  const values: number[] = [];
  let i = 0;
  while (buf[i] !== undefined) values.push(buf[i++]);

  const points: [number, number][] = [];
  let length = 0;
  let cursor: [number, number] | null = null;
  let idx = 0;
  let closed = false;

  while (idx < values.length) {
    const op = values[idx++];
    if (op === OPS_MOVETO) {
      cursor = apply(ctm, values[idx], values[idx + 1]);
      idx += 2;
      points.push(cursor);
    } else if (op === OPS_LINETO) {
      const next = apply(ctm, values[idx], values[idx + 1]);
      idx += 2;
      if (cursor) length += dist(cursor, next);
      cursor = next;
      points.push(cursor);
    } else if (op === OPS_CURVETO) {
      const c1 = apply(ctm, values[idx], values[idx + 1]);
      const c2 = apply(ctm, values[idx + 2], values[idx + 3]);
      const end = apply(ctm, values[idx + 4], values[idx + 5]);
      idx += 6;
      if (cursor) length += bezierLength(cursor, c1, c2, end);
      cursor = end;
      points.push(cursor);
    } else if (op === OPS_CLOSEPATH) {
      closed = true;
      if (points.length > 0 && cursor) length += dist(cursor, points[0]);
      cursor = points[0] ?? null;
    } else {
      // Unrecognized opcode — bail out on this subpath rather than risk
      // misreading the rest of the buffer.
      break;
    }
  }

  const area = closed && points.length >= 3 ? shoelaceArea(points) : null;
  return { length, area, points: points.length };
}

// PathOps sub-opcodes used inside a packed constructPath buffer — distinct
// from the top-level OPS enum used in fnArray.
const OPS_MOVETO = 0;
const OPS_LINETO = 1;
const OPS_CURVETO = 2;
const OPS_CLOSEPATH = 4;

export type PdfPageVectorSummary = {
  pageNumber: number;
  isVectorRich: boolean;
  totalOps: number;
  subpathCount: number;
  // Deduplicated {value, count} pairs, descending by value — repeated
  // identical lengths/areas are almost always a border, grid, or hatch
  // pattern rather than distinct measurements, so counting occurrences
  // instead of listing every repeat surfaces the actually-varied content.
  significantLengths: { value: number; count: number }[];
  significantAreas: { value: number; count: number }[];
  ocgLayerNames: string[];
  extractedText: string;
  textReadableRatio: number;
};

function dedupeWithCounts(values: number[]): { value: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.value - a.value);
}

export type PdfVectorSummary = {
  fileName: string;
  pages: PdfPageVectorSummary[];
};

const MAX_REPORTED_PER_PAGE = 40;
const MIN_SIGNIFICANT_LENGTH = 5; // filter out tiny hatch/texture noise, in pt units

async function analyzePage(
  page: PDFPageProxy,
  pageNumber: number,
  ocgLayerNames: string[],
  OPS: PdfjsModule["OPS"]
): Promise<PdfPageVectorSummary> {
  const opList = await page.getOperatorList();
  const textContent = await page.getTextContent();
  const fullText = textContent.items.map((t) => ("str" in t ? t.str : "")).join(" ");
  const readableChars = (fullText.match(/[a-zA-Z0-9]/g) ?? []).length;
  const textReadableRatio = fullText.length ? readableChars / fullText.length : 0;

  const ctmStack: Matrix[] = [];
  let ctm: Matrix = IDENTITY;
  const lengths: number[] = [];
  const areas: number[] = [];
  let subpathCount = 0;

  const { fnArray, argsArray } = opList;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    if (fn === OPS.save) {
      ctmStack.push(ctm);
    } else if (fn === OPS.restore) {
      ctm = ctmStack.pop() ?? IDENTITY;
    } else if (fn === OPS.transform) {
      const [a, b, c, d, e, f] = argsArray[i] as Matrix;
      ctm = multiply(ctm, [a, b, c, d, e, f]);
    } else if (fn === OPS.constructPath) {
      const subpaths = argsArray[i]?.[1] as Record<number, number>[] | undefined;
      if (!Array.isArray(subpaths)) continue;
      for (const buf of subpaths) {
        subpathCount++;
        const { length, area } = decodeSubpath(buf, ctm);
        if (length >= MIN_SIGNIFICANT_LENGTH) lengths.push(Math.round(length * 100) / 100);
        if (area && area >= MIN_SIGNIFICANT_LENGTH ** 2) areas.push(Math.round(area));
      }
    }
  }

  // Vector-richness heuristic, cross-validated against real plan sets: a
  // page with substantial real path data and/or cleanly readable text is
  // vector-native; low path counts combined with garbled text indicate
  // glyph-substituted linework (a real pattern seen in some CAD export
  // pipelines) where this data isn't trustworthy.
  const isVectorRich = subpathCount > 200 || (subpathCount > 20 && textReadableRatio > 0.4);

  return {
    pageNumber,
    isVectorRich,
    totalOps: fnArray.length,
    subpathCount,
    significantLengths: dedupeWithCounts(lengths).slice(0, MAX_REPORTED_PER_PAGE),
    significantAreas: dedupeWithCounts(areas).slice(0, MAX_REPORTED_PER_PAGE),
    ocgLayerNames: Array.from(new Set(ocgLayerNames)),
    extractedText: fullText.trim().slice(0, 4000),
    textReadableRatio,
  };
}

export async function analyzePdfVectorContent(buffer: Buffer, fileName: string): Promise<PdfVectorSummary | null> {
  try {
    const { getDocument, OPS } = await loadPdfjs();
    const data = new Uint8Array(buffer);
    const doc = await getDocument({ data, useSystemFonts: true }).promise;

    let ocgLayerNames: string[] = [];
    try {
      const ocgConfig = await doc.getOptionalContentConfig();
      const order = ocgConfig?.getOrder();
      if (order) {
        ocgLayerNames = order
          .filter((id: unknown): id is string => typeof id === "string")
          .map((id: string) => ocgConfig.getGroup(id)?.name)
          .filter((name: unknown): name is string => typeof name === "string");
      }
    } catch {
      // Optional content is a bonus signal — never let it break analysis.
    }

    const pages: PdfPageVectorSummary[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      pages.push(await analyzePage(page, i, Array.from(new Set(ocgLayerNames)), OPS));
    }

    if (!pages.some((p) => p.isVectorRich)) return null;
    return { fileName, pages };
  } catch (err) {
    console.error(`PDF vector analysis failed for ${fileName}:`, err);
    return null;
  }
}

// Formats a summary into a compact text block to append to the Claude
// prompt as grounding data alongside the visual plan — never a replacement
// for it, since scale calibration and semantic interpretation still need
// vision + reasoning.
export function formatVectorSummaryForPrompt(summary: PdfVectorSummary): string {
  const lines: string[] = [
    `AUTOMATED VECTOR ANALYSIS for "${summary.fileName}" (extracted directly from the PDF's underlying drawing data — these are exact figures in the PDF's own coordinate units (points, 1/72"), NOT yet converted to real-world feet/inches. Cross-reference against the plan's printed scale or scale bar to convert. Use these to sanity-check or refine your own visual measurements of the same sheet, not as a blind substitute for reading the plan.):`,
  ];
  for (const page of summary.pages) {
    if (!page.isVectorRich) {
      lines.push(`- Sheet ${page.pageNumber}: not enough reliable vector data on this sheet (likely scanned or uses non-standard font-drawn linework) — rely on visual reading only.`);
      continue;
    }
    lines.push(`- Sheet ${page.pageNumber}: ${page.subpathCount} distinct vector paths detected.`);
    if (page.ocgLayerNames.length) {
      lines.push(`  CAD layers present: ${page.ocgLayerNames.join(", ")}`);
    }
    if (page.significantLengths.length) {
      const formatted = page.significantLengths
        .slice(0, 20)
        .map(({ value, count }) => (count > 1 ? `${value} (×${count})` : `${value}`));
      lines.push(`  Distinct line/path lengths, largest first (pt units; ×N = repeated N times, likely a border/grid/hatch rather than N separate measurements): ${formatted.join(", ")}`);
    }
    if (page.significantAreas.length) {
      const formatted = page.significantAreas
        .slice(0, 10)
        .map(({ value, count }) => (count > 1 ? `${value} (×${count})` : `${value}`));
      lines.push(`  Distinct enclosed areas, largest first (pt² units): ${formatted.join(", ")}`);
    }
  }
  return lines.join("\n");
}
