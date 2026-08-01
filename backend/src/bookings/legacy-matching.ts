export type LegacyInviteMatchInput = {
  checkIn: string;
  checkOut: string;
  guestEmail: string | null;
  guestNames: string[];
};

export type LegacyBookingMatchInput = {
  stayCode: string;
  checkIn: string;
  checkOut: string;
  guestEmail?: string | null;
  guestName?: string | null;
};

export function strictLegacyBookingMatch(
  invite: LegacyInviteMatchInput,
  bookings: LegacyBookingMatchInput[]
) {
  const names = new Set(invite.guestNames.map(normalizeName).filter(Boolean));
  const candidates = bookings.filter((booking) => {
    if (booking.checkIn !== invite.checkIn || booking.checkOut !== invite.checkOut) return false;
    const sameEmail = Boolean(
      invite.guestEmail &&
      booking.guestEmail &&
      normalizeEmail(invite.guestEmail) === normalizeEmail(booking.guestEmail)
    );
    const sameName = Boolean(booking.guestName && names.has(normalizeName(booking.guestName)));
    return sameEmail || sameName;
  });
  const unique = [...new Map(candidates.map((booking) => [booking.stayCode, booking])).values()];
  return unique.length === 1 ? unique[0] : null;
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeName(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
