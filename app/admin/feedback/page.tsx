"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { clientAuth } from "../../../lib/firebaseClient";
import styles from "../admin.module.css";

type FeedbackEntry = {
  id: string;
  createdAt: string | null;
  type: string | null;
  message: string | null;
  email: string | null;
  rating: string | null;
  estimateNum: string | null;
  pageUrl: string | null;
};

export default function AdminFeedbackPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [feedback, setFeedback] = useState<FeedbackEntry[]>([]);
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
      .then((token) => fetch("/api/admin/feedback", { headers: { Authorization: `Bearer ${token}` } }))
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load feedback");
        const data = await res.json();
        setFeedback(data.feedback);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Unknown error"))
      .finally(() => setLoading(false));
  }, [user]);

  if (checking || !user) return null;

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <span className={styles.backLink} onClick={() => router.push("/admin")}>
          ← Back to Estimates
        </span>

        <div className={styles.header}>
          <div className={styles.title}>User Feedback</div>
        </div>

        <div className={styles.card}>
          {loading ? (
            <div className={styles.empty}>Loading…</div>
          ) : error ? (
            <div className={styles.empty}>{error}</div>
          ) : feedback.length === 0 ? (
            <div className={styles.empty}>No feedback submitted yet.</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Rating</th>
                  <th>Message</th>
                  <th>Email</th>
                  <th>Estimate #</th>
                </tr>
              </thead>
              <tbody>
                {feedback.map((f) => (
                  <tr key={f.id}>
                    <td>{f.createdAt ? new Date(f.createdAt).toLocaleString() : "—"}</td>
                    <td>{f.type === "estimate" ? "Estimate" : "General"}</td>
                    <td>{f.rating === "up" ? "👍" : f.rating === "down" ? "👎" : "—"}</td>
                    <td style={{ maxWidth: 400, whiteSpace: "pre-wrap" }}>{f.message ?? "—"}</td>
                    <td>{f.email ?? "—"}</td>
                    <td>{f.estimateNum ?? "—"}</td>
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
