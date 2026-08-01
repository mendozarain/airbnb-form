import { Injectable } from "@nestjs/common";
import { requiredEnv } from "../config/env.js";

const HOSTEX_API_BASE = "https://api.hostex.io/v3";
const HOSTEX_USER_AGENT = "cozy-d-714-hostex-invites/1.0";
const REQUEST_TIMEOUT_MS = 30_000;

type HostexEnvelope<T> = {
  request_id?: string;
  error_code?: number | string;
  error_msg?: string;
  data?: T;
};

export type HostexReservation = {
  reservation_code: string;
  stay_code: string;
  property_id: number;
  channel_type: string;
  check_in_date: string;
  check_out_date: string;
  status: string;
  guest_name?: string | null;
  guest_email?: string | null;
  guest_phone?: string | null;
  channel_id?: string | null;
  listing_id?: string | null;
  stay_status?: string | null;
  number_of_guests?: number | null;
  number_of_adults?: number | null;
  number_of_children?: number | null;
  booked_at?: string | null;
  cancelled_at?: string | null;
  conversation_id?: string | null;
};

export type HostexAvailability = { date: string; available: boolean };
export type HostexListing = { channelType: string; listingId: string };
export type HostexListingCalendarDay = {
  date: string;
  price?: number | null;
  inventory?: number | null;
  restrictions?: unknown;
};

export type HostexConversation = {
  id: string;
  messages: Array<{
    id?: string;
    sender_role?: string;
    content?: string;
    created_at?: string;
  }>;
};

export class HostexApiError extends Error {
  constructor(
    message: string,
    readonly code: number | string,
    readonly requestId?: string,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "HostexApiError";
  }
}

export class HostexTransportError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "HostexTransportError";
  }
}

export class HostexUncertainSendError extends HostexTransportError {
  constructor(cause?: unknown) {
    super("Hostex message outcome is unknown because the request did not complete", cause);
    this.name = "HostexUncertainSendError";
  }
}

@Injectable()
export class HostexClient {
  async listReservations(input: {
    propertyId: number;
    status?: string;
    startCheckIn: string;
    endCheckIn: string;
  }) {
    const reservations: HostexReservation[] = [];
    let offset = 0;

    while (true) {
      const payload = await this.request<{ reservations?: HostexReservation[] }>("GET", "/reservations", {
        query: {
          property_id: input.propertyId,
          status: input.status,
          start_check_in_date: input.startCheckIn,
          end_check_in_date: input.endCheckIn,
          limit: 100,
          offset
        }
      });
      const batch = payload.data?.reservations ?? [];
      reservations.push(...batch);
      if (batch.length < 100) break;
      offset += batch.length;
    }

    return reservations;
  }

  async getReservation(reservationCode: string, stayCode: string) {
    const payload = await this.request<{ reservations?: HostexReservation[] }>("GET", "/reservations", {
      query: { reservation_code: reservationCode, limit: 100, offset: 0 }
    });
    return (
      (payload.data?.reservations ?? []).find((reservation) => reservation.stay_code === stayCode) ?? null
    );
  }

  async getConversation(conversationId: string) {
    const payload = await this.request<HostexConversation>(
      "GET",
      `/conversations/${encodeURIComponent(conversationId)}`
    );
    return payload.data ?? { id: conversationId, messages: [] };
  }

  async sendMessage(conversationId: string, message: string) {
    try {
      const payload = await this.request<never>(
        "POST",
        `/conversations/${encodeURIComponent(conversationId)}`,
        { body: { message } }
      );
      return { requestId: payload.request_id ?? null };
    } catch (error) {
      if (error instanceof HostexApiError) throw error;
      throw new HostexUncertainSendError(error);
    }
  }

  async getAvailabilities(propertyId: number, startDate: string, endDate: string) {
    const payload = await this.request<{ properties?: Array<{ availabilities?: HostexAvailability[] }> }>(
      "GET",
      "/availabilities",
      { query: { property_ids: propertyId, start_date: startDate, end_date: endDate } }
    );
    return payload.data?.properties?.[0]?.availabilities ?? [];
  }

  async getListingCalendars(startDate: string, endDate: string, listings: HostexListing[]) {
    const payload = await this.request<{
      listings?: Array<{
        channel_type: string;
        listing_id: string;
        calendar?: HostexListingCalendarDay[];
      }>;
    }>("POST", "/listings/calendar", {
      body: {
        start_date: startDate,
        end_date: endDate,
        listings: listings.map((listing) => ({
          channel_type: listing.channelType,
          listing_id: listing.listingId
        }))
      }
    });
    return payload.data?.listings ?? [];
  }

  async submitPrices(
    channelType: string,
    listingId: string,
    prices: Array<{ start_date: string; end_date: string; price: number }>
  ) {
    const payload = await this.request<never>("POST", "/listings/prices", {
      body: { channel_type: channelType, listing_id: listingId, prices }
    });
    return { requestId: payload.request_id ?? null };
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    options: { query?: Record<string, string | number | undefined>; body?: Record<string, unknown> } = {}
  ): Promise<HostexEnvelope<T>> {
    const url = new URL(`${HOSTEX_API_BASE}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Hostex-Access-Token": requiredEnv("HOSTEX_ACCESS_TOKEN"),
          "User-Agent": HOSTEX_USER_AGENT
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      });
    } catch (error) {
      throw new HostexTransportError(`Hostex ${method} ${path} did not complete`, error);
    }

    const payload = (await response.json().catch(() => ({}))) as HostexEnvelope<T>;
    const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
    if (!response.ok) {
      throw new HostexApiError(
        `Hostex HTTP ${response.status}: ${payload.error_msg ?? "request failed"}`,
        response.status,
        payload.request_id,
        retryAfter
      );
    }
    if (!isSuccessCode(payload.error_code)) {
      throw new HostexApiError(
        `Hostex error ${String(payload.error_code)}: ${payload.error_msg ?? "request failed"}`,
        payload.error_code ?? "unknown",
        payload.request_id,
        retryAfter
      );
    }
    return payload;
  }
}

function isSuccessCode(code: number | string | undefined) {
  return code === undefined || code === 0 || code === "0" || code === 200 || code === "200";
}

function parseRetryAfter(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}
