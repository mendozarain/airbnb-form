import { localDate } from "../hostex/hostex.time.js";

export type BookingRegistrationState = "needs_registration" | "pending" | "review" | "done" | "rejected";

type RegistrationInvite = {
  status: string;
  expiresAt: Date;
  revokedAt: Date | null;
  submission: { status: string } | null;
};

export function bookingRegistrationStatus(
  invites: RegistrationInvite[],
  checkOut: Date,
  now = new Date(),
  timeZone = "Asia/Manila"
): BookingRegistrationState {
  if (dateOnly(checkOut) <= localDate(now, timeZone)) return "done";

  const statuses = invites.flatMap((invite) =>
    invite.submission ? [String(invite.submission.status).toLowerCase()] : []
  );
  if (
    statuses.some((status) =>
      ["submitted", "submitted_email_failed", "submitted_email_sent"].includes(status)
    )
  ) {
    return "done";
  }
  if (statuses.some((status) => ["ready_for_review", "queued", "submitting", "failed"].includes(status))) {
    return "review";
  }
  if (statuses.includes("rejected")) return "rejected";
  if (invites.some((invite) => invite.status === "OPEN" && !invite.revokedAt && invite.expiresAt > now)) {
    return "pending";
  }
  return "needs_registration";
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}
