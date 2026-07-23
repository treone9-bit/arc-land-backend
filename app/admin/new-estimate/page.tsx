"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { clientAuth } from "../../../lib/firebaseClient";
import type { GeocodeResult } from "../../api/geocode/route";
import type { QuoteResult } from "../../../lib/quoteGeneration";
import ServiceDetailsSection, { type ServiceData } from "../../ServiceDetailsSection";
import adminStyles from "../admin.module.css";
import styles from "../../page.module.css";

type LookupMethod = "address" | "parcel_id";
type Bbox = { minLng: number; maxLng: number; minLat: number; maxLat: number };

async function parseJsonResponse<T = unknown>(res: Response): Promise<T> {
  try {
    return await res.json();
  } catch {
    throw new Error(
      res.ok
        ? "The server returned an unexpected response. Please try again."
        : `Request failed (${res.status}). Please try again in a moment.`
    );
  }
}

function computeBbox(rings: number[][][] | null, centerLat: number, centerLng: number): Bbox {
  if (rings?.length) {
    const pts = rings.flat();
    const lngs = pts.map((p) => p[0]);
    const lats = pts.map((p) => p[1]);
    const minLng0 = Math.min(...lngs), maxLng0 = Math.max(...lngs);
    const minLat0 = Math.min(...lats), maxLat0 = Math.max(...lats);
    const lngSpan = Math.max(maxLng0 - minLng0, 0.001);
    const latSpan = Math.max(maxLat0 - minLat0, 0.0008);
    const p = 0.2;
    return { minLng: minLng0 - lngSpan * p, maxLng: maxLng0 + lngSpan * p,
             minLat: minLat0 - latSpan * p, maxLat: maxLat0 + latSpan * p };
  }
  return { minLng: centerLng - 0.0024, maxLng: centerLng + 0.0024,
           minLat: centerLat - 0.0018, maxLat: centerLat + 0.0018 };
}

