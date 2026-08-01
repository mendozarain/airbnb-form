import { AlertTriangle, CalendarCheck, CheckCircle2, Clock3, RefreshCw, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { BookingSummary, HostexAutomationStatus, PricingRun } from "@cozy-d-714/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { channelLabel, formatDate, statusLabel } from "@/lib/display";

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
        <Stat
          icon={CalendarCheck}
          label="Upcoming bookings"
          value={loading ? "—" : String(bookings.length)}
          tone="emerald"
        />
        <Stat
          icon={Clock3}
          label="Needs attention"
          value={loading ? "—" : String(attention.length)}
          tone="amber"
        />
        <Stat
          icon={TrendingUp}
          label="Booked nights"
          value={loading ? "—" : String(bookedNights)}
          tone="blue"
        />
        <Stat
          icon={hostex?.webhookVerified ? CheckCircle2 : AlertTriangle}
          label="Hostex automation"
          value={hostex?.automationEnabled ? "On" : "Off"}
          tone={hostex?.automationEnabled ? "emerald" : "slate"}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="font-semibold text-slate-950">Upcoming stays</h2>
              <p className="text-sm text-slate-500">The next accepted Hostex bookings</p>
            </div>
            <Button asChild variant="secondary" size="sm">
              <Link to="/admin/registrations">View all</Link>
            </Button>
          </div>
          <div className="divide-y divide-slate-100">
            {bookings.slice(0, 6).map((booking) => (
              <Link
                key={booking.id}
                to={`/admin/bookings/${booking.id}`}
                className="grid gap-2 px-5 py-4 transition hover:bg-slate-50 sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">
                    {booking.guestName || "Guest name unavailable"}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {formatDate(booking.checkIn)} – {formatDate(booking.checkOut)} ·{" "}
                    {channelLabel(booking.channelType)}
                  </p>
                </div>
                <Badge>{statusLabel(booking.registrationStatus)}</Badge>
              </Link>
            ))}
            {!loading && bookings.length === 0 && (
              <p className="p-8 text-center text-sm text-slate-500">No upcoming bookings have been synced.</p>
            )}
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <h2 className="font-semibold text-slate-950">System status</h2>
            <p className="text-sm text-slate-500">Production safeguards and recent activity</p>
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
        </section>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone
}: {
  icon: typeof CalendarCheck;
  label: string;
  value: string;
  tone: string;
}) {
  const tones: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    blue: "bg-blue-50 text-blue-700",
    slate: "bg-slate-100 text-slate-600"
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className={`mb-4 flex size-10 items-center justify-center rounded-lg ${tones[tone]}`}>
        <Icon className="size-5" />
      </div>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function StatusLine({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-3">
      <span className="text-sm text-slate-600">{label}</span>
      <span className={`text-sm font-medium ${good ? "text-emerald-700" : "text-amber-700"}`}>{value}</span>
    </div>
  );
}
