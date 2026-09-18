"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { clientAuth } from "../../../lib/firebaseClient";
import { FL_COUNTIES } from "../../../lib/floridaCounties";
import adminStyles from "../admin.module.css";
import styles from "../../page.module.css";

async function downloadResponse(res: Response, fallbackFilename: string): Promise<string> {
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] ?? fallbackFilename;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  return filename;
}

export default function LeadGeneratorPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  const [county, setCounty] = useState(FL_COUNTIES[0].name);
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [doneFilename, setDoneFilename] = useState("");

  const [mailingListFile, setMailingListFile] = useState<File | null>(null);
  const [reiskipFile, setReiskipFile] = useState<File | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState("");
  const [mergeDone, setMergeDone] = useState("");

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

      const filename = await downloadResponse(res, "mailing-list.xlsx");
      setDoneFilename(filename);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setProcessing(false);
    }
  }

  async function handleMerge(e: React.FormEvent) {
    e.preventDefault();
    if (!mailingListFile || !reiskipFile || !user) return;

    setMerging(true);
    setMergeError("");
    setMergeDone("");

    try {
      const token = await user.getIdToken();
      const form = new FormData();
      form.append("mailingList", mailingListFile);
      form.append("reiskipResults", reiskipFile);

      const res = await fetch("/api/admin/lead-generator/merge", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }

      const matched = res.headers.get("X-Matched-Count");
      const total = res.headers.get("X-Total-Count");
      const filename = await downloadResponse(res, "mailing-list-with-contacts.xlsx");
      setMergeDone(
        matched && total
          ? `Done — ${filename} downloaded (${matched}/${total} rows matched).`
          : `Done — ${filename} downloaded.`
      );
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setMerging(false);
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

        <form
          className={adminStyles.card}
          style={{ padding: "1.5rem", marginBottom: "1.5rem" }}
          onSubmit={handleSubmit}
        >
          <div className={adminStyles.sectionTitle}>Step 1: Generate Mailing List</div>
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

        <form className={adminStyles.card} style={{ padding: "1.5rem" }} onSubmit={handleMerge}>
          <div className={adminStyles.sectionTitle}>Step 2: Merge REISkip Contact Info</div>
          <p style={{ color: "#555", fontSize: "0.88rem", marginBottom: "1.25rem" }}>
            Upload the mailing list from Step 1 into REISkip to retrieve owner phone numbers and
            emails, then bring both files back here — the mailing list you started with, and the
            results REISkip gives you. We&apos;ll match rows by parcel number (or by mailing
            address if REISkip doesn&apos;t return one) and produce a single file with every
            phone/email column REISkip found merged in.
          </p>

          <div className={styles.field}>
            <label>Mailing List (from Step 1)</label>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => setMailingListFile(e.target.files?.[0] ?? null)}
              required
            />
          </div>

          <div className={styles.field}>
            <label>REISkip Results File</label>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => setReiskipFile(e.target.files?.[0] ?? null)}
              required
            />
          </div>

          {mergeError && <p className={adminStyles.error}>{mergeError}</p>}
          {mergeDone && (
            <p style={{ color: "#16a34a", fontSize: "0.85rem", marginTop: "0.75rem" }}>
              {mergeDone}
            </p>
          )}

          <button
            type="submit"
            className={adminStyles.btn}
            disabled={merging || !mailingListFile || !reiskipFile}
          >
            {merging ? "Merging…" : "Merge & Download"}
          </button>
        </form>
      </div>
    </div>
  );
}
