import { Injectable } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { pricingConfigSchema } from "@cozy-d-714/shared";
import { HostexClient } from "../hostex/hostex.client.js";
import { localDate } from "../hostex/hostex.time.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { addDays } from "./pricing.engine.js";

@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hostex: HostexClient
  ) {}

  async get(start: string, end: string) {
    const staleBefore = new Date(Date.now() - 60 * 60_000);
    const setting = await this.prisma.pricingSetting.findUnique({ where: { id: "primary" } });
    if (!setting) throw new Error("Pricing settings are missing");
    const expectedDays = datesInRange(start, end).length * pricingConfigSchema.parse(setting.config).listings.length;
    const cached = await this.prisma.hostexCalendarDay.count({
      where: { date: { gte: dateValue(start), lte: dateValue(end) }, syncedAt: { gte: staleBefore } }
    });
    if (cached < expectedDays) await this.sync(start, end);

    const [bookings, calendarDays, latestRun] = await Promise.all([
      this.prisma.booking.findMany({
        where: { checkIn: { lte: dateValue(end) }, checkOut: { gt: dateValue(start) } },
        include: { invites: { include: { submission: true } } },
        orderBy: { checkIn: "asc" }
      }),
      this.prisma.hostexCalendarDay.findMany({
        where: { date: { gte: dateValue(start), lte: dateValue(end) } },
        orderBy: [{ date: "asc" }, { channelType: "asc" }]
      }),
      this.prisma.pricingRun.findFirst({
        where: { status: { in: ["PREVIEWED", "SUBMITTED", "PARTIAL_FAILED"] } },
        orderBy: { startedAt: "desc" },
        include: { days: { where: { date: { gte: dateValue(start), lte: dateValue(end) } } } }
      })
    ]);
    const recommendation = new Map(latestRun?.days.map((day) => [dateOnly(day.date), day]) ?? []);
    const byDate = new Map<string, typeof calendarDays>();
    for (const day of calendarDays) {
      const key = dateOnly(day.date);
      byDate.set(key, [...(byDate.get(key) ?? []), day]);
    }
    const dates = datesInRange(start, end);
    return {
      start,
      end,
      syncedAt:
        calendarDays
          .reduce<Date | null>(
            (latest, day) => (!latest || day.syncedAt > latest ? day.syncedAt : latest),
            null
          )
          ?.toISOString() ?? null,
      bookings: bookings.map((booking) => ({
        id: booking.id,
        guestName: booking.guestName,
        channelType: booking.channelType,
        status: booking.status,
        checkIn: dateOnly(booking.checkIn),
        checkOut: dateOnly(booking.checkOut),
        registrationStatus: registrationStatus(booking.invites)
      })),
      days: dates.map((date) => {
        const channels = byDate.get(date) ?? [];
        const airbnb = channels.find((day) => day.channelType === "airbnb");
        const recommended = recommendation.get(date);
        return {
          date,
          available:
            airbnb?.inventory === null || airbnb?.inventory === undefined ? null : airbnb.inventory > 0,
          airbnbPrice: airbnb?.price ?? null,
          recommendedPrice: recommended?.airbnbPrice ?? null,
          event: recommended?.event ?? null,
          reasons: Array.isArray(recommended?.reasons) ? recommended.reasons.map(String) : [],
          channels: channels.map((day) => ({
            channelType: day.channelType,
            listingId: day.listingId,
            price: day.price,
            inventory: day.inventory,
            restrictions: day.restrictions
          }))
        };
      })
    };
  }

  async sync(start: string, end: string) {
    const setting = await this.prisma.pricingSetting.findUnique({ where: { id: "primary" } });
    if (!setting) throw new Error("Pricing settings are missing");
    const config = pricingConfigSchema.parse(setting.config);
    const calendars = await this.hostex.getListingCalendars(start, end, config.listings);
    const syncedAt = new Date();
    const operations = calendars.flatMap((listing) =>
      (listing.calendar ?? []).map((day) =>
        this.prisma.hostexCalendarDay.upsert({
          where: {
            channelType_listingId_date: {
              channelType: listing.channel_type,
              listingId: listing.listing_id,
              date: dateValue(day.date)
            }
          },
          create: {
            channelType: listing.channel_type,
            listingId: listing.listing_id,
            date: dateValue(day.date),
            price: day.price ?? null,
            inventory: day.inventory ?? null,
            restrictions: (day.restrictions ?? undefined) as never,
            syncedAt
          },
          update: {
            price: day.price ?? null,
            inventory: day.inventory ?? null,
            restrictions: (day.restrictions ?? undefined) as never,
            syncedAt
          }
        })
      )
    );
    for (let index = 0; index < operations.length; index += 100) {
      await this.prisma.$transaction(operations.slice(index, index + 100));
    }
    return { ok: true, days: operations.length, syncedAt: syncedAt.toISOString() };
  }

  @Cron("17 * * * *", { timeZone: "Asia/Manila" })
  async hourlyFallback() {
    if (!process.env.HOSTEX_ACCESS_TOKEN) return;
    const today = localDate(new Date(), "Asia/Manila");
    await this.sync(today, addDays(today, 90));
  }
}

function registrationStatus(
  invites: Array<{
    status: string;
    expiresAt: Date;
    revokedAt: Date | null;
    submission: { status: string } | null;
  }>
) {
  const statuses = invites.flatMap((invite) =>
    invite.submission ? [String(invite.submission.status).toLowerCase()] : []
  );
  if (
    statuses.some((status) =>
      ["submitted", "submitted_email_failed", "submitted_email_sent"].includes(status)
    )
  )
    return "done";
  if (statuses.some((status) => ["ready_for_review", "queued", "submitting", "failed"].includes(status)))
    return "review";
  if (statuses.includes("rejected")) return "rejected";
  if (
    invites.some((invite) => invite.status === "OPEN" && !invite.revokedAt && invite.expiresAt > new Date())
  )
    return "pending";
  return "needs_registration";
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function dateValue(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function datesInRange(start: string, end: string) {
  const values: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) values.push(cursor);
  return values;
}