export default function AdminNewEstimatePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  const [lookupMethod, setLookupMethod] = useState<LookupMethod>("address");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("FL");
  const [zip, setZip] = useState("");
  const [parcelIdInput, setParcelIdInput] = useState("");
  const [countyInput, setCountyInput] = useState("");

  const [resolved, setResolved] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [geo, setGeo] = useState<GeocodeResult | null>(null);
  const [parcelRings, setParcelRings] = useState<number[][][] | null>(null);
  const [mapBbox, setMapBbox] = useState<Bbox | null>(null);
  const [resolvedCounty, setResolvedCounty] = useState("");
  const [resolvedZip, setResolvedZip] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [acreage, setAcreage] = useState("");
  const [zoning, setZoning] = useState("");
  const [resolvedParcelId, setResolvedParcelId] = useState("");

  const [serviceData, setServiceData] = useState<ServiceData | null>(null);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");

  const [errorMsg, setErrorMsg] = useState("");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(clientAuth, (u) => {
      setUser(u);
      setChecking(false);
      if (!u) router.push("/admin/login");
    });
    return unsub;
  }, [router]);

  async function lookupParcel(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg("");
    setLookingUp(true);
    try {
      let lat: number | null = null;
      let lng: number | null = null;
      let county = "";

      if (lookupMethod === "address") {
        const geoRes = await fetch("/api/geocode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: street, city, state: stateCode, zip }),
        });
        const geoData: GeocodeResult & { error?: string } = await geoRes.json();
        if (!geoRes.ok) throw new Error(geoData.error ?? "Geocoding failed");
        setGeo(geoData);
        lat = geoData.lat;
        lng = geoData.lng;
        county = geoData.county ?? "";
        setResolvedCounty(county);

        const parcelRes = await fetch("/api/parcel-lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat, lng, county, state: geoData.state ?? stateCode }),
        });
        const parcelData = await parcelRes.json();
        if (!parcelRes.ok && !(parcelRes.status === 422 && parcelData.fallback)) {
          throw new Error(parcelData.error ?? "Parcel lookup failed");
        }
        if (parcelRes.ok) {
          setOwnerName(parcelData.ownerName ?? "");
          setAcreage(parcelData.acreage != null ? String(parcelData.acreage) : "");
          setZoning(parcelData.zoning ?? "");
          setResolvedParcelId(parcelData.parcelId ?? "");
          const cLat = parcelData.lat ?? lat!;
          const cLng = parcelData.lng ?? lng!;
          setParcelRings(parcelData.rings ?? null);
          setMapBbox(computeBbox(parcelData.rings ?? null, cLat, cLng));
        }
        setResolvedZip(zip);
      } else {
        county = countyInput;
        setResolvedCounty(county);

        const parcelRes = await fetch("/api/parcel-lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parcelId: parcelIdInput, county, state: stateCode }),
        });
        const parcelData = await parcelRes.json();
        if (!parcelRes.ok && !(parcelRes.status === 422 && parcelData.fallback)) {
          throw new Error(parcelData.error ?? "Parcel lookup failed");
        }
        if (parcelRes.ok) {
          setOwnerName(parcelData.ownerName ?? "");
          setAcreage(parcelData.acreage != null ? String(parcelData.acreage) : "");
          setZoning(parcelData.zoning ?? "");
          setResolvedParcelId(parcelData.parcelId ?? parcelIdInput);
          const cLat = parcelData.lat ?? null;
          const cLng = parcelData.lng ?? null;
          setParcelRings(parcelData.rings ?? null);
          setMapBbox(cLat != null && cLng != null ? computeBbox(parcelData.rings ?? null, cLat, cLng) : null);
        }
      }
      setResolved(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLookingUp(false);
    }
  }

  async function generateFreeEstimate(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;

    const selectedServices = serviceData?.serviceTypes ?? [];
    const hasPlans = (serviceData?.planFiles.length ?? 0) > 0;
    const hasScopeOfWork = (serviceData?.scopeOfWork?.trim().length ?? 0) > 0;
    const hasPlansOrScope = hasPlans || hasScopeOfWork;
    const hasNonClearing = selectedServices.some(
      (s) => s !== "Partial Land / Underbrush Clearing" && s !== "Complete Land Clearing"
    );
    const customSqFt = serviceData?.customClearingPolygon?.sqFt;
    const customAcres = customSqFt != null ? customSqFt / 43560 : null;
    const parcelAcres = acreage ? parseFloat(acreage) : null;
    const effectiveAcres = customAcres ?? parcelAcres;

    if (hasNonClearing && !hasPlansOrScope) {
      setErrorMsg("Please upload construction plans or describe the scope of work for the selected services.");
      return;
    }
    if (!hasPlansOrScope && !effectiveAcres) {
      setErrorMsg("Acreage is required. Draw a clearing area on the map or look up a parcel with acreage data.");
      return;
    }

    setErrorMsg("");
    setGenerating(true);

    try {
      const contactInfo = {
        contactName: contactName || undefined,
        contactPhone: contactPhone || undefined,
        contactEmail: contactEmail || undefined,
      };
      const sharedFields = {
        mapBbox: mapBbox ?? undefined,
        parcelRings: parcelRings ?? undefined,
        zipCode: resolvedZip || undefined,
        address: geo?.formattedAddress ?? (resolvedParcelId ? `Parcel ${resolvedParcelId}` : undefined),
        additionalNotes: additionalNotes.trim() || undefined,
        ...contactInfo,
      };

      let body: Record<string, unknown>;
      if (hasPlansOrScope) {
        const trades = selectedServices.length > 0 ? selectedServices : ["General Site Work"];
        body = {
          serviceType: "upload_plans",
          county: geo?.county ?? resolvedCounty,
          state: geo?.state ?? stateCode,
          acreage: effectiveAcres ?? undefined,
          trades,
          files: serviceData!.planFiles.map((f) => ({ path: f.path, type: f.type })),
          serviceDetails: serviceData,
          ...sharedFields,
        };
      } else {
        body = {
          serviceType: "land_clearing",
          acreage: effectiveAcres!,
          parcelAcreage: customAcres != null && parcelAcres != null ? parcelAcres : undefined,
          county: geo?.county ?? resolvedCounty,
          state: geo?.state ?? stateCode,
          parcelId: resolvedParcelId || undefined,
          ownerName: ownerName || undefined,
          zoning: zoning || undefined,
          serviceDetails: serviceData ?? undefined,
          ...sharedFields,
        };
      }

      const token = await user.getIdToken();
      const res = await fetch("/api/admin/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await parseJsonResponse<{ quote?: QuoteResult; estimateId?: string | null; error?: string }>(res);
      if (!res.ok) throw new Error(data.error ?? "Failed to generate estimate");

      if (data.estimateId) {
        router.push(`/admin/${data.estimateId}`);
      } else {
        setErrorMsg("Estimate generated but couldn't be saved — check Firebase configuration.");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setGenerating(false);
    }
  }

  if (checking || !user) return null;

  return (
    <div className={adminStyles.page}>
      <div className={adminStyles.container}>
        <span className={adminStyles.backLink} onClick={() => router.push("/admin")}>
          ← Back to Estimates
        </span>

        <div className={adminStyles.header}>
          <div className={adminStyles.title}>Create Free Estimate</div>
        </div>

        {!resolved && (
          <form className={adminStyles.card} style={{ padding: "1.5rem" }} onSubmit={lookupParcel}>
            <div className={styles.field}>
              <label>Lookup Method</label>
              <select value={lookupMethod} onChange={(e) => setLookupMethod(e.target.value as LookupMethod)}>
                <option value="address">Address</option>
                <option value="parcel_id">Parcel ID</option>
              </select>
            </div>

            {lookupMethod === "address" ? (
              <>
                <div className={styles.field}>
                  <label>Street Address</label>
                  <input required value={street} onChange={(e) => setStreet(e.target.value)} placeholder="123 Pine Ridge Rd" />
                </div>
                <div className={styles.row}>
                  <div className={styles.field} style={{ flex: 2 }}>
                    <label>City</label>
                    <input required value={city} onChange={(e) => setCity(e.target.value)} placeholder="Gainesville" />
                  </div>
                  <div className={styles.field} style={{ flex: 1 }}>
                    <label>State</label>
                    <select value={stateCode} onChange={(e) => setStateCode(e.target.value)}>
                      <option value="FL">FL</option>
                      <option value="GA">GA</option>
                    </select>
                  </div>
                  <div className={styles.field} style={{ flex: 1 }}>
                    <label>ZIP</label>
                    <input required value={zip} onChange={(e) => setZip(e.target.value)} placeholder="32601" maxLength={10} />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className={styles.field}>
                  <label>Parcel ID</label>
                  <input required value={parcelIdInput} onChange={(e) => setParcelIdInput(e.target.value)} placeholder="e.g. 01234-567-890" />
                </div>
                <div className={styles.row}>
                  <div className={styles.field} style={{ flex: 2 }}>
                    <label>County</label>
                    <input required value={countyInput} onChange={(e) => setCountyInput(e.target.value)} placeholder="e.g. Alachua County" />
                  </div>
                  <div className={styles.field} style={{ flex: 1 }}>
                    <label>State</label>
                    <select value={stateCode} onChange={(e) => setStateCode(e.target.value)}>
                      <option value="FL">FL</option>
                      <option value="GA">GA</option>
                    </select>
                  </div>
                </div>
              </>
            )}

            {errorMsg && <p className={styles.error}>{errorMsg}</p>}
            <button type="submit" className={styles.btn} disabled={lookingUp}>
              {lookingUp ? "Looking up…" : "Look Up Parcel"}
            </button>
          </form>
        )}

        {resolved && (
          <>
            <div className={adminStyles.card} style={{ padding: "1.5rem", marginBottom: "1.25rem" }}>
              <h2 className={styles.cardTitle}>Property Information</h2>
              {geo && <p className={styles.address}>{geo.formattedAddress}</p>}
              {!geo && resolvedParcelId && (
                <p className={styles.address}>Parcel {resolvedParcelId} — {resolvedCounty}, {stateCode}</p>
              )}

              <div className={styles.propLayout}>
                <div className={styles.parcelGrid}>
                  <div>
                    <span className={styles.label}>Owner</span>
                    <span>{ownerName || "—"}</span>
                  </div>
                  <div>
                    <span className={styles.label}>Acreage</span>
                    <span>{acreage || "—"}</span>
                  </div>
                  <div>
                    <span className={styles.label}>Zoning / Land Use</span>
                    <span>{zoning || "—"}</span>
                  </div>
                  <div>
                    <span className={styles.label}>Parcel ID</span>
                    <span>{resolvedParcelId || "—"}</span>
                  </div>
                </div>
                {mapBbox && (
                  <div className={styles.mapContainer}>
                    <img
                      src={`/api/map-image?minLng=${mapBbox.minLng}&maxLng=${mapBbox.maxLng}&minLat=${mapBbox.minLat}&maxLat=${mapBbox.maxLat}`}
                      alt="Aerial view of property"
                      className={styles.propMapImage}
                    />
                  </div>
                )}
              </div>
              <span className={adminStyles.backLink} onClick={() => setResolved(false)}>
                ← Look up a different property
              </span>
            </div>

            <form className={adminStyles.card} style={{ padding: "1.5rem" }} onSubmit={generateFreeEstimate}>
              <h2 className={styles.cardTitle}>Service Details</h2>
              <ServiceDetailsSection
                onChange={setServiceData}
                mapBbox={mapBbox ?? undefined}
                parcelRings={parcelRings ?? undefined}
              />

              <div className={styles.svcSection} style={{ borderTop: "1px solid #e5e7eb", paddingTop: "1.1rem", marginTop: 0 }}>
                <h3 className={styles.svcTitle}>Estimator Directions</h3>
                <div className={styles.field}>
                  <label>Direct how this estimate is built (optional)</label>
                  <textarea
                    placeholder={'e.g. "Use Epic Consulting Group rates for the foundation and shell", "Price the roof at $400/square instead of the standard rate", "Skip grading, site is already level", "Use mono slab foundation, 2,400 sqft"'}
                    rows={4}
                    value={additionalNotes}
                    onChange={(e) => setAdditionalNotes(e.target.value)}
                  />
                  <p className={styles.hint} style={{ marginTop: 4 }}>
                    Read and applied before generation — pricing methodology, rate sources, quantities to assume, or
                    scope to include/exclude. You can still fine-tune the estimate afterward with &ldquo;Request a
                    Correction&rdquo; on the saved estimate&apos;s page.
                  </p>
                </div>
              </div>

              <div className={styles.svcSection} style={{ borderTop: "1px solid #e5e7eb", paddingTop: "1.1rem", marginTop: 0 }}>
                <h3 className={styles.svcTitle}>Contact Information (optional)</h3>
                <div className={styles.field}>
                  <label>Name</label>
                  <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Full name" />
                </div>
                <div className={styles.row}>
                  <div className={styles.field} style={{ flex: 1 }}>
                    <label>Phone</label>
                    <input type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="(555) 000-0000" />
                  </div>
                  <div className={styles.field} style={{ flex: 1 }}>
                    <label>Email</label>
                    <input
                      type="email"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value.trim())}
                      onInvalid={(e) => e.currentTarget.setCustomValidity("Please enter a valid email address.")}
                      onInput={(e) => e.currentTarget.setCustomValidity("")}
                      placeholder="you@example.com"
                    />
                  </div>
                </div>
              </div>

              {errorMsg && <p className={styles.error}>{errorMsg}</p>}

              <button type="submit" className={styles.btn} disabled={generating}>
                {generating ? "Generating…" : "Generate Free Estimate"}
              </button>
              {generating && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
                  <div className={styles.spinner} style={{ margin: 0 }} />
                  <p className={styles.loadingText} style={{ textAlign: "left", marginBottom: 0 }}>
                    Claude is building the estimate — this can take up to a minute…
                  </p>
                </div>
              )}
            </form>
          </>
        )}
      </div>
    </div>
  );
}
