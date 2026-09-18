"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { clientAuth } from "../../../lib/firebaseClient";
import { FL_COUNTIES } from "../../../lib/floridaCounties";
import adminStyles from "../admin.module.css";
import styles from "../../page.module.css";

export default function LeadGeneratorPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  const [county, setCounty] = useState(FL_COUNTIES[0].name);
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [doneFilename, setDoneFilename] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(clientAuth, (u) => {
      setUser(u);
      setChecking(false);
      if (!u) router.push("/admin/login");
    });
    return unsub;
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !user) return;

    setProcessing(true);
    setErrorMsg("");
    setDoneFilename("");

    try {
      const token = await user.getIdToken();
      const form = new FormData();
      form.append("file", file);
      form.append("county", county);

      const res = await fetch("/api/admin/lead-generator", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }

      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? "mailing-list.xlsx";

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setDoneFilename(filename);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setProcessing(false);
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
          <div className={adminStyles.title}>Lead Generator</div>
        </div>

        <form className={adminStyles.card} style={{ padding: "1.5rem" }} onSubmit={handleSubmit}>
          <p style={{ color: "#555", fontSize: "0.88rem", marginBottom: "1.25rem" }}>
            Upload a spreadsheet of property owner names and parcel numbers. One column header
            must contain the word &quot;Parcel&quot;. We&apos;ll look each parcel up against the
            Florida statewide property records and return the file with the owner&apos;s mailing
            address added, sorted largest lot to smallest. Parcels under 1 acre, or that
            couldn&apos;t be matched, are left out.
          </p>

          <div className={styles.field}>
            <label>County</label>
            <select value={county} onChange={(e) => setCounty(e.target.value)}>
              {FL_COUNTIES.map((c) => (
                <option key={c.coNo} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label>Owner / Parcel List (.xlsx, .xls, .csv)</label>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
          </div>

          {errorMsg && <p className={adminStyles.error}>{errorMsg}</p>}
          {doneFilename && (
            <p style={{ color: "#16a34a", fontSize: "0.85rem", marginTop: "0.75rem" }}>
              Done — {doneFilename} downloaded.
            </p>
          )}

          <button type="submit" className={adminStyles.btn} disabled={processing || !file}>
            {processing ? "Processing…" : "Generate Mailing List"}
          </button>
        </form>
      </div>
    </div>
  );
}
