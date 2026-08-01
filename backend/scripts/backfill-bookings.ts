import pg from "pg";
import { strictLegacyBookingMatch } from "../src/bookings/legacy-matching.js";

const apply = process.argv.includes("--apply");
const propertyId = Number(process.env.HOSTEX_PROPERTY_ID ?? 12684960);
const token = process.env.HOSTEX_ACCESS_TOKEN?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!token) throw new Error("HOSTEX_ACCESS_TOKEN is required");
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const range = await client.query<{ start_date: string; end_date: string }>(
    "SELECT (min(check_in) - interval '30 days')::date::text AS start_date, (CURRENT_DATE + interval '365 days')::date::text AS end_date FROM invites"
  );
  const start = range.rows[0]?.start_date ?? new Date().toISOString().slice(0, 10);
  const end = range.rows[0]?.end_date ?? start;
  const reservations = await fetchReservations(start, end);

  if (apply) {
    await client.query("BEGIN");
    try {
      for (const reservation of reservations) {
        await client.query(
          `INSERT INTO bookings (
             reservation_code, stay_code, property_id, channel_type, channel_id, listing_id,
             status, stay_status, guest_name, guest_email, guest_phone, number_of_guests,
             number_of_adults, number_of_children, conversation_id, check_in, check_out,
             booked_at, cancelled_at, last_synced_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,now(),now())
           ON CONFLICT (stay_code) DO UPDATE SET
             reservation_code=excluded.reservation_code, property_id=excluded.property_id,
             channel_type=excluded.channel_type, channel_id=excluded.channel_id,
             listing_id=excluded.listing_id, status=excluded.status, stay_status=excluded.stay_status,
             guest_name=excluded.guest_name, guest_email=excluded.guest_email,
             guest_phone=excluded.guest_phone, number_of_guests=excluded.number_of_guests,
             number_of_adults=excluded.number_of_adults, number_of_children=excluded.number_of_children,
             conversation_id=excluded.conversation_id, check_in=excluded.check_in,
             check_out=excluded.check_out, booked_at=excluded.booked_at,
             cancelled_at=excluded.cancelled_at, last_synced_at=now(), updated_at=now()`,
          [
            reservation.reservation_code,
            reservation.stay_code,
            reservation.property_id,
            reservation.channel_type,
            reservation.channel_id ?? null,
            reservation.listing_id ?? null,
            reservation.status,
            reservation.stay_status ?? null,
            reservation.guest_name ?? null,
            reservation.guest_email ?? null,
            reservation.guest_phone ?? null,
            reservation.number_of_guests ?? null,
            reservation.number_of_adults ?? null,
            reservation.number_of_children ?? null,
            reservation.conversation_id ?? null,
            reservation.check_in_date,
            reservation.check_out_date,
            reservation.booked_at ?? null,
            reservation.cancelled_at ?? null
          ]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  const records = await client.query<{
    invite_id: string;
    check_in: string;
    check_out: string;
    guest_email: string | null;
    guest_names: string[];
  }>(
    `SELECT i.id AS invite_id, i.check_in::text, i.check_out::text, s.guest_email,
            COALESCE(array_agg(g.full_name) FILTER (WHERE g.id IS NOT NULL), '{}') AS guest_names
       FROM invites i
       LEFT JOIN submissions s ON s.invite_id=i.id
       LEFT JOIN guests g ON g.submission_id=s.id
       LEFT JOIN hostex_booking_automations a ON a.invite_id=i.id
      WHERE i.booking_id IS NULL AND a.id IS NULL
      GROUP BY i.id,s.id`
  );

  const matches: Array<{ inviteId: string; stayCode: string }> = [];
  for (const record of records.rows) {
    const match = strictLegacyBookingMatch(
      {
        checkIn: record.check_in,
        checkOut: record.check_out,
        guestEmail: record.guest_email,
        guestNames: record.guest_names
      },
      reservations.map((reservation) => ({
        stayCode: reservation.stay_code,
        checkIn: reservation.check_in_date,
        checkOut: reservation.check_out_date,
        guestEmail: reservation.guest_email,
        guestName: reservation.guest_name
      }))
    );
    if (match) matches.push({ inviteId: record.invite_id, stayCode: match.stayCode });
  }

  if (apply) {
    await client.query("BEGIN");
    try {
      for (const match of matches) {
        await client.query(
          "UPDATE invites i SET booking_id=b.id FROM bookings b WHERE i.id=$1 AND i.booking_id IS NULL AND b.stay_code=$2",
          [match.inviteId, match.stayCode]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      reservations: reservations.length,
      legacyManualInvites: records.rows.length,
      strictMatches: matches.length,
      uncategorized: records.rows.length - matches.length
    })
  );
} finally {
  await client.end();
}

type Reservation = {
  reservation_code: string;
  stay_code: string;
  property_id: number;
  channel_type: string;
  channel_id?: string | null;
  listing_id?: string | null;
  status: string;
  stay_status?: string | null;
  guest_name?: string | null;
  guest_email?: string | null;
  guest_phone?: string | null;
  number_of_guests?: number | null;
  number_of_adults?: number | null;
  number_of_children?: number | null;
  conversation_id?: string | null;
  check_in_date: string;
  check_out_date: string;
  booked_at?: string | null;
  cancelled_at?: string | null;
};

async function fetchReservations(start: string, end: string) {
  const results: Reservation[] = [];
  for (const status of ["accepted", "cancelled"]) {
    for (let cursor = start; cursor <= end;) {
      const chunkEnd = minDate(addDays(cursor, 179), end);
      let offset = 0;
      while (true) {
        const url = new URL("https://api.hostex.io/v3/reservations");
        for (const [key, value] of Object.entries({
          property_id: String(propertyId),
          status,
          start_check_in_date: cursor,
          end_check_in_date: chunkEnd,
          limit: "100",
          offset: String(offset)
        })) {
          url.searchParams.set(key, value);
        }
        const response = await fetch(url, {
          headers: {
            Accept: "application/json",
            "Hostex-Access-Token": token!,
            "User-Agent": "cozy-d-714-booking-backfill/1.0"
          }
        });
        const payload = (await response.json()) as {
          error_code?: number | string;
          error_msg?: string;
          data?: { reservations?: Reservation[] };
        };
        if (!response.ok || ![undefined, 0, "0", 200, "200"].includes(payload.error_code)) {
          throw new Error(`Hostex reservation read failed: ${payload.error_msg ?? response.status}`);
        }
        const batch = payload.data?.reservations ?? [];
        results.push(...batch);
        if (batch.length < 100) break;
        offset += batch.length;
      }
      cursor = addDays(chunkEnd, 1);
    }
  }
  return results;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function minDate(first: string, second: string) {
  return first < second ? first : second;
}
