import { MessageCircle, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import type { BookingSummary, InviteSummary } from "@cozy-d-714/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { channelLabel, formatDate, statusLabel } from "@/lib/display";

const filters = [
  "all",
  "needs_registration",
  "pending",
  "review",
  "done",
  "rejected",
  "uncategorized"
] as const;

export function RegistrationsPage() {
  const [bookings, setBookings] = useState<BookingSummary[]>([]);
  const [uncategorized, setUncategorized] = useState<InviteSummary[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof filters)[number]>("all");
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const [bookingResult, inviteResult] = await Promise.all([
      api.listBookings({ query }),
      api.listUncategorizedRegistrations()
    ]);
    setBookings(bookingResult.bookings);
    setUncategorized(inviteResult.registrations.map((registration) => registration.invite));
  }, [query]);
  useEffect(() => void load(), [load]);
  const shown = useMemo(
    () =>
      filter === "all" || filter === "uncategorized"
        ? bookings
        : bookings.filter((booking) => booking.registrationStatus === filter),
    [bookings, filter]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Registrations"
        description="Every guest link and submission, organized under its Hostex booking."
      />
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 size-4 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Search guest, email, or reservation…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Button
            variant="secondary"
            disabled={syncing}
            onClick={async () => {
              setSyncing(true);
              try {
                const result = await api.syncBookings();
                toast.success(`Synced ${result.found ?? 0} Hostex reservation(s); no messages were sent`);
                await load();
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Sync failed");
              } finally {
                setSyncing(false);
              }
            }}
          >
            <MessageCircle className="size-4" />
            {syncing ? "Syncing…" : "Sync Hostex"}
          </Button>
          <Button size="icon" variant="ghost" aria-label="Refresh" onClick={() => void load()}>
            <RefreshCw className="size-4" />
          </Button>
        </div>
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {filters.map((value) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition ${filter === value ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              {statusLabel(value)}
            </button>
          ))}
        </div>
      </section>
      {filter === "uncategorized" ? (
        <Uncategorized invites={uncategorized} bookings={bookings} onAssigned={load} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {shown.map((booking) => (
            <Link
              key={booking.id}
              to={`/admin/bookings/${booking.id}`}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold text-slate-950">
                    {booking.guestName || "Guest name unavailable"}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {channelLabel(booking.channelType)} · {booking.reservationCode}
                  </p>
                </div>
                <Badge>{statusLabel(booking.registrationStatus)}</Badge>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm">
                <div>
                  <p className="text-xs text-slate-400">Check-in</p>
                  <p className="mt-1 font-medium text-slate-800">{formatDate(booking.checkIn)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Check-out</p>
                  <p className="mt-1 font-medium text-slate-800">{formatDate(booking.checkOut)}</p>
                </div>
              </div>
              <p className="mt-4 text-xs text-slate-500">
                {booking.registrationCount} registration record(s) ·{" "}
                {booking.conversationId ? "Hostex conversation ready" : "No Hostex conversation"}
              </p>
            </Link>
          ))}
          {shown.length === 0 && (
            <p className="col-span-full rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
              No bookings match this view.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Uncategorized({
  invites,
  bookings,
  onAssigned
}: {
  invites: InviteSummary[];
  bookings: BookingSummary[];
  onAssigned: () => Promise<void>;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-5">
        <h2 className="font-semibold text-slate-950">Uncategorized legacy links</h2>
        <p className="text-sm text-slate-500">
          Records without one exact Hostex guest-and-date match remain here.
        </p>
      </div>
      <div className="divide-y divide-slate-100">
        {invites.map((invite) => (
          <UncategorizedRow key={invite.id} invite={invite} bookings={bookings} onAssigned={onAssigned} />
        ))}
        {invites.length === 0 && (
          <p className="p-10 text-center text-sm text-slate-500">No uncategorized records.</p>
        )}
      </div>
    </section>
  );
}

function UncategorizedRow({
  invite,
  bookings,
  onAssigned
}: {
  invite: InviteSummary;
  bookings: BookingSummary[];
  onAssigned: () => Promise<void>;
}) {
  const candidates = bookings.filter(
    (booking) => booking.checkIn === invite.checkIn && booking.checkOut === invite.checkOut
  );
  const [bookingId, setBookingId] = useState(candidates[0]?.id ?? "");
  return (
    <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-slate-900">{invite.purpose}</p>
        <p className="text-sm text-slate-500">
          {formatDate(invite.checkIn)} – {formatDate(invite.checkOut)}
        </p>
      </div>
      <Badge>{statusLabel(invite.status)}</Badge>
      {candidates.length > 0 && (
        <div className="flex gap-2">
          <select
            className="h-9 max-w-64 rounded-md border border-slate-300 bg-white px-2 text-xs"
            value={bookingId}
            onChange={(event) => setBookingId(event.target.value)}
          >
            {candidates.map((booking) => (
              <option key={booking.id} value={booking.id}>
                {booking.guestName || booking.reservationCode}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await api.assignInviteBooking(invite.id, bookingId);
              toast.success("Registration assigned to booking");
              await onAssigned();
            }}
          >
            Assign
          </Button>
        </div>
      )}
    </div>
  );
}
