"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { clientAuth } from "../../../lib/firebaseClient";
import styles from "../admin.module.css";

type MaterialLineItem = {
  description: string;
  partNumber?: string;
  unit: string;
  qty: number;
  unitCost: number;
  total: number;
};

type LaborLineItem = { description: string; total: number };

type QuoteResult = {
  summary: string;
  materialLineItems: MaterialLineItem[];
  laborLineItems: LaborLineItem[];
  subtotal: number;
  mobilization: number;
  disposal: number;
  total: number;
  estimatedDuration: string;
  assumptions: string[];
  warnings: string[];
};

type EstimateDetail = {
  id: string;
  createdAt: string | null;
  serviceType: string | null;
  address: string | null;
  county: string | null;
  state: string | null;
  zipCode: string | null;
  parcelId: string | null;
  ownerName: string | null;
  zoning: string | null;
  acreage: number | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  additionalNotes: string | null;
  trades: string[] | null;
  serviceTypes: string[] | null;
  fromCache: boolean;
  quote: QuoteResult | null;
  planFileUrls: { path: string; url: string }[];
  source: "customer" | "admin_free";
};

function fmt(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export default function EstimateDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [estimate, setEstimate] = useState<EstimateDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(clientAuth, (u) => {
      setUser(u);
      setChecking(false);
      if (!u) router.push("/admin/login");
    });
    return unsub;
  }, [router]);

  useEffect(() => {
    if (!user) return;
    user
      .getIdToken()
      .then((token) => fetch(`/api/admin/estimates/${params.id}`, { headers: { Authorization: `Bearer ${token}` } }))
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load estimate");
        setEstimate(await res.json());
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Unknown error"));
  }, [user, params.id]);

  if (checking || !user) return null;

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <span className={styles.backLink} onClick={() => router.push("/admin")}>
          ← Back to Estimates
        </span>

        {error && <div className={styles.card}><div className={styles.empty}>{error}</div></div>}

        {estimate && (
          <div className={styles.card}>
            <div className={styles.detailGrid}>
              <div>
                <span className={styles.detailLabel}>Date</span>
                <span className={styles.detailValue}>
                  {estimate.createdAt ? new Date(estimate.createdAt).toLocaleString() : "—"}
                </span>
              </div>
              <div>
                <span className={styles.detailLabel}>Service Type</span>
                <span className={styles.detailValue}>
                  {estimate.serviceType === "land_clearing" ? "Land Clearing" : "Plans/Trades"}
                </span>
              </div>
              <div>
                <span className={styles.detailLabel}>Source</span>
                <span className={styles.detailValue}>
                  {estimate.source === "admin_free" ? (
                    <span style={{ color: "#2563eb", fontWeight: 600 }}>Free (Admin-created)</span>
                  ) : (
                    <span style={{ color: "#16a34a" }}>Paid ($6.99)</span>
                  )}
                </span>
              </div>
              <div>
                <span className={styles.detailLabel}>Address</span>
                <span className={styles.detailValue}>{estimate.address ?? "—"}</span>
              </div>
              <div>
                <span className={styles.detailLabel}>County</span>
                <span className={styles.detailValue}>
                  {estimate.county ? `${estimate.county}, ${estimate.state}` : "—"}
                </span>
              </div>
              <div>
                <span className={styles.detailLabel}>Parcel ID</span>
                <span className={styles.detailValue}>{estimate.parcelId ?? "—"}</span>
              </div>
              <div>
                <span className={styles.detailLabel}>Owner</span>
                <span className={styles.detailValue}>{estimate.ownerName ?? "—"}</span>
              </div>
              <div>
                <span className={styles.detailLabel}>Zoning</span>
                <span className={styles.detailValue}>{estimate.zoning ?? "—"}</span>
              </div>
              <div>
                <span className={styles.detailLabel}>Acreage</span>
                <span className={styles.detailValue}>{estimate.acreage ?? "—"}</span>
              </div>
              <div>
                <span className={styles.detailLabel}>Contact</span>
                <span className={styles.detailValue}>{estimate.contactName ?? "—"}</span>
              </div>
              <div>
                <span className={styles.detailLabel}>Phone / Email</span>
                <span className={styles.detailValue}>
                  {[estimate.contactPhone, estimate.contactEmail].filter(Boolean).join(" · ") || "—"}
                </span>
              </div>
              <div>
                <span className={styles.detailLabel}>Services / Trades</span>
                <span className={styles.detailValue}>
                  {(estimate.serviceTypes ?? estimate.trades ?? []).join(", ") || "—"}
                </span>
              </div>
            </div>

            {estimate.additionalNotes && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>Client Notes / Custom Request</div>
                <p className={styles.detailValue} style={{ whiteSpace: "pre-wrap" }}>{estimate.additionalNotes}</p>
              </div>
            )}

            {estimate.planFileUrls.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>Uploaded Plan Files</div>
                {estimate.planFileUrls.map((f, i) => (
                  <a key={f.path} className={styles.fileLink} href={f.url} target="_blank" rel="noreferrer">
                    File {i + 1}
                  </a>
                ))}
              </div>
            )}

            {estimate.quote && (
              <>
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Scope of Work</div>
                  <p className={styles.detailValue}>{estimate.quote.summary}</p>
                </div>

                {estimate.quote.materialLineItems.length > 0 && (
                  <div className={styles.section}>
                    <div className={styles.sectionTitle}>Materials</div>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Description</th>
                          <th>Part #</th>
                          <th>Unit</th>
                          <th>Qty</th>
                          <th>Rate</th>
                          <th>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {estimate.quote.materialLineItems.map((item, i) => (
                          <tr key={i}>
                            <td>{item.description}</td>
                            <td>{item.partNumber ?? "—"}</td>
                            <td>{item.unit}</td>
                            <td>{item.qty.toFixed(2)}</td>
                            <td>{fmt(item.unitCost)}</td>
                            <td>{fmt(item.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {estimate.quote.laborLineItems.length > 0 && (
                  <div className={styles.section}>
                    <div className={styles.sectionTitle}>Labor</div>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Description</th>
                          <th>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {estimate.quote.laborLineItems.map((item, i) => (
                          <tr key={i}>
                            <td>{item.description}</td>
                            <td>{fmt(item.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Totals</div>
                  <p className={styles.detailValue}>Subtotal: {fmt(estimate.quote.subtotal)}</p>
                  {estimate.quote.mobilization > 0 && (
                    <p className={styles.detailValue}>Mobilization: {fmt(estimate.quote.mobilization)}</p>
                  )}
                  {estimate.quote.disposal > 0 && (
                    <p className={styles.detailValue}>Disposal: {fmt(estimate.quote.disposal)}</p>
                  )}
                  <p className={styles.detailValue}>Est. Duration: {estimate.quote.estimatedDuration}</p>
                  <p className={styles.detailValue}><strong>Total: {fmt(estimate.quote.total)}</strong></p>
                </div>

                {estimate.quote.assumptions.length > 0 && (
                  <div className={styles.section}>
                    <div className={styles.sectionTitle}>Assumptions</div>
                    <ul>
                      {estimate.quote.assumptions.map((a, i) => <li key={i}>{a}</li>)}
                    </ul>
                  </div>
                )}

                {estimate.quote.warnings.length > 0 && (
                  <div className={styles.section}>
                    <div className={styles.sectionTitle}>Warnings</div>
                    <ul>
                      {estimate.quote.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
