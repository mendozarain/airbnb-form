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
