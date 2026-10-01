import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, CalendarDays } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { CalendarDay, CalendarMonth } from "@cozy-d-714/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { channelLabel, formatDate, money, registrationTone, statusLabel } from "@/lib/display";

export function CalendarPage() {
  const [month, setMonth] = useState(() => firstOfMonth(new Date()));
  const [data, setData] = useState<CalendarMonth | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const range = useMemo(() => calendarRange(month), [month]);

  const load = useCallback(
    async (force = false) => {
      setLoading(true);
      setError(null);
      try {
        if (force) await api.syncCalendar(range.start, range.end);
        const result = await api.getCalendar(range.start, range.end);
        setData(result);
        setSelected((current) => current ?? result.days.find((day) => day.date >= month)?.date ?? null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Calendar could not be loaded");
      } finally {
        setLoading(false);
      }
    },
    [month, range.end, range.start]
  );

  useEffect(() => void load(), [load]);
  const selectedDay = data?.days.find((day) => day.date === selected) ?? null;
  const selectedBookings =
    data?.bookings.filter(
      (booking) => selected && booking.checkIn <= selected && booking.checkOut > selected
    ) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        description="Bookings, availability, live channel prices, and registration readiness."
      />
      <div className="rounded-xl border border-hairline bg-surface-raised shadow-sm">
        <div className="flex items-center justify-between border-b border-hairline p-4">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Previous month"
            onClick={() => setMonth(addMonths(month, -1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <div className="text-center">
            <h2 className="font-semibold text-ink">
              {formatDate(month, { month: "long", year: "numeric", day: undefined })}
            </h2>
            <p className="text-xs text-ink-muted">Asia/Manila</p>
          </div>
          <div className="flex gap-1">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Refresh calendar"
              disabled={loading}
              onClick={() => void load(true)}
            >
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Next month"
              onClick={() => setMonth(addMonths(month, 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

        <div className="hidden grid-cols-7 border-b border-hairline bg-surface text-center text-xs font-medium uppercase tracking-wide text-ink-muted sm:grid">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
            <div key={day} className="py-2">
              {day}
            </div>
          ))}
        </div>
        {(error || data?.warning) && (
          <div className="flex items-center justify-between gap-4 border-b border-butter bg-butter/40 px-4 py-3 text-sm text-ink">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0" />
              <span>{error ?? data?.warning}</span>
            </div>
            <Button size="sm" variant="secondary" disabled={loading} onClick={() => void load()}>
              Retry
            </Button>
          </div>
        )}
        {loading && !data && !error && (
          <div className="p-10 text-center text-sm text-ink-muted">Loading calendar…</div>
        )}
        <div className="hidden grid-cols-7 sm:grid">
          {data?.days.map((day) => {
            const bookings = data.bookings.filter(
              (booking) => booking.checkIn <= day.date && booking.checkOut > day.date
            );
            const inMonth = day.date.slice(0, 7) === month.slice(0, 7);
            return (
              <button
                key={day.date}
                onClick={() => setSelected(day.date)}
                className={`min-h-28 border-b border-r border-hairline p-2 text-left transition hover:bg-success/10/40 ${!inMonth ? "bg-surface/70 text-ink-muted" : ""} ${selected === day.date ? "ring-2 ring-inset ring-success" : ""}`}
              >
                <div className="flex items-start justify-between gap-1">
                  <span className="text-xs font-medium">{Number(day.date.slice(-2))}</span>
                  <span className="text-[11px] font-semibold text-ink-muted">{money(day.airbnbPrice)}</span>
                </div>
                {day.event && <p className="mt-1 truncate text-[10px] font-medium text-ink">{day.event}</p>}
                <div className="mt-2 space-y-1">
                  {bookings.slice(0, 2).map((booking) => (
                    <div
                      key={booking.id}
                      className="truncate rounded bg-ink px-1.5 py-1 text-[10px] font-medium text-white"
                    >
                      {booking.guestName || channelLabel(booking.channelType)}
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </div>

        <div className="divide-y divide-hairline sm:hidden">
          {data?.days
            .filter((day) => day.date.slice(0, 7) === month.slice(0, 7))
            .map((day) => {
              const bookings = data.bookings.filter(
                (booking) => booking.checkIn <= day.date && booking.checkOut > day.date
              );
              return (
                <button
                  key={day.date}
                  onClick={() => setSelected(day.date)}
                  className="flex w-full items-center gap-3 p-4 text-left"
                >
                  <div className="w-14">
                    <p className="text-xs uppercase text-ink-muted">{weekday(day.date)}</p>
                    <p className="text-xl font-semibold text-ink">{Number(day.date.slice(-2))}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {bookings.length
                        ? bookings
                            .map((booking) => booking.guestName || channelLabel(booking.channelType))
                            .join(", ")
                        : day.available === false
                          ? "Unavailable"
                          : "Available"}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {money(day.airbnbPrice)}
                      {day.event ? ` · ${day.event}` : ""}
                    </p>
                  </div>
                </button>
              );
            })}
        </div>
      </div>

      {selectedDay && <DayDetails day={selectedDay} bookings={selectedBookings} />}
    </div>
  );
}

function DayDetails({ day, bookings }: { day: CalendarDay; bookings: CalendarMonth["bookings"] }) {
  return (
    <section className="grid gap-5 rounded-xl border border-hairline bg-surface-raised p-5 shadow-sm lg:grid-cols-[1fr_1.2fr]">
      <div>
        <p className="text-sm text-ink-muted">Selected date</p>
        <h2 className="mt-1 text-xl font-semibold text-ink">{formatDate(day.date, { weekday: "long" })}</h2>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Metric label="Airbnb price" value={money(day.airbnbPrice)} />
          <Metric label="Recommendation" value={money(day.recommendedPrice)} />
        </div>
        {day.reasons.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {day.reasons.map((reason) => (
              <Badge key={reason}>{reason}</Badge>
            ))}
          </div>
        )}
        <div className="mt-4 space-y-2">
          {day.channels.map((channel) => (
            <div
              key={`${channel.channelType}-${channel.listingId}`}
              className="flex justify-between rounded-lg bg-surface px-3 py-2 text-sm"
            >
              <span>{channelLabel(channel.channelType)}</span>
              <span className="font-medium">
                {money(channel.price)} · {channel.inventory ?? "—"} room
              </span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3 className="font-semibold text-ink">Bookings</h3>
        <div className="mt-3 space-y-2">
          {bookings.map((booking) => (
            <Link
              key={booking.id}
              to={`/admin/bookings/${booking.id}`}
              className="block rounded-lg border border-hairline p-3 transition hover:border-success/30 hover:bg-success/10/40"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-ink">{booking.guestName || "Guest"}</p>
                <Badge tone={registrationTone(booking.registrationStatus)}>
                  {statusLabel(booking.registrationStatus)}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-ink-muted">
                {channelLabel(booking.channelType)} · {formatDate(booking.checkIn)} –{" "}
                {formatDate(booking.checkOut)}
              </p>
            </Link>
          ))}
          {bookings.length === 0 && (
            <EmptyState
              size="sm"
              icon={CalendarDays}
              title="Free night"
              description="No booking occupies this date."
            />
          )}
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface p-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-1 font-semibold text-ink">{value}</p>
    </div>
  );
}
function firstOfMonth(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
function addMonths(value: string, months: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return firstOfMonth(date);
}
function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function calendarRange(month: string) {
  const first = new Date(`${month}T00:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7;
  const start = addDays(month, -offset);
  const next = addMonths(month, 1);
  const last = addDays(next, -1);
  const end = addDays(last, 6 - ((new Date(`${last}T00:00:00Z`).getUTCDay() + 6) % 7));
  return { start, end };
}
function weekday(value: string) {
  return new Intl.DateTimeFormat("en-AU", { weekday: "short", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`)
  );
}
