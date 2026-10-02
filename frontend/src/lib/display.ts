export function formatDate(value: string, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
    ...options
  }).format(new Date(`${value.slice(0, 10)}T00:00:00.000Z`));
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila"
  }).format(new Date(value));
}

export function channelLabel(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === "airbnb") return "Airbnb";
  if (normalized === "booking.com") return "Booking.com";
  if (normalized === "agoda") return "Agoda";
  if (normalized === "booking_site") return "Direct";
  return value;
}

export function statusLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function money(value: number | null | undefined) {
  return value == null
    ? "—"
    : new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(
        value
      );
}

export type Tone = "neutral" | "pending" | "attention" | "ready" | "done" | "sent" | "ai" | "danger";

export function registrationTone(status: string): Tone {
  if (status === "done") return "done";
  if (status === "pending") return "pending";
  if (status === "review") return "ready";
  if (status === "needs_registration") return "attention";
  if (status === "rejected") return "danger";
  return "neutral";
}

export function submissionTone(status: string): Tone {
  if (["submitted_email_sent", "submitted", "approved", "done"].includes(status)) return "done";
  if (["queued", "submitting", "ai_check_pending"].includes(status)) return "pending";
  if (["ai_review_required", "failed", "submitted_email_failed"].includes(status)) return "attention";
  if (status === "ready_for_review") return "ready";
  if (status === "rejected") return "danger";
  return "neutral";
}
