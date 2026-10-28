"use client";

import { useState, type FormEvent } from "react";
import { Star } from "lucide-react";

export function ReviewForm({ token }: { token: string }) {
  const [rating, setRating] = useState(0);
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || saved) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, rating, comment, ...(name.trim() ? { customerName: name.trim() } : {}) }) });
      const result: { saved?: boolean; error?: string } = await response.json();
      if (!response.ok || !result.saved) throw new Error(result.error || "Could not save the review. Please try again.");
      setSaved(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the review. Please try again."); }
    finally { setBusy(false); }
  }

  if (saved) return <div className="review-saved" role="status"><h2>Thank you for your feedback.</h2><p>Your response was saved for this shop. This link cannot be used again.</p></div>;
  return <form className="review-form" onSubmit={(event) => void submit(event)}>
    <fieldset><legend>How was your visit?</legend><div className="review-rating">{[1, 2, 3, 4, 5].map((value) =>
      <button type="button" key={value} aria-label={`${value} star${value === 1 ? "" : "s"}`} aria-pressed={rating === value}
        onClick={() => setRating(value)}>{value} <Star size={16} fill={rating >= value ? "currentColor" : "none"} aria-hidden="true" /></button>)}</div></fieldset>
    <label>Your name <span>(optional)</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoComplete="name" /></label>
    <label>Tell the shop what worked or could improve<textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1000} minLength={1} rows={5} required /></label>
    <p>Your response is visible only to this shop. A sale-linked invite is not identity verification.</p>
    <button type="submit" disabled={busy || rating < 1 || !comment.trim()}>{busy ? "Saving…" : "Send feedback"}</button>
    {error && <p role="alert" className="review-error">{error}</p>}
  </form>;
}
