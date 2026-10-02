import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, CalendarDays } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CalendarDay, CalendarMonth } from "@cozy-d-714/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingChip, SkeletonRows } from "@/components/ui/loading";
import { Row } from "@/components/ui/row";
import { StatGrid } from "@/components/ui/stat-grid";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { useLoadingMessage } from "@/lib/use-loading";
import { channelLabel, formatDate, money, registrationTone, statusLabel } from "@/lib/display";

export function CalendarPage() {
  const [month, setMonth] = useState(() => firstOfMonth(new Date()));
  const [data, setData] = useState<CalendarMonth | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const message = useLoadingMessage("Loading calendar…", loading);
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
      <div className="relative overflow-hidden rounded-xl bg-surface-raised" aria-busy={loading}>
        {loading && <div className="sg-loadbar" aria-hidden="true" />}
        <div className="flex items-center justify-between gap-3 p-4 sm:p-5">
          <Button
            size="icon"
            variant="secondary"
            aria-label="Previous month"
            onClick={() => setMonth(addMonths(month, -1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <div className="text-center">
            <h2 className="text-heading-s text-ink sm:text-heading-l">
              {formatDate(month, { month: "long", year: "numeric", day: undefined })}
            </h2>
            <p className="text-mono text-ink-muted">Asia/Manila</p>
          </div>
          <div className="flex gap-1">
            <Button
              size="icon"
              variant="secondary"
              aria-label="Refresh calendar"
              loading={loading}
              onClick={() => void load(true)}
            >
              {!loading && <RefreshCw className="size-4" />}
            </Button>
            <Button
              size="icon"
              variant="secondary"
              aria-label="Next month"
              onClick={() => setMonth(addMonths(month, 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

        <div className="hidden grid-cols-7 border-y border-hairline bg-surface-sunken text-center text-sm font-medium text-ink-muted sm:grid">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
            <div key={day} className="py-2">
              {day}
            </div>
          ))}
        </div>
        {(error || data?.warning) && (
          <div className="flex items-center justify-between gap-4 border-b bg-yellow-soft px-4 py-3 text-sm text-ink">
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
          <div className="space-y-4 p-5">
            <LoadingChip label={message} />
            <SkeletonRows rows={5} />
          </div>
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
                className={`min-h-28 border-b border-r border-hairline p-2 text-left transition hover:bg-surface-sunken ${!inMonth ? "bg-surface-sunken/60 text-ink-muted" : ""} ${selected === day.date ? "ring-2 ring-inset ring-primary" : ""}`}
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
                      className="truncate rounded-full bg-primary px-2 py-1 text-[10px] font-medium text-on-primary"
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
    <section className="sg-enter grid gap-6 rounded-xl bg-surface-raised p-5 sm:p-6 lg:grid-cols-[1fr_1.2fr]">
      <div>
        <p className="text-sm text-ink-muted">Selected date</p>
        <h2 className="mt-1 text-heading-l">{formatDate(day.date, { weekday: "long" })}</h2>
        <StatGrid
          className="mt-4"
          items={[
            { label: "Airbnb price", value: money(day.airbnbPrice) },
            { label: "Recommendation", value: money(day.recommendedPrice) }
          ]}
        />
        {day.reasons.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {day.reasons.map((reason) => (
              <Badge key={reason}>{reason}</Badge>
            ))}
          </div>
        )}
        <div className="mt-4 grid gap-2">
          {day.channels.map((channel) => (
            <Row
              key={`${channel.channelType}-${channel.listingId}`}
              title={channelLabel(channel.channelType)}
              trailing={
                <span className="text-mono text-ink">
                  {money(channel.price)} · {channel.inventory ?? "—"} room
                </span>
              }
            />
          ))}
        </div>
      </div>
      <div>
        <h3 className="text-heading-s text-ink">Bookings</h3>
        <div className="mt-3 grid gap-3">
          {bookings.map((booking, index) => (
            <Row
              key={booking.id}
              index={index}
              to={`/admin/bookings/${booking.id}`}
              title={booking.guestName || "Guest"}
              meta={`${channelLabel(booking.channelType)} · ${formatDate(booking.checkIn)} – ${formatDate(booking.checkOut)}`}
              trailing={
                <Badge tone={registrationTone(booking.registrationStatus)}>
                  {statusLabel(booking.registrationStatus)}
                </Badge>
              }
            />
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
