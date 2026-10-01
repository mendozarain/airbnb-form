import { CalendarCheck, CalendarX2, Clock3, RefreshCw, Sparkles, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { BookingSummary, HostexAutomationStatus, PricingRun } from "@cozy-d-714/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { channelLabel, formatDate, registrationTone, statusLabel } from "@/lib/display";

export function OverviewPage() {
  const [bookings, setBookings] = useState<BookingSummary[]>([]);
  const [hostex, setHostex] = useState<HostexAutomationStatus | null>(null);
  const [pricingRun, setPricingRun] = useState<PricingRun | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
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
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => void load(), []);
  const attention = useMemo(
    () =>
      bookings.filter((booking) =>
        ["needs_registration", "review", "rejected"].includes(booking.registrationStatus)
      ),
    [bookings]
  );
  const bookedNights = bookings.reduce((total, booking) => {
    return (
      total +
      Math.max(0, Math.round((Date.parse(booking.checkOut) - Date.parse(booking.checkIn)) / 86_400_000))
    );
  }, 0);

  return (
    <div className="space-y-7">
      <PageHeader
        title="Operations overview"
        description="Bookings, guest registrations, messaging, and pricing in one place."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          tone="butter"
          icon={CalendarCheck}
          label="Upcoming bookings"
          value={loading ? "—" : String(bookings.length)}
          hint="Accepted and still to come"
        />
        <StatCard
          tone="sky"
          icon={Clock3}
          label="Needs attention"
          value={loading ? "—" : String(attention.length)}
          hint="Registration missing or under review"
        />
        <StatCard
          tone="mint"
          icon={TrendingUp}
          label="Booked nights"
          value={loading ? "—" : String(bookedNights)}
          hint="Across the next 12 months"
        />
        <StatCard
          tone="pink"
          icon={Sparkles}
          label="Hostex automation"
          value={hostex?.automationEnabled ? "On" : "Off"}
          hint={hostex?.webhookVerified ? "Webhook verified" : "Webhook pending"}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-hairline">
            <div>
              <CardTitle>Upcoming stays</CardTitle>
              <p className="text-sm text-ink-muted">The next accepted Hostex bookings</p>
            </div>
            <Button asChild variant="secondary" size="sm">
              <Link to="/admin/registrations">View all</Link>
            </Button>
          </CardHeader>
          <div className="divide-y divide-hairline">
            {bookings.slice(0, 6).map((booking) => (
              <Link
                key={booking.id}
                to={`/admin/bookings/${booking.id}`}
                className="grid gap-2 px-5 py-4 transition hover:bg-surface sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">
                    {booking.guestName || "Guest name unavailable"}
                  </p>
                  <p className="mt-1 text-sm text-ink-muted">
                    {formatDate(booking.checkIn)} – {formatDate(booking.checkOut)} ·{" "}
                    {channelLabel(booking.channelType)}
                  </p>
                </div>
                <Badge tone={registrationTone(booking.registrationStatus)}>
                  {statusLabel(booking.registrationStatus)}
                </Badge>
              </Link>
            ))}
            {!loading && bookings.length === 0 && (
              <EmptyState
                icon={CalendarX2}
                title="No upcoming stays yet"
                description="New accepted Hostex bookings will show up here."
                action={
                  <Button variant="secondary" size="sm" onClick={() => void load()}>
                    <RefreshCw className="size-4" />
                    Sync Hostex
                  </Button>
                }
              />
            )}
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <div>
            <CardTitle>System status</CardTitle>
            <p className="text-sm text-ink-muted">Production safeguards and recent activity</p>
          </div>
          <StatusLine
            label="Webhook"
            value={hostex?.webhookVerified ? "Verified" : "Pending"}
            good={Boolean(hostex?.webhookVerified)}
          />
          <StatusLine
            label="Guest messages"
            value={hostex?.automationEnabled ? "Automatic" : "Paused"}
            good={Boolean(hostex?.automationEnabled)}
          />
          <StatusLine
            label="Last pricing run"
            value={pricingRun ? statusLabel(pricingRun.status) : "No run yet"}
            good={pricingRun?.status === "submitted"}
          />
          <Button variant="secondary" className="w-full" onClick={() => void load()}>
            <RefreshCw className="size-4" />
            Refresh dashboard
          </Button>
        </Card>
      </div>
    </div>
  );
}

function StatusLine({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-surface px-3 py-3">
      <span className="text-sm text-ink-muted">{label}</span>
      <Badge tone={good ? "success" : "warning"}>{value}</Badge>
    </div>
  );
}
