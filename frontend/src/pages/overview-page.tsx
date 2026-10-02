import { CalendarCheck, CalendarX2, CircleCheck, Clock3, RefreshCw, Webhook } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { BookingSummary, HostexAutomationStatus, PricingRun } from "@cozy-d-714/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError, LoadingCard, LoadingChip } from "@/components/ui/loading";
import { Row } from "@/components/ui/row";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusHero } from "@/components/ui/status-hero";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { useLoadingMessage } from "@/lib/use-loading";
import { channelLabel, formatDate, registrationTone, statusLabel } from "@/lib/display";

export function OverviewPage() {
  const [bookings, setBookings] = useState<BookingSummary[]>([]);
  const [hostex, setHostex] = useState<HostexAutomationStatus | null>(null);
  const [pricingRun, setPricingRun] = useState<PricingRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const today = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
    try {
      const [bookingResult, hostexStatus, pricing] = await Promise.all([
        api.listBookings({ start: today, end, status: "accepted" }),
        api.getHostexStatus(),
        api.listPricingRuns()
      ]);
      setBookings(bookingResult.bookings);
      setHostex(hostexStatus);
      setPricingRun(pricing.runs[0] ?? null);
      setLoaded(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load the overview");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);
  const message = useLoadingMessage("Loading your overview…", loading);
  const attention = useMemo(
    () =>
      bookings.filter((booking) =>
        ["needs_registration", "review", "rejected"].includes(booking.registrationStatus)
      ),
    [bookings]
  );
  const bookedNights = bookings.reduce(
    (total, booking) =>
      total +
      Math.max(0, Math.round((Date.parse(booking.checkOut) - Date.parse(booking.checkIn)) / 86_400_000)),
    0
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations overview"
        description="Bookings, guest registrations, messaging, and pricing in one place."
      />

      {error && !loaded ? (
        <LoadError message={error} onRetry={() => void load()} />
      ) : !loaded ? (
        <div className="space-y-5">
          <section aria-busy="true" className="relative overflow-hidden rounded-xl bg-yellow p-3 sm:p-4">
            <div className="sg-loadbar" aria-hidden="true" />
            <div className="mb-3 flex items-center justify-between">
              <LoadingChip label={message} className="h-11 bg-surface-raised px-4" />
            </div>
            <div className="space-y-4 rounded-lg bg-yellow-soft p-5 sm:p-6">
              <Skeleton className="h-8 w-2/3 bg-yellow/50" />
              <Skeleton className="h-4 w-1/3 bg-yellow/50" />
              <Skeleton shape="block" className="mt-4 h-16 w-full bg-yellow/40" />
            </div>
          </section>
          <LoadingCard label="Loading upcoming stays…" rows={4} />
        </div>
      ) : (
        <>
          <StatusHero
            plain={attention.length === 0}
            chipIcon={attention.length === 0 ? CircleCheck : Clock3}
            chip={attention.length === 0 ? "All on track" : "Needs attention"}
            title={
              attention.length === 0
                ? "Every upcoming guest is registered"
                : `${attention.length} registration${attention.length === 1 ? " needs" : "s need"} attention`
            }
            sub={
              attention.length === 0 ? "Nothing to review right now." : "Missing, under review or rejected"
            }
            stats={[
              { label: "Upcoming bookings", value: String(bookings.length) },
              { label: "Needs attention", value: String(attention.length) },
              { label: "Booked nights", value: String(bookedNights) }
            ]}
            action={
              <Button
                size="icon"
                variant="secondary"
                aria-label="Refresh dashboard"
                loading={loading}
                onClick={() => void load()}
              >
                {!loading && <RefreshCw className="size-4" />}
              </Button>
            }
          />

          <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
            <Card className="relative overflow-hidden">
              {loading && <div className="sg-loadbar" aria-hidden="true" />}
              <CardHeader>
                <div>
                  <CardTitle>Upcoming stays</CardTitle>
                  <CardDescription>The next accepted Hostex bookings</CardDescription>
                </div>
                <Button asChild variant="secondary" size="sm">
                  <Link to="/admin/registrations">View all</Link>
                </Button>
              </CardHeader>
              <CardBody className="grid gap-3">
                {bookings.slice(0, 6).map((booking, index) => (
                  <Row
                    key={booking.id}
                    index={index}
                    to={`/admin/bookings/${booking.id}`}
                    title={booking.guestName || "Guest name unavailable"}
                    meta={`${formatDate(booking.checkIn)} – ${formatDate(booking.checkOut)} · ${channelLabel(booking.channelType)}`}
                    trailing={
                      <Badge
                        tone={registrationTone(booking.registrationStatus)}
                        dot
                        live={booking.registrationStatus === "pending"}
                      >
                        {statusLabel(booking.registrationStatus)}
                      </Badge>
                    }
                  />
                ))}
                {bookings.length === 0 && (
                  <EmptyState
                    icon={CalendarX2}
                    title="No upcoming stays yet"
                    description="New accepted Hostex bookings will show up here."
                    action={
                      <Button variant="secondary" size="sm" onClick={() => void load()}>
                        <RefreshCw className="size-4" />
                        Refresh
                      </Button>
                    }
                  />
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>System status</CardTitle>
                  <CardDescription>Production safeguards and recent activity</CardDescription>
                </div>
              </CardHeader>
              <CardBody className="grid gap-3">
                <StatusLine
                  icon={Webhook}
                  label="Webhook"
                  value={hostex?.webhookVerified ? "Verified" : "Pending"}
                  good={Boolean(hostex?.webhookVerified)}
                />
                <StatusLine
                  icon={CalendarCheck}
                  label="Guest messages"
                  value={hostex?.automationEnabled ? "Automatic" : "Paused"}
                  good={Boolean(hostex?.automationEnabled)}
                />
                <StatusLine
                  icon={Clock3}
                  label="Last pricing run"
                  value={pricingRun ? statusLabel(pricingRun.status) : "No run yet"}
                  good={pricingRun?.status === "submitted"}
                />
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function StatusLine({
  icon,
  label,
  value,
  good
}: {
  icon: typeof Webhook;
  label: string;
  value: string;
  good: boolean;
}) {
  return (
    <Row icon={icon} title={label} trailing={<Badge tone={good ? "done" : "attention"}>{value}</Badge>} />
  );
}
