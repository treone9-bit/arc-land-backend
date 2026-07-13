"use client";

import { useState } from "react";
import styles from "./page.module.css";

const SERVICE_TYPES = [
  "Partial Land / Underbrush Clearing",
  "Complete Land Clearing",
  "Grading",
  "Excavation",
  "Underground Plumbing",
  "Septic",
  "Foundation",
  "Complete Home Build",
];

const PARTIAL = "Partial Land / Underbrush Clearing";
const COMPLETE = "Complete Land Clearing";

const CLEARING_ONLY = new Set([PARTIAL, COMPLETE]);

const VEGETATION_OPTIONS = [
  "Light",
  "Medium",
  "Heavy",
  "No vegetation",
];

const SVG_W = 900;
const SVG_H = 675; // 4:3

type Bbox = { minLng: number; maxLng: number; minLat: number; maxLat: number };

function shoelaceArea(pts: [number, number][]): number {
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

function lngLatToSqFt(lngLat: [number, number][], midLat: number): number {
  const latM = 111320;
  const lngM = 111320 * Math.cos((midLat * Math.PI) / 180);
  return shoelaceArea(lngLat) * latM * lngM * 10.7639;
}

export type PlanFile = { path: string; type: string; name: string };

export type ServiceData = {
  serviceTypes: string[];
  clearingArea: string;
  vegetationType: string;
  drainageIssues: boolean;
  easements: boolean;
  existingStructures: boolean;
  accessRoad: string;
  debrisHandling: string;
  startDate: string;
  urgency: string;
  permitsStatus: string;
  largerProject: boolean;
  planFiles: PlanFile[];
  clearingPlanFiles: PlanFile[];
  scopeOfWork: string;
  customClearingPolygon?: { lngLat: [number, number][]; sqFt: number };
};

// Uploads go straight from the browser to Storage via a signed URL — Vercel
// caps API request bodies at 4.5MB, which a single base64-encoded plan file
// can exceed on its own, so the file bytes never pass through our own API.
async function uploadFile(file: File): Promise<PlanFile> {
  const urlRes = await fetch("/api/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType: file.type }),
  });
  if (!urlRes.ok) throw new Error(`Failed to prepare upload for "${file.name}"`);
  const { url, path } = await urlRes.json();

  const putRes = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!putRes.ok) throw new Error(`Failed to upload "${file.name}"`);

  return { path, type: file.type, name: file.name };
}

type Props = {
  onChange?: (data: ServiceData) => void;
  mapBbox?: Bbox;
  parcelRings?: number[][][];
};

