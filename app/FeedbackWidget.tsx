"use client";

import { useState } from "react";
import styles from "./FeedbackWidget.module.css";

export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function submit() {
    if (!message.trim()) return;
    setStatus("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "general",
          message: message.trim(),
          email: email.trim() || undefined,
          pageUrl: window.location.href,
        }),
      });
      if (!res.ok) throw new Error();
      setStatus("sent");
      setMessage("");
      setEmail("");
      setTimeout(() => {
        setOpen(false);
        setStatus("idle");
      }, 1500);
    } catch {
      setStatus("error");
    }
  }

  if (!open) {
    return (
      <button className={styles.tab} onClick={() => setOpen(true)}>
        Feedback
      </button>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.title}>Send Feedback</div>
      {status === "sent" ? (
        <p className={`${styles.status} ${styles.statusOk}`}>Thanks for your feedback!</p>
      ) : (
        <>
          <textarea
            className={styles.textarea}
            placeholder="What's working well, what's confusing, what would you change?"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <input
            className={styles.emailInput}
            type="email"
            placeholder="Email (optional, if you'd like a reply)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {status === "error" && (
            <p className={`${styles.status} ${styles.statusErr}`}>
              Something went wrong. Please try again.
            </p>
          )}
          <div className={styles.actions}>
            <button className={styles.cancelBtn} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className={styles.sendBtn}
              onClick={submit}
              disabled={status === "sending" || !message.trim()}
            >
              {status === "sending" ? "Sending…" : "Send"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
