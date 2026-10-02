import {
  CalendarX2,
  Inbox,
  MessageCircle,
  RefreshCw,
  Search,
  SearchX,
  TriangleAlert,
  UserRound
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { BookingSummary, InviteSummary, SettingsStatus } from "@cozy-d-714/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { LoadError, LoadingCard, LoadingChip } from "@/components/ui/loading";
import { Row } from "@/components/ui/row";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { useLoadingMessage } from "@/lib/use-loading";
import { channelLabel, formatDate, registrationTone, statusLabel } from "@/lib/display";

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
  const [debounced, setDebounced] = useState("");
  const [filter, setFilter] = useState<(typeof filters)[number]>("all");
  const [syncing, setSyncing] = useState(false);
  const [googleRecovery, setGoogleRecovery] = useState<SettingsStatus["googleRecovery"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settingsLoaded = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [bookingResult, inviteResult, settings] = await Promise.all([
        api.listBookings({ query: debounced }),
        api.listUncategorizedRegistrations(),
        settingsLoaded.current ? Promise.resolve(null) : api.getSettings()
      ]);
      setBookings(bookingResult.bookings);
      setUncategorized(inviteResult.registrations.map((registration) => registration.invite));
      if (settings) {
        setGoogleRecovery(settings.googleRecovery);
        settingsLoaded.current = true;
      }
      setLoaded(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load registrations");
    } finally {
      setLoading(false);
    }
  }, [debounced]);
  useEffect(() => void load(), [load]);

  const counts = useMemo(() => {
    const result: Record<string, number> = { all: bookings.length, uncategorized: uncategorized.length };
    for (const booking of bookings)
      result[booking.registrationStatus] = (result[booking.registrationStatus] ?? 0) + 1;
    return result;
  }, [bookings, uncategorized]);
  const shown = useMemo(
    () =>
      filter === "all" || filter === "uncategorized"
        ? bookings
        : bookings.filter((booking) => booking.registrationStatus === filter),
    [bookings, filter]
  );
  const refreshLabel = useLoadingMessage("Refreshing…", loading && loaded);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Registrations"
        description="Every guest link and submission, organized under its Hostex booking."
        actions={
          <Button
            variant="secondary"
            loading={syncing}
            loadingText="Syncing…"
            onClick={async () => {
              setSyncing(true);
              try {
                const result = await api.syncBookings();
                toast.success(`Synced ${result.found ?? 0} Hostex reservation(s); no messages were sent`);
                await load();
              } catch (reason) {
                toast.error(reason instanceof Error ? reason.message : "Sync failed");
              } finally {
                setSyncing(false);
              }
            }}
          >
            <MessageCircle className="size-4" />
            Sync Hostex
          </Button>
        }
      />

      {googleRecovery && googleRecovery.state !== "idle" && (
        <Row
          icon={TriangleAlert}
          iconTone="orange"
          title={
            googleRecovery.state === "recovering"
              ? "Reconnecting Google"
              : "Waiting for manual Google session"
          }
          meta="Queued registrations are held safely and resume oldest-first once the PMO form session is verified."
        />
      )}

      {error && !loaded ? (
        <LoadError message={error} onRetry={() => void load()} />
      ) : !loaded ? (
        <LoadingCard label="Loading registrations…" rows={5} />
      ) : (
        <Card className="relative overflow-hidden">
          {loading && <div className="sg-loadbar" aria-hidden="true" />}
          <CardHeader className="flex-col gap-4 sm:flex-row sm:items-center">
            <div className="relative w-full flex-1">
              <Search
                className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
                aria-hidden="true"
              />
              <Input
                className="pl-11"
                aria-label="Search registrations"
                placeholder="Search guest, email, or reservation…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {loading ? (
              <LoadingChip label={refreshLabel} />
            ) : (
              <Button size="icon" variant="secondary" aria-label="Refresh" onClick={() => void load()}>
                <RefreshCw className="size-4" />
              </Button>
            )}
          </CardHeader>
          <div className="flex gap-2 overflow-x-auto px-5 pb-4 sm:px-6">
            {filters.map((value) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
                className={`h-10 shrink-0 whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors ${filter === value ? "bg-primary text-on-primary" : "bg-surface-sunken text-ink-muted hover:text-ink"}`}
              >
                {statusLabel(value)}
                {counts[value] ? <span className="ml-1.5 text-mono opacity-70">{counts[value]}</span> : null}
              </button>
            ))}
          </div>
          <CardBody>
            {filter === "uncategorized" ? (
              <Uncategorized invites={uncategorized} bookings={bookings} onAssigned={load} />
            ) : (
              <div className="grid gap-3">
                {shown.map((booking, index) => (
                  <Row
                    key={booking.id}
                    index={index}
                    to={`/admin/bookings/${booking.id}`}
                    icon={UserRound}
                    title={booking.guestName || "Guest name unavailable"}
                    meta={
                      <>
                        {channelLabel(booking.channelType)} ·{" "}
                        <span className="text-mono">{booking.reservationCode}</span>
                        <br />
                        {formatDate(booking.checkIn)} – {formatDate(booking.checkOut)}
                      </>
                    }
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
                {shown.length === 0 && (
                  <EmptyState
                    icon={query ? SearchX : CalendarX2}
                    title={query ? `No matches for "${query}"` : "Nothing in this view"}
                    description={
                      query
                        ? "Try a different word or clear your filters."
                        : "Try a different filter to see more bookings."
                    }
                    action={
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setFilter("all");
                          setQuery("");
                        }}
                      >
                        Clear filters
                      </Button>
                    }
                  />
                )}
              </div>
            )}
          </CardBody>
        </Card>
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
    <div>
      <CardTitle className="text-heading-s">Uncategorized legacy links</CardTitle>
      <CardDescription className="mb-4">
        Records without one exact Hostex guest-and-date match remain here.
      </CardDescription>
      <div className="grid gap-3">
        {invites.map((invite) => (
          <UncategorizedRow key={invite.id} invite={invite} bookings={bookings} onAssigned={onAssigned} />
        ))}
        {invites.length === 0 && (
          <EmptyState
            icon={Inbox}
            tone="done"
            title="You're all caught up"
            description="Every guest link is matched to a booking."
          />
        )}
      </div>
    </div>
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
  const [assigning, setAssigning] = useState(false);
  return (
    <div className="sg-row flex flex-col gap-3 rounded-lg bg-surface-sunken p-4 sm:p-5 lg:flex-row lg:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-title text-ink">{invite.purpose}</p>
        <p className="text-sm text-ink-muted">
          {formatDate(invite.checkIn)} – {formatDate(invite.checkOut)}
        </p>
      </div>
      <Badge>{statusLabel(invite.status)}</Badge>
      {candidates.length > 0 && (
        <div className="flex gap-2">
          <Select
            className="h-10 max-w-64 text-sm"
            aria-label="Booking"
            value={bookingId}
            onChange={(event) => setBookingId(event.target.value)}
          >
            {candidates.map((booking) => (
              <option key={booking.id} value={booking.id}>
                {booking.guestName || booking.reservationCode}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            loading={assigning}
            loadingText="Assigning…"
            onClick={async () => {
              setAssigning(true);
              try {
                await api.assignInviteBooking(invite.id, bookingId);
                toast.success("Registration assigned to booking");
                await onAssigned();
              } catch (reason) {
                toast.error(reason instanceof Error ? reason.message : "Could not assign");
              } finally {
                setAssigning(false);
              }
            }}
          >
            Assign
          </Button>
        </div>
      )}
    </div>
  );
}
