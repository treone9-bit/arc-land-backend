"use client";

import { useState, useEffect } from "react";
import { pdf } from "@react-pdf/renderer";
import type { GeocodeResult } from "./api/geocode/route";
import type { ParcelResult } from "./api/parcel-lookup/route";
import type { EnvironmentalResult } from "./api/environmental/route";
import type { QuoteResult } from "../lib/quoteGeneration";
import ServiceDetailsSection, { type ServiceData } from "./ServiceDetailsSection";
import QuoteDocument from "./QuoteDocument";
import FeedbackWidget from "./FeedbackWidget";
import styles from "./page.module.css";

type Stage = "lookup" | "loading_parcel" | "job" | "loading_quote" | "done" | "error";
type LookupMethod = "address" | "parcel_id";

type Bbox = { minLng: number; maxLng: number; minLat: number; maxLat: number };

type CheckoutCompleteResponse = {
  error?: string;
  quote: QuoteResult;
  estMeta: { num: string; date: string };
  request: {
    contactName: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    address: string | null;
    county: string | null;
    state: string | null;
    parcelId: string | null;
    mapBbox: Bbox | null;
    parcelRings: number[][][] | null;
  };
};

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

function fmt(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

// A server crash (timeout, unhandled exception) returns an HTML error page
// instead of JSON — res.json() on that throws a cryptic parser error
// ("Unexpected token '<'" in most browsers, "The string did not match the
// expected pattern" in Safari/WebKit). Surface a message people can act on.
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

export default function Home() {
  const [stage, setStage] = useState<Stage>("lookup");
  const [errorMsg, setErrorMsg] = useState("");

  // Lookup method
  const [lookupMethod, setLookupMethod] = useState<LookupMethod>("address");

  // Address fields
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("FL");
  const [zip, setZip] = useState("");

  // Parcel ID fields
  const [parcelIdInput, setParcelIdInput] = useState("");
  const [countyInput, setCountyInput] = useState("");

  // Resolved property data
  const [geo, setGeo] = useState<GeocodeResult | null>(null);
  const [parcelRings, setParcelRings] = useState<number[][][] | null>(null);
  const [mapBbox, setMapBbox] = useState<{ minLng: number; maxLng: number; minLat: number; maxLat: number } | null>(null);
  const [resolvedCounty, setResolvedCounty] = useState("");
  const [resolvedZip, setResolvedZip] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [acreage, setAcreage] = useState("");
  const [zoning, setZoning] = useState("");
  const [resolvedParcelId, setResolvedParcelId] = useState("");

  // Environmental data
  const [env, setEnv] = useState<EnvironmentalResult | null>(null);

  // Service form
  const [serviceData, setServiceData] = useState<ServiceData | null>(null);

  // Contact info
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactEmailConfirm, setContactEmailConfirm] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");

  // Result
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [estMeta, setEstMeta] = useState<{ num: string; date: string } | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState<"checkout" | "generating" | null>(null);
  const [estimateRating, setEstimateRating] = useState<"up" | "down" | null>(null);
  const [estimateComment, setEstimateComment] = useState("");
  const [estimateFeedbackStatus, setEstimateFeedbackStatus] = useState<"idle" | "sending" | "sent">("idle");

  async function submitEstimateFeedback() {
    if (!estimateRating || !estMeta) return;
    setEstimateFeedbackStatus("sending");
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "estimate",
          rating: estimateRating,
          message: estimateComment.trim() || (estimateRating === "up" ? "Rated: helpful" : "Rated: not helpful"),
          estimateNum: estMeta.num,
        }),
      });
    } catch {
      // Best-effort — don't block the user on a feedback submission failure
    }
    setEstimateFeedbackStatus("sent");
  }

  // Resume after returning from Stripe Checkout (page reloads fresh, so this
  // reconstructs just enough state from the server to render the result).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("checkout_session_id");
    const pendingId = params.get("pending_id");
    const canceled = params.get("checkout_canceled");

    if (canceled) {
      setErrorMsg("Payment was canceled. Please fill out the form again to request a new estimate.");
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }

    if (!sessionId || !pendingId) return;

    setStage("loading_quote");
    setLoadingPhase("generating");

    fetch(`/api/checkout/complete?session_id=${encodeURIComponent(sessionId)}&pending_id=${encodeURIComponent(pendingId)}`)
      .then(async (res) => {
        const data = await parseJsonResponse<CheckoutCompleteResponse>(res);
        if (!res.ok) throw new Error(data.error ?? "Failed to retrieve your estimate");
        setQuote(data.quote);
        setEstMeta(data.estMeta);
        setContactName(data.request.contactName ?? "");
        setContactPhone(data.request.contactPhone ?? "");
        setContactEmail(data.request.contactEmail ?? "");
        setResolvedCounty(data.request.county ?? "");
        setResolvedParcelId(data.request.parcelId ?? "");
        setStateCode(data.request.state ?? "FL");
        setMapBbox(data.request.mapBbox ?? null);
        setParcelRings(data.request.parcelRings ?? null);
        setGeo({
          formattedAddress: data.request.address ?? "",
          lat: 0,
          lng: 0,
          county: data.request.county ?? null,
          state: data.request.state ?? null,
          placeId: "",
        });
        setStage("done");
      })
      .catch((err) => {
        setErrorMsg(err instanceof Error ? err.message : "Failed to retrieve your estimate");
        setStage("lookup");
      })
      .finally(() => {
        setLoadingPhase(null);
        window.history.replaceState({}, "", window.location.pathname);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function lookupParcel(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg("");
    setStage("loading_parcel");

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
        const parcelData: ParcelResult & { error?: string; fallback?: string } =
          await parcelRes.json();

        if (parcelRes.status === 422 && parcelData.fallback) {
          setErrorMsg(`${parcelData.error}. Look up manually: ${parcelData.fallback}`);
        } else if (!parcelRes.ok) {
          throw new Error(parcelData.error ?? "Parcel lookup failed");
        } else {
          setOwnerName(parcelData.ownerName ?? "");
          setAcreage(parcelData.acreage != null ? String(parcelData.acreage) : "");
          setZoning(parcelData.zoning ?? "");
          setResolvedParcelId(parcelData.parcelId ?? "");
          const cLat = parcelData.lat ?? lat!;
          const cLng = parcelData.lng ?? lng!;
          setParcelRings(parcelData.rings ?? null);
          setMapBbox(computeBbox(parcelData.rings ?? null, cLat, cLng));
        }

        const envRes = await fetch("/api/environmental", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat, lng }),
        });
        if (envRes.ok) setEnv(await envRes.json());
      } else {
        county = countyInput;
        setResolvedCounty(county);

        const parcelRes = await fetch("/api/parcel-lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parcelId: parcelIdInput, county, state: stateCode }),
        });
        const parcelData: ParcelResult & { error?: string; fallback?: string } =
          await parcelRes.json();

        if (parcelRes.status === 422 && parcelData.fallback) {
          setErrorMsg(`${parcelData.error}. Look up manually: ${parcelData.fallback}`);
        } else if (!parcelRes.ok) {
          throw new Error(parcelData.error ?? "Parcel lookup failed");
        } else {
          setOwnerName(parcelData.ownerName ?? "");
          setAcreage(parcelData.acreage != null ? String(parcelData.acreage) : "");
          setZoning(parcelData.zoning ?? "");
          setResolvedParcelId(parcelData.parcelId ?? parcelIdInput);
          const cLat = parcelData.lat ?? null;
          const cLng = parcelData.lng ?? null;
          setParcelRings(parcelData.rings ?? null);
          setMapBbox(cLat != null && cLng != null
            ? computeBbox(parcelData.rings ?? null, cLat, cLng)
            : null);
        }
        setEnv(null);
      }

      if (lookupMethod === "address") setResolvedZip(zip);
      setStage("job");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setStage("error");
    }
  }

  async function getQuote(e: React.FormEvent) {
    e.preventDefault();

    const selectedServices = serviceData?.serviceTypes ?? [];
    const hasPlans = (serviceData?.planFiles.length ?? 0) > 0;
    const hasScopeOfWork = (serviceData?.scopeOfWork?.trim().length ?? 0) > 0;
    const hasPlansOrScope = hasPlans || hasScopeOfWork;
    const hasClearingService = selectedServices.some(
      (s) => s === "Partial Land / Underbrush Clearing" || s === "Complete Land Clearing"
    );
    const hasNonClearing = selectedServices.some(
      (s) => s !== "Partial Land / Underbrush Clearing" && s !== "Complete Land Clearing"
    );

    if (hasClearingService && serviceData?.vegetationType === "No vegetation") {
      setErrorMsg("Land clearing requires vegetation. Please select a different vegetation type or remove the clearing service.");
      return;
    }

    if (hasNonClearing && !hasPlansOrScope) {
      setErrorMsg("Please upload construction plans or describe the scope of work for the selected services.");
      return;
    }

    // If user drew a custom clearing area, use its acreage; otherwise fall back to parcel acreage
    const customSqFt = serviceData?.customClearingPolygon?.sqFt;
    const customAcres = customSqFt != null ? customSqFt / 43560 : null;
    const parcelAcres = acreage ? parseFloat(acreage) : null;
    const effectiveAcres = customAcres ?? parcelAcres;

    if (!hasPlansOrScope && !effectiveAcres) {
      setErrorMsg("Acreage is required. Draw a clearing area on the map or look up a parcel with acreage data.");
      return;
    }

    if (contactEmail && contactEmail !== contactEmailConfirm) {
      setErrorMsg("Email addresses do not match.");
      return;
    }

    setErrorMsg("");
    setStage("loading_quote");

    try {
      let body: Record<string, unknown>;

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
          floodZone: env?.floodZone ?? undefined,
          sfha: env?.sfha ?? undefined,
          wetlandsOnSite: env?.wetlandsOnSite ?? undefined,
          wetlandType: env?.wetlandType ?? undefined,
          serviceDetails: serviceData ?? undefined,
          ...sharedFields,
        };
      }

      setLoadingPhase("checkout");
      const res = await fetch("/api/checkout/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await parseJsonResponse<{ url?: string; error?: string }>(res);
      if (!res.ok || !data.url) throw new Error(data.error ?? "Failed to start checkout");
      window.location.href = data.url;
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setStage("job");
      setLoadingPhase(null);
    }
  }

  async function downloadPdf() {
    if (!quote || !estMeta) return;
    setDownloadingPdf(true);
    try {
      const addressLine = geo?.formattedAddress ?? (resolvedParcelId ? `Parcel ${resolvedParcelId}` : "");
      const countyLine = resolvedCounty ? `${resolvedCounty}, ${geo?.state ?? stateCode}` : "";
      const blob = await pdf(
        <QuoteDocument
          quote={quote}
          estNum={estMeta.num}
          estDate={estMeta.date}
          contactName={contactName}
          contactPhone={contactPhone}
          contactEmail={contactEmail}
          addressLine={addressLine}
          countyLine={countyLine}
          logoUrl={`${window.location.origin}/arc-logo.png`}
          mapImageUrl={mapBbox ? `${window.location.origin}/api/map-image?minLng=${mapBbox.minLng}&maxLng=${mapBbox.maxLng}&minLat=${mapBbox.minLat}&maxLat=${mapBbox.maxLat}` : undefined}
          mapBbox={mapBbox ?? undefined}
          parcelRings={parcelRings ?? undefined}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Estimate-${estMeta.num}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingPdf(false);
    }
  }

  function reset() {
    setStage("lookup");
    setGeo(null);
    setParcelRings(null);
    setMapBbox(null);
    setEnv(null);
    setOwnerName("");
    setAcreage("");
    setZoning("");
    setResolvedParcelId("");
    setResolvedCounty("");
    setResolvedZip("");
    setServiceData(null);
    setContactName("");
    setContactPhone("");
    setContactEmail("");
    setContactEmailConfirm("");
    setQuote(null);
    setEstMeta(null);
    setErrorMsg("");
    setEstimateRating(null);
    setEstimateComment("");
    setEstimateFeedbackStatus("idle");
  }

  return (
    <div className={styles.page}>
      <FeedbackWidget />
      <header className={styles.header}>
        <img src="/arc-logo.png" alt="ARC Land Development" className={styles.headerLogo} />
      </header>

      {/* ── Step 1: Lookup ───────────────────────────────────── */}
      {(stage === "lookup" || stage === "error") && (
        <form className={styles.card} onSubmit={lookupParcel}>
          <h2 className={styles.cardTitle}>Look Up Parcel</h2>

          <div className={styles.field}>
            <label>Lookup Method</label>
            <select
              value={lookupMethod}
              onChange={(e) => { setLookupMethod(e.target.value as LookupMethod); setErrorMsg(""); }}
            >
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
          <button type="submit" className={styles.btn}>Look Up Parcel</button>
        </form>
      )}

      {/* ── Loading ──────────────────────────────────────────── */}
      {stage === "loading_parcel" && (
        <div className={styles.card}>
          <div className={styles.spinner} />
          <p className={styles.loadingText}>Fetching parcel and environmental data…</p>
        </div>
      )}

      {/* ── Step 2: Property card + service form ─────────────── */}
      {(stage === "job" || stage === "loading_quote") && (
        <>
          {/* Property info — read-only */}
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Property Information</h2>
            {geo && <p className={styles.address}>{geo.formattedAddress}</p>}
            {!geo && resolvedParcelId && (
              <p className={styles.address}>Parcel {resolvedParcelId} — {resolvedCounty}, {stateCode}</p>
            )}
            {errorMsg && <p className={styles.warning}>{errorMsg}</p>}

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
                  {parcelRings && (() => {
                    const { minLng, maxLng, minLat, maxLat } = mapBbox;
                    const toX = (lng: number) => ((lng - minLng) / (maxLng - minLng)) * 640;
                    const toY = (lat: number) => ((maxLat - lat) / (maxLat - minLat)) * 480;
                    return (
                      <svg
                        viewBox="0 0 640 480"
                        className={styles.parcelOverlay}
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        {parcelRings.map((ring, i) => (
                          <polygon
                            key={i}
                            points={ring.map(([lng, lat]) => `${toX(lng)},${toY(lat)}`).join(" ")}
                            fill="rgba(255,200,0,0.12)"
                            stroke="#ff6600"
                            strokeWidth="3"
                            strokeLinejoin="round"
                          />
                        ))}
                      </svg>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>

          {/* Service details */}
          <form className={styles.card} onSubmit={getQuote}>
            <h2 className={styles.cardTitle}>Service Details</h2>

            <ServiceDetailsSection
              onChange={setServiceData}
              mapBbox={mapBbox ?? undefined}
              parcelRings={parcelRings ?? undefined}
            />

            <div className={styles.svcSection} style={{ borderTop: "1px solid #e5e7eb", paddingTop: "1.1rem", marginTop: 0 }}>
              <h3 className={styles.svcTitle}>Contact Information</h3>
              <div className={styles.field}>
                <label>Name</label>
                <input
                  type="text"
                  placeholder="Full name"
                  value={contactName}
                  onChange={(e) => setContactName(
                    e.target.value.replace(/\b\w/g, (c) => c.toUpperCase())
                  )}
                />
              </div>
              <div className={styles.row}>
                <div className={styles.field} style={{ flex: 1 }}>
                  <label>Phone</label>
                  <input
                    type="tel"
                    placeholder="(555) 000-0000"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                  />
                </div>
                <div className={styles.field} style={{ flex: 1 }}>
                  <label>Email</label>
                  <input
                    type="email"
                    placeholder="you@example.com"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value.trim())}
                    onInvalid={(e) => e.currentTarget.setCustomValidity("Please enter a valid email address.")}
                    onInput={(e) => e.currentTarget.setCustomValidity("")}
                  />
                </div>
              </div>
              <div className={styles.row}>
                <div className={styles.field} style={{ flex: 1 }} />
                <div className={styles.field} style={{ flex: 1 }}>
                  <label>Confirm Email</label>
                  <input
                    type="email"
                    placeholder="Re-enter email"
                    value={contactEmailConfirm}
                    onChange={(e) => setContactEmailConfirm(e.target.value.trim())}
                    onInvalid={(e) => e.currentTarget.setCustomValidity("Please enter a valid email address.")}
                    onInput={(e) => e.currentTarget.setCustomValidity("")}
                    style={contactEmailConfirm && contactEmail !== contactEmailConfirm ? { borderColor: "#dc2626" } : {}}
                  />
                  {contactEmailConfirm && contactEmail !== contactEmailConfirm && (
                    <p className={styles.error} style={{ marginTop: 4, marginBottom: 0 }}>Emails do not match.</p>
                  )}
                </div>
              </div>
            </div>

            <div className={styles.svcSection} style={{ borderTop: "1px solid #e5e7eb", paddingTop: "1.1rem", marginTop: 0 }}>
              <h3 className={styles.svcTitle}>Notes for the Estimator</h3>
              <div className={styles.field}>
                <label>Additional Instructions (optional)</label>
                <textarea
                  placeholder="Anything specific you want priced or called out — a custom request, a detail on the plans, a scope change, etc."
                  rows={4}
                  value={additionalNotes}
                  onChange={(e) => setAdditionalNotes(e.target.value)}
                />
              </div>
            </div>

            {errorMsg && <p className={styles.error}>{errorMsg}</p>}

            <button
              type="submit"
              className={styles.btn}
              disabled={stage === "loading_quote"}
            >
              {stage === "loading_quote"
                ? (loadingPhase === "checkout" ? "Redirecting to payment…" : "Generating…")
                : "Continue to Payment — $6.99"}
            </button>

            {stage === "loading_quote" && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
                <div className={styles.spinner} style={{ margin: 0 }} />
                <p className={styles.loadingText} style={{ textAlign: "left", marginBottom: 0 }}>
                  {loadingPhase === "checkout"
                    ? "Redirecting to secure payment…"
                    : "Payment received — building your estimate. Please keep this browser window open and avoid refreshing until it's ready."}
                </p>
              </div>
            )}
          </form>
        </>
      )}

      {/* ── Quote result ─────────────────────────────────────── */}
      {stage === "done" && quote && estMeta && (() => {
        const estNum = estMeta.num;
        const estDate = estMeta.date;
        return (
          <div className={styles.quoteDoc}>
            {/* ── Title bar ── */}
            <div className={styles.quoteDocHeader}>
              <span className={styles.quoteDocTitle}>ESTIMATE</span>
            </div>

            {/* ── Meta row ── */}
            <div className={styles.quoteMetaRow}>
              {/* Left — prepared for */}
              <div className={styles.quotePreparedFor}>
                <div className={styles.quoteDocLabel}>PREPARED FOR</div>
                {contactName && <div className={styles.quoteClientName}>{contactName}</div>}
                {contactPhone && <div className={styles.quoteClientDetail}>{contactPhone}</div>}
                {contactEmail && <div className={styles.quoteClientDetail}>{contactEmail}</div>}
                {(geo?.formattedAddress || resolvedParcelId) && (
                  <div className={styles.quoteClientDetail}>{geo?.formattedAddress ?? `Parcel ${resolvedParcelId}`}</div>
                )}
                {resolvedCounty && (
                  <div className={styles.quoteClientDetail}>{resolvedCounty}, {geo?.state ?? stateCode}</div>
                )}
              </div>

              {/* Right — company */}
              <div className={styles.quoteCompanyBlock}>
                <img src="/arc-logo.png" alt="ARC Land Development" className={styles.quoteDocLogo} />
                <div className={styles.quoteCompanyName}>ARC Land Development</div>
                <div className={styles.quoteCompanyDetail}>(954) 471-1507</div>
              </div>
            </div>

            {/* ── Estimate # / date ── */}
            <div className={styles.quoteNumRow}>
              <div><span className={styles.quoteDocLabel}>ESTIMATE #</span> <span className={styles.quoteNumVal}>{estNum}</span></div>
              <div><span className={styles.quoteDocLabel}>ESTIMATE DATE</span> <span className={styles.quoteNumVal}>{estDate}</span></div>
              <div><span className={styles.quoteDocLabel}>VALID FOR</span> <span className={styles.quoteNumVal}>30 Days</span></div>
            </div>

            {/* ── Site map ── */}
            {mapBbox && (
              <>
                <div className={styles.quoteScopeBar}>SITE MAP</div>
                <div className={styles.quoteMapWrap}>
                  <div className={styles.quoteMapContainer}>
                    <img
                      src={`/api/map-image?minLng=${mapBbox.minLng}&maxLng=${mapBbox.maxLng}&minLat=${mapBbox.minLat}&maxLat=${mapBbox.maxLat}`}
                      alt="Aerial view of property"
                      className={styles.propMapImage}
                    />
                    {parcelRings && (() => {
                      const { minLng, maxLng, minLat, maxLat } = mapBbox;
                      const toX = (lng: number) => ((lng - minLng) / (maxLng - minLng)) * 640;
                      const toY = (lat: number) => ((maxLat - lat) / (maxLat - minLat)) * 480;
                      return (
                        <svg
                          viewBox="0 0 640 480"
                          className={styles.parcelOverlay}
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          {parcelRings.map((ring, i) => (
                            <polygon
                              key={i}
                              points={ring.map(([lng, lat]) => `${toX(lng)},${toY(lat)}`).join(" ")}
                              fill="rgba(255,200,0,0.12)"
                              stroke="#ff6600"
                              strokeWidth="3"
                              strokeLinejoin="round"
                            />
                          ))}
                        </svg>
                      );
                    })()}
                  </div>
                </div>
              </>
            )}

            {/* ── Scope summary ── */}
            <div className={styles.quoteScopeBar}>SCOPE OF WORK</div>
            <p className={styles.quoteScopeText}>{quote.summary}</p>

            {/* ── Tree inventory ── */}
            {quote.treeInventory && (
              <>
                <div className={styles.quoteScopeBar}>TREE INVENTORY (AI Aerial Analysis)</div>
                <div className={styles.treeInventory}>
                  <div className={styles.treeInventoryGrid}>
                    <div className={styles.treeStatBox}>
                      <div className={styles.treeStatNum}>{quote.treeInventory.estimatedCount}</div>
                      <div className={styles.treeStatLabel}>Est. Trees</div>
                    </div>
                    <div className={styles.treeStatBox}>
                      <div className={styles.treeStatNum}>{quote.treeInventory.density}</div>
                      <div className={styles.treeStatLabel}>Density</div>
                    </div>
                    <div className={styles.treeStatBox} style={{ gridColumn: "span 2" }}>
                      <div className={styles.treeStatNum} style={{ fontSize: "0.9rem", fontWeight: 600 }}>{quote.treeInventory.species.join(", ")}</div>
                      <div className={styles.treeStatLabel}>Species Identified</div>
                    </div>
                  </div>
                  <div className={styles.treeDetail}><strong>Size Distribution:</strong> {quote.treeInventory.sizeDistribution}</div>
                  {quote.treeInventory.notes && <div className={styles.treeDetail}><strong>Notes:</strong> {quote.treeInventory.notes}</div>}
                  <div className={styles.treeDisclaimer}>Tree count estimated from satellite imagery. Field verification recommended before final contract.</div>
                </div>
              </>
            )}

            {/* ── Materials ── */}
            {quote.materialLineItems.length > 0 && (
              <>
                <div className={styles.quoteScopeBar}>MATERIALS</div>
                <div className={styles.quoteTableWrap}>
                  <table className={styles.quoteTable}>
                    <thead>
                      <tr>
                        <th className={styles.quoteThDesc}>DESCRIPTION</th>
                        <th className={styles.quoteTh}>PART #</th>
                        <th className={styles.quoteTh}>UNIT</th>
                        <th className={styles.quoteTh}>QTY</th>
                        <th className={styles.quoteTh}>RATE</th>
                        <th className={styles.quoteTh}>AMOUNT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quote.materialLineItems.map((item, i) => (
                        <tr key={i} className={i % 2 === 1 ? styles.quoteRowAlt : ""}>
                          <td className={styles.quoteTdDesc}>{item.description}</td>
                          <td className={styles.quoteTd}>{item.partNumber ?? "—"}</td>
                          <td className={styles.quoteTd}>{item.unit}</td>
                          <td className={styles.quoteTd}>{item.qty.toFixed(2)}</td>
                          <td className={styles.quoteTd}>{fmt(item.unitCost)}</td>
                          <td className={styles.quoteTdAmt}>{fmt(item.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className={styles.quoteTdSubtotalLabel} colSpan={5}>Materials Subtotal</td>
                        <td className={styles.quoteTdSubtotalAmt}>
                          {fmt(quote.materialLineItems.reduce((sum, item) => sum + item.total, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}

            {/* ── Labor ── */}
            {quote.laborLineItems.length > 0 && (
              <>
                <div className={styles.quoteScopeBar}>LABOR</div>
                <div className={styles.quoteTableWrap}>
                  <table className={styles.quoteTable}>
                    <thead>
                      <tr>
                        <th className={styles.quoteThDesc}>DESCRIPTION</th>
                        <th className={styles.quoteTh}>AMOUNT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quote.laborLineItems.map((item, i) => (
                        <tr key={i} className={i % 2 === 1 ? styles.quoteRowAlt : ""}>
                          <td className={styles.quoteTdDesc}>{item.description}</td>
                          <td className={styles.quoteTdAmt}>{fmt(item.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className={styles.quoteTdSubtotalLabel}>Labor Subtotal</td>
                        <td className={styles.quoteTdSubtotalAmt}>
                          {fmt(quote.laborLineItems.reduce((sum, item) => sum + item.total, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}

            {/* ── Totals ── */}
            <div className={styles.quoteTotalsBlock}>
              <div className={styles.quoteTotalLine}>
                <span>Subtotal</span><span>{fmt(quote.subtotal)}</span>
              </div>
              {quote.mobilization > 0 && (
                <div className={styles.quoteTotalLine}>
                  <span>Mobilization</span><span>{fmt(quote.mobilization)}</span>
                </div>
              )}
              {quote.disposal > 0 && (
                <div className={styles.quoteTotalLine}>
                  <span>Disposal</span><span>{fmt(quote.disposal)}</span>
                </div>
              )}
              <div className={styles.quoteTotalLine}>
                <span>Est. Duration</span><span>{quote.estimatedDuration}</span>
              </div>
              <div className={styles.quoteGrandTotal}>
                <span>ESTIMATED TOTAL</span><span>{fmt(quote.total)}</span>
              </div>
            </div>

            {/* ── Assumptions ── */}
            {quote.assumptions.length > 0 && (
              <>
                <div className={styles.quoteScopeBar}>ASSUMPTIONS</div>
                <ul className={styles.quoteList}>
                  {quote.assumptions.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </>
            )}

            {/* ── Warnings ── */}
            {quote.warnings.length > 0 && (
              <>
                <div className={styles.quoteScopeBar} style={{ background: "#92400e" }}>IMPORTANT NOTICES</div>
                <ul className={styles.quoteList} style={{ color: "#78350f" }}>
                  {quote.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </>
            )}

            {/* ── Thank you + terms ── */}
            <div className={styles.quoteThankYou}>Thank you for your business!</div>
            <div className={styles.quoteTerms}>
              This estimate is not a contract or invoice. It represents our best estimate of the total cost to complete the work described. Final pricing may change based on field conditions, material availability, or scope changes. Price change or additional materials/labor may be required — we will inform you before proceeding. This estimate is valid for 30 days from the date of issuance.
            </div>

            {/* ── Signature ── */}
            <div className={styles.quoteSigRow}>
              <div className={styles.quoteSigBlock}>
                <div className={styles.quoteSigLine} />
                <div className={styles.quoteSigLabel}>Customer Signature</div>
              </div>
              <div className={styles.quoteSigBlock}>
                <div className={styles.quoteSigLine} />
                <div className={styles.quoteSigLabel}>Date</div>
              </div>
            </div>

            <div className={styles.quoteActions}>
              <button className={styles.btn} onClick={downloadPdf} disabled={downloadingPdf}>
                {downloadingPdf ? "Preparing PDF…" : "Download PDF"}
              </button>
              <button className={styles.btnSecondary} onClick={reset}>New Quote</button>
            </div>
          </div>
        );
      })()}

      {stage === "done" && quote && estMeta && (
        <div className={styles.quoteFeedback}>
          {estimateFeedbackStatus === "sent" ? (
            <p className={styles.quoteFeedbackThanks}>Thanks for your feedback!</p>
          ) : (
            <>
              <div className={styles.quoteFeedbackPrompt}>Was this estimate helpful?</div>
              <div className={styles.quoteFeedbackButtons}>
                <button
                  type="button"
                  className={estimateRating === "up" ? `${styles.quoteFeedbackBtn} ${styles.quoteFeedbackBtnActive}` : styles.quoteFeedbackBtn}
                  onClick={() => setEstimateRating("up")}
                >
                  👍 Yes
                </button>
                <button
                  type="button"
                  className={estimateRating === "down" ? `${styles.quoteFeedbackBtn} ${styles.quoteFeedbackBtnActive}` : styles.quoteFeedbackBtn}
                  onClick={() => setEstimateRating("down")}
                >
                  👎 No
                </button>
              </div>
              {estimateRating && (
                <>
                  <textarea
                    className={styles.quoteFeedbackComment}
                    placeholder="Anything you'd like to add? (optional)"
                    value={estimateComment}
                    onChange={(e) => setEstimateComment(e.target.value)}
                  />
                  <button
                    type="button"
                    className={styles.quoteFeedbackSubmit}
                    onClick={submitEstimateFeedback}
                    disabled={estimateFeedbackStatus === "sending"}
                  >
                    {estimateFeedbackStatus === "sending" ? "Sending…" : "Submit Feedback"}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
