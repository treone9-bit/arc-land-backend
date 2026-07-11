"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { clientAuth } from "../../lib/firebaseClient";
import styles from "./admin.module.css";

type EstimateSummary = {
  id: string;
  createdAt: string | null;
  serviceType: string | null;
  address: string | null;
  county: string | null;
  state: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  total: number | null;
  fromCache: boolean;
  source: "customer" | "admin_free";
};

function fmt(n: number | null) {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function AdminDashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [estimates, setEstimates] = useState<EstimateSummary[]>([]);
  const [loading, setLoading] = useState(false);
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
    setLoading(true);
    setError("");
    user
      .getIdToken()
      .then((token) => fetch("/api/admin/estimates", { headers: { Authorization: `Bearer ${token}` } }))
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load estimates");
        const data = await res.json();
        setEstimates(data.estimates);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Unknown error"))
      .finally(() => setLoading(false));
  }, [user]);

  if (checking || !user) return null;

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.title}>Saved Estimates</div>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <button className={styles.logoutBtn} onClick={() => router.push("/admin/new-estimate")}>
              + Free Estimate
            </button>
            <span className={styles.backLink} onClick={() => router.push("/admin/feedback")}>
              View Feedback →
            </span>
            <button className={styles.logoutBtn} onClick={() => signOut(clientAuth)}>
              Sign Out
            </button>
          </div>
        </div>

        <div className={styles.card}>
          {loading ? (
            <div className={styles.empty}>Loading…</div>
          ) : error ? (
            <div className={styles.empty}>{error}</div>
          ) : estimates.length === 0 ? (
            <div className={styles.empty}>No estimates saved yet.</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Address</th>
                  <th>County</th>
                  <th>Contact</th>
                  <th>Service</th>
                  <th>Total</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {estimates.map((e) => (
                  <tr key={e.id} onClick={() => router.push(`/admin/${e.id}`)}>
                    <td>{e.createdAt ? new Date(e.createdAt).toLocaleDateString() : "—"}</td>
                    <td>{e.address ?? "—"}</td>
                    <td>{e.county ? `${e.county}, ${e.state}` : "—"}</td>
                    <td>{e.contactName ?? "—"}</td>
                    <td>{e.serviceType === "land_clearing" ? "Land Clearing" : "Plans/Trades"}</td>
                    <td>{fmt(e.total)}</td>
                    <td>
                      {e.source === "admin_free" ? (
                        <span style={{ color: "#2563eb", fontWeight: 600 }}>Free</span>
                      ) : (
                        <span style={{ color: "#16a34a" }}>Paid</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