export default function ServiceDetailsSection({ onChange, mapBbox, parcelRings }: Props) {
  const [data, setData] = useState<ServiceData>({
    serviceTypes: [],
    clearingArea: "Entire Parcel",
    vegetationType: "Light",
    drainageIssues: false,
    easements: false,
    existingStructures: false,
    accessRoad: "",
    debrisHandling: "",
    startDate: "",
    urgency: "Flexible",
    permitsStatus: "",
    largerProject: false,
    planFiles: [],
    clearingPlanFiles: [],
    scopeOfWork: "",
  });

  const [planFileError, setPlanFileError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([]);
  const [drawClosed, setDrawClosed] = useState(false);

  const hasNonClearing = data.serviceTypes.some((s) => !CLEARING_ONLY.has(s));
  const hasComplete = data.serviceTypes.includes(COMPLETE);
  const isCustomArea = data.clearingArea === "Partial / Custom Area";
  const isPlanArea = data.clearingArea === "Per Construction Plans";

  function emit(next: ServiceData) {
    setData(next);
    onChange?.(next);
  }

  function update<K extends keyof ServiceData>(field: K, value: ServiceData[K]) {
    emit({ ...data, [field]: value });
  }

  function handleClearingAreaChange(value: string) {
    setDrawPoints([]);
    setDrawClosed(false);
    emit({
      ...data,
      clearingArea: value,
      customClearingPolygon: undefined,
    });
  }

  function toggleService(service: string) {
    const selected = data.serviceTypes;
    const isOn = selected.includes(service);

    let nextTypes: string[];
    if (isOn) {
      nextTypes = selected.filter((s) => s !== service);
    } else if (service === PARTIAL) {
      nextTypes = [PARTIAL];
    } else if (selected.includes(PARTIAL)) {
      return;
    } else if (service === COMPLETE) {
      nextTypes = [...selected, COMPLETE];
    } else {
      nextTypes = [...selected, service];
    }

    emit({ ...data, serviceTypes: nextTypes });
  }

  async function handlePlanFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    const oversized = files.find((f) => f.size > 4 * 1024 * 1024);
    if (oversized) {
      setPlanFileError(`"${oversized.name}" is over 4MB. Each file must be under 4MB.`);
      return;
    }
    setPlanFileError("");
    setUploading(true);
    try {
      const newFiles = await Promise.all(files.map(uploadFile));
      emit({ ...data, planFiles: [...data.planFiles, ...newFiles] });
    } catch (err) {
      setPlanFileError(err instanceof Error ? err.message : "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  function removePlanFile(index: number) {
    emit({ ...data, planFiles: data.planFiles.filter((_, i) => i !== index) });
  }

  async function handleClearingPlanFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    const oversized = files.find((f) => f.size > 4 * 1024 * 1024);
    if (oversized) {
      setPlanFileError(`"${oversized.name}" is over 4MB. Each file must be under 4MB.`);
      return;
    }
    setPlanFileError("");
    setUploading(true);
    try {
      const newFiles = await Promise.all(files.map(uploadFile));
      emit({ ...data, clearingPlanFiles: [...data.clearingPlanFiles, ...newFiles] });
    } catch (err) {
      setPlanFileError(err instanceof Error ? err.message : "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  function removeClearingPlanFile(index: number) {
    emit({ ...data, clearingPlanFiles: data.clearingPlanFiles.filter((_, i) => i !== index) });
  }

  function handleMapClick(e: React.MouseEvent<SVGSVGElement>) {
    if (drawClosed || !mapBbox) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * SVG_W;
    const y = ((e.clientY - rect.top) / rect.height) * SVG_H;

    if (drawPoints.length >= 3) {
      const [fx, fy] = drawPoints[0];
      if (Math.hypot(x - fx, y - fy) < 20) {
        finishDrawing(drawPoints);
        return;
      }
    }
    setDrawPoints((prev) => [...prev, [x, y]]);
  }

  function finishDrawing(pts: [number, number][]) {
    if (!mapBbox || pts.length < 3) return;
    setDrawClosed(true);
    const { minLng, maxLng, minLat, maxLat } = mapBbox;
    const lngLat = pts.map(([x, y]): [number, number] => [
      minLng + (x / SVG_W) * (maxLng - minLng),
      maxLat - (y / SVG_H) * (maxLat - minLat),
    ]);
    const midLat = (minLat + maxLat) / 2;
    const sqFt = lngLatToSqFt(lngLat, midLat);
    emit({ ...data, customClearingPolygon: { lngLat, sqFt } });
  }

  function resetDrawing() {
    setDrawPoints([]);
    setDrawClosed(false);
    emit({ ...data, customClearingPolygon: undefined });
  }

  const mapImageUrl = mapBbox
    ? `/api/map-image?minLng=${mapBbox.minLng}&maxLng=${mapBbox.maxLng}&minLat=${mapBbox.minLat}&maxLat=${mapBbox.maxLat}`
    : null;

  const toSvgX = (lng: number) =>
    mapBbox ? ((lng - mapBbox.minLng) / (mapBbox.maxLng - mapBbox.minLng)) * SVG_W : 0;
  const toSvgY = (lat: number) =>
    mapBbox ? ((mapBbox.maxLat - lat) / (mapBbox.maxLat - mapBbox.minLat)) * SVG_H : 0;

  return (
    <div className={styles.svcDetails}>

      <div className={styles.svcSection}>
        <h3 className={styles.svcTitle}>Scope of Work</h3>

        <div className={styles.field}>
          <label>Services Needed</label>
          <div className={styles.checkboxGroup}>
            {SERVICE_TYPES.map((s) => {
              const hasPartial = data.serviceTypes.includes(PARTIAL);
              const blocked = s !== PARTIAL && hasPartial;
              return (
                <label
                  key={s}
                  className={`${styles.checkboxLabel} ${blocked ? styles.checkboxDisabled : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={data.serviceTypes.includes(s)}
                    onChange={() => toggleService(s)}
                    disabled={blocked}
                  />
                  {s}
                </label>
              );
            })}
          </div>
        </div>

        <div className={styles.field}>
          <label>Area to Clear</label>
          <select
            value={data.clearingArea}
            onChange={(e) => handleClearingAreaChange(e.target.value)}
          >
            <option>Entire Parcel</option>
            <option>Partial / Custom Area</option>
            {hasComplete && <option>Per Construction Plans</option>}
          </select>
        </div>

        {/* ── Plans define clearing area ────────────────── */}
        {isPlanArea && (
          <div className={styles.field} style={{ marginBottom: "1rem" }}>
            <label>
              Upload Construction Plans{" "}
              <span className={styles.hint}>(PDF or image, max 4MB each — required, multiple allowed)</span>
            </label>
            <label className={styles.fileLabel}>
              <input
                type="file"
                accept=".pdf,image/png,image/jpeg,image/webp"
                multiple
                onChange={handleClearingPlanFile}
                className={styles.fileInput}
                disabled={uploading}
              />
              <span className={styles.fileBtn}>{uploading ? "Uploading…" : "Choose Files"}</span>
              <span className={styles.fileName}>
                {data.clearingPlanFiles.length > 0
                  ? `${data.clearingPlanFiles.length} file(s) selected`
                  : "No file chosen"}
              </span>
            </label>
            {data.clearingPlanFiles.length > 0 && (
              <>
                <ul className={styles.fileList}>
                  {data.clearingPlanFiles.map((f, i) => (
                    <li key={i} className={styles.fileListItem}>
                      <span className={styles.fileName}>{f.name}</span>
                      <button
                        type="button"
                        className={styles.fileRemoveBtn}
                        onClick={() => removeClearingPlanFile(i)}
                        aria-label={`Remove ${f.name}`}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
                <p style={{ fontSize: "0.82rem", color: "#2563eb", marginTop: 4 }}>
                  Plans uploaded — Claude will compare against the satellite image to identify clearing scope.
                </p>
              </>
            )}
            {planFileError && (
              <p className={styles.error} style={{ marginTop: 6, marginBottom: 0 }}>{planFileError}</p>
            )}
          </div>
        )}

        {/* ── Custom area drawing ───────────────────────── */}
        {isCustomArea && (
          <div className={styles.drawingSection}>
            <div className={styles.drawingToolbar}>
              <span className={styles.drawingHint}>
                {drawClosed
                  ? "Selection complete."
                  : drawPoints.length === 0
                  ? "Click on the map to start marking the clearing boundary."
                  : drawPoints.length < 3
                  ? "Keep clicking to add boundary points."
                  : "Click the orange point to close, or use the button."}
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                {!drawClosed && drawPoints.length >= 3 && (
                  <button
                    type="button"
                    className={styles.drawBtn}
                    onClick={() => finishDrawing(drawPoints)}
                  >
                    Close Selection
                  </button>
                )}
                {drawPoints.length > 0 && (
                  <button type="button" className={styles.drawBtn} onClick={resetDrawing}>
                    Clear
                  </button>
                )}
              </div>
            </div>

            {mapImageUrl ? (
              <div className={styles.drawingCanvas}>
                <svg
                  viewBox={`0 0 ${SVG_W} ${SVG_H}`}
                  style={{
                    display: "block",
                    width: "100%",
                    cursor: drawClosed ? "default" : "crosshair",
                  }}
                  onClick={handleMapClick}
                >
                  {/* Aerial image */}
                  <image
                    href={mapImageUrl}
                    x="0"
                    y="0"
                    width={SVG_W}
                    height={SVG_H}
                    preserveAspectRatio="xMidYMid slice"
                  />

                  {/* Parcel boundary */}
                  {parcelRings?.map((ring, i) => (
                    <polygon
                      key={i}
                      points={ring.map(([lng, lat]) => `${toSvgX(lng)},${toSvgY(lat)}`).join(" ")}
                      fill="rgba(255,200,0,0.1)"
                      stroke="#ff8800"
                      strokeWidth="2.5"
                      strokeLinejoin="round"
                    />
                  ))}

                  {/* Filled polygon when closed */}
                  {drawClosed && drawPoints.length >= 3 && (
                    <polygon
                      points={drawPoints.map(([x, y]) => `${x},${y}`).join(" ")}
                      fill="rgba(37,99,235,0.28)"
                      stroke="#2563eb"
                      strokeWidth="3"
                      strokeLinejoin="round"
                    />
                  )}

                  {/* Open polyline while drawing */}
                  {!drawClosed && drawPoints.length >= 2 && (
                    <polyline
                      points={drawPoints.map(([x, y]) => `${x},${y}`).join(" ")}
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth="3"
                      strokeLinejoin="round"
                    />
                  )}

                  {/* Dashed closing preview */}
                  {!drawClosed && drawPoints.length >= 3 && (
                    <line
                      x1={drawPoints[drawPoints.length - 1][0]}
                      y1={drawPoints[drawPoints.length - 1][1]}
                      x2={drawPoints[0][0]}
                      y2={drawPoints[0][1]}
                      stroke="#2563eb"
                      strokeWidth="2"
                      strokeDasharray="10,6"
                      opacity="0.55"
                    />
                  )}

                  {/* Vertex dots */}
                  {drawPoints.map(([x, y], i) => (
                    <circle
                      key={i}
                      cx={x}
                      cy={y}
                      r={i === 0 ? 9 : 5}
                      fill={i === 0 ? "#ff6600" : "#2563eb"}
                      stroke="white"
                      strokeWidth="2.5"
                    />
                  ))}
                </svg>
              </div>
            ) : (
              <p className={styles.drawingHint} style={{ marginTop: 8 }}>
                Map not available — look up by address to enable drawing.
              </p>
            )}

            {drawClosed && data.customClearingPolygon && (() => {
              const { sqFt } = data.customClearingPolygon;
              const acres = sqFt / 43560;
              const display = acres >= 1
                ? `${acres.toFixed(2)} acres`
                : `${Math.round(sqFt).toLocaleString()} sq ft`;
              return (
                <div className={styles.areaResult}>
                  Selected clearing area: <strong>{display}</strong>
                </div>
              );
            })()}
          </div>
        )}

        <div className={styles.field}>
          <label>
            Construction Plans{" "}
            <span className={styles.hint}>(PDF or image, max 4MB each — optional, multiple allowed)</span>
          </label>
          <label className={styles.fileLabel}>
            <input
              type="file"
              accept=".pdf,image/png,image/jpeg,image/webp"
              multiple
              onChange={handlePlanFile}
              className={styles.fileInput}
              disabled={uploading}
            />
            <span className={styles.fileBtn}>{uploading ? "Uploading…" : "Choose Files"}</span>
            <span className={styles.fileName}>
              {data.planFiles.length > 0 ? `${data.planFiles.length} file(s) selected` : "No file chosen"}
            </span>
          </label>
          {data.planFiles.length > 0 && (
            <ul className={styles.fileList}>
              {data.planFiles.map((f, i) => (
                <li key={i} className={styles.fileListItem}>
                  <span className={styles.fileName}>{f.name}</span>
                  <button
                    type="button"
                    className={styles.fileRemoveBtn}
                    onClick={() => removePlanFile(i)}
                    aria-label={`Remove ${f.name}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {planFileError && (
            <p className={styles.error} style={{ marginTop: 6, marginBottom: 0 }}>
              {planFileError}
            </p>
          )}
        </div>

        {hasNonClearing && (
          <div className={styles.field}>
            <label>
              Scope of Work{" "}
              <span className={styles.hint}>
                {data.planFiles.length > 0
                  ? "(optional — add detail beyond what's on the plans)"
                  : "(required if no plans uploaded)"}
              </span>
            </label>
            <textarea
              placeholder="Please provide details of the scope of work needed — what's being built, dimensions, materials, quantities, or anything else that would help us price the job accurately."
              rows={5}
              value={data.scopeOfWork}
              onChange={(e) => update("scopeOfWork", e.target.value)}
            />
          </div>
        )}
      </div>

      <div className={styles.svcSection}>
        <h3 className={styles.svcTitle}>Site Conditions</h3>

        <div className={styles.field}>
          <label>Vegetation Density / Type</label>
          <select value={data.vegetationType} onChange={(e) => update("vegetationType", e.target.value)}>
            {VEGETATION_OPTIONS.map((v) => <option key={v}>{v}</option>)}
          </select>
        </div>

        <div className={styles.yesNoGroup}>
          <div className={styles.yesNoRow}>
            <span className={styles.yesNoLabel}>Slope, drainage issues, or wetlands present?</span>
            <label className={styles.radioLabel}>
              <input type="radio" checked={data.drainageIssues === true} onChange={() => update("drainageIssues", true)} /> Yes
            </label>
            <label className={styles.radioLabel}>
              <input type="radio" checked={data.drainageIssues === false} onChange={() => update("drainageIssues", false)} /> No
            </label>
          </div>
          <div className={styles.yesNoRow}>
            <span className={styles.yesNoLabel}>Easements or right-of-way on property?</span>
            <label className={styles.radioLabel}>
              <input type="radio" checked={data.easements === true} onChange={() => update("easements", true)} /> Yes
            </label>
            <label className={styles.radioLabel}>
              <input type="radio" checked={data.easements === false} onChange={() => update("easements", false)} /> No
            </label>
          </div>
          <div className={styles.yesNoRow}>
            <span className={styles.yesNoLabel}>Existing structures or debris to remove?</span>
            <label className={styles.radioLabel}>
              <input type="radio" checked={data.existingStructures === true} onChange={() => update("existingStructures", true)} /> Yes
            </label>
            <label className={styles.radioLabel}>
              <input type="radio" checked={data.existingStructures === false} onChange={() => update("existingStructures", false)} /> No
            </label>
          </div>
        </div>
      </div>

      <div className={styles.svcSection}>
        <h3 className={styles.svcTitle}>Access & Logistics</h3>

        <div className={styles.field}>
          <label>Access Road Condition</label>
          <select value={data.accessRoad} onChange={(e) => update("accessRoad", e.target.value)}>
            <option value="">Select…</option>
            <option>Paved</option>
            <option>Dirt/Gravel</option>
            <option>No formal access</option>
          </select>
        </div>

      </div>

      <div className={styles.svcSection}>
        <h3 className={styles.svcTitle}>Debris & Material Handling</h3>

        <div className={styles.field}>
          <label>Debris Handling</label>
          <select value={data.debrisHandling} onChange={(e) => update("debrisHandling", e.target.value)}>
            <option value="">Select…</option>
            <option>Haul off</option>
            <option>Burn on-site (permit required)</option>
            <option>Mulch / leave on property</option>
          </select>
        </div>
      </div>

      <div className={styles.svcSection}>
        <h3 className={styles.svcTitle}>Timeline & Compliance</h3>

        <div className={styles.row}>
          <div className={styles.field} style={{ flex: 1 }}>
            <label>Desired Start Date</label>
            <input type="date" value={data.startDate}
              onChange={(e) => update("startDate", e.target.value)} />
          </div>
          <div className={styles.field} style={{ flex: 1 }}>
            <label>Urgency</label>
            <select value={data.urgency} onChange={(e) => update("urgency", e.target.value)}>
              <option>Flexible</option>
              <option>Within 30 days</option>
              <option>ASAP</option>
            </select>
          </div>
        </div>

        <div className={styles.field}>
          <label>Permits Already Pulled?</label>
          <select value={data.permitsStatus} onChange={(e) => update("permitsStatus", e.target.value)}>
            <option value="">Select…</option>
            <option>Yes</option>
            <option>No — need help</option>
            <option>Not sure</option>
          </select>
        </div>

        <label className={styles.checkboxLabel} style={{ marginTop: 4 }}>
          <input type="checkbox" checked={data.largerProject}
            onChange={(e) => update("largerProject", e.target.checked)} />
          Part of a larger build project?
        </label>
      </div>

    </div>
  );
}
