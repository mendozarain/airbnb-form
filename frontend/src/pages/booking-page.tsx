import { ArrowLeft, Copy, Edit3, ExternalLink, Plus, RefreshCw, RotateCcw, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { PURPOSES, type BookingDetail, type Purpose } from "@cozy-d-714/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { channelLabel, formatDate, formatDateTime, statusLabel } from "@/lib/display";

export function BookingPage() {
  const { id = "" } = useParams();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [purpose, setPurpose] = useState<Purpose>("Visitor of Tenant");
  const [expiresAt, setExpiresAt] = useState(() =>
    new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 16)
  );
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setBooking((await api.getBooking(id)).booking);
  }, [id]);

  useEffect(() => void load(), [load]);

  if (!booking) return <p className="p-10 text-center text-sm text-slate-500">Loading booking…</p>;

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
          <Link to="/admin/registrations">
            <ArrowLeft className="size-4" /> Registrations
          </Link>
        </Button>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-slate-950">{booking.guestName || "Guest"}</h1>
              <Badge>{channelLabel(booking.channelType)}</Badge>
              <Badge>{statusLabel(booking.status)}</Badge>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              {formatDate(booking.checkIn)} – {formatDate(booking.checkOut)} · {booking.reservationCode}
            </p>
          </div>
          <Button variant="secondary" onClick={() => void load()}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-slate-950">Registration history</h2>
            <p className="text-sm text-slate-500">
              Links, submissions, and every send attempt are preserved.
            </p>
          </div>
          {booking.registrations.map((registration) => (
            <RegistrationCard
              key={registration.invite.id}
              registration={registration}
              conversationReady={Boolean(booking.conversationId)}
              onChanged={load}
            />
          ))}
          {booking.registrations.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
              No links exist for this booking.
            </p>
          )}
        </section>

        <aside className="space-y-5">
          <form
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            onSubmit={async (event) => {
              event.preventDefault();
              setCreating(true);
              try {
                const result = await api.createBookingInvite(booking.id, {
                  purpose,
                  expiresAt: new Date(expiresAt).toISOString()
                });
                await navigator.clipboard.writeText(result.guestUrl);
                toast.success("New link created and copied; it was not sent");
                await load();
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Could not create link");
              } finally {
                setCreating(false);
              }
            }}
          >
            <div className="flex items-center gap-2">
              <Plus className="size-4 text-emerald-700" />
              <h2 className="font-semibold text-slate-950">Create booking link</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">Dates come from Hostex. Creating never sends.</p>
            <div className="mt-4 space-y-2">
              <Label htmlFor="booking-purpose">Purpose</Label>
              <select
                id="booking-purpose"
                value={purpose}
                onChange={(event) => setPurpose(event.target.value as Purpose)}
                className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
              >
                {PURPOSES.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </div>
            <div className="mt-4 space-y-2">
              <Label htmlFor="booking-expiry">Expires</Label>
              <Input
                id="booking-expiry"
                type="datetime-local"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            </div>
            <Button className="mt-4 w-full" disabled={creating}>
              <Plus className="size-4" /> {creating ? "Creating…" : "Create and copy"}
            </Button>
          </form>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-slate-950">Booking details</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <Info label="Email" value={booking.guestEmail || "Unavailable"} />
              <Info label="Phone" value={booking.guestPhone || "Unavailable"} />
              <Info label="Guests" value={String(booking.numberOfGuests ?? "—")} />
              <Info label="Conversation" value={booking.conversationId ? "Ready" : "Missing"} />
              <Info label="Last synced" value={formatDateTime(booking.lastSyncedAt)} />
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}

function RegistrationCard({
  registration,
  conversationReady,
  onChanged
}: {
  registration: BookingDetail["registrations"][number];
  conversationReady: boolean;
  onChanged: () => Promise<void>;
}) {
  const invite = registration.invite;
  const manualDeliveries = registration.deliveries.filter((delivery) => delivery.kind === "manual");
  const latestManual = manualDeliveries[manualDeliveries.length - 1];
  const automationManaged = registration.deliveries.some((delivery) => delivery.kind === "automated");
  const active = invite.status === "open";
  const editable = active && !automationManaged;
  const canReconcile = latestManual && ["sending", "sent", "unknown"].includes(latestManual.status);
  const [acting, setActing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [purpose, setPurpose] = useState<Purpose>(invite.purpose);
  const [expiresAt, setExpiresAt] = useState(() => new Date(invite.expiresAt).toISOString().slice(0, 16));

  async function action(work: () => Promise<unknown>, message: string) {
    setActing(true);
    try {
      await work();
      toast.success(message);
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
    } finally {
      setActing(false);
    }
  }

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-slate-950">{invite.purpose}</h3>
            <Badge>{statusLabel(registration.submission?.status || invite.status)}</Badge>
            {automationManaged && (
              <Badge className="border border-slate-200 bg-white text-slate-600">Scheduled Tenant</Badge>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Created {formatDateTime(invite.createdAt)} · expires {formatDateTime(invite.expiresAt)}
          </p>
          {registration.deliveries.map((delivery) => (
            <p key={delivery.id} className="mt-2 text-xs text-slate-500">
              {statusLabel(delivery.kind)} delivery: {statusLabel(delivery.status)}
              {delivery.lastError ? ` · ${delivery.lastError}` : ""}
            </p>
          ))}
        </div>

        <div className="flex flex-wrap gap-1">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Copy link"
            disabled={!invite.guestUrl}
            onClick={() => {
              if (invite.guestUrl) {
                void navigator.clipboard.writeText(invite.guestUrl);
                toast.success("Link copied");
              }
            }}
          >
            <Copy className="size-4" />
          </Button>
          {editable && (
            <Button size="icon" variant="ghost" aria-label="Edit link" onClick={() => setEditing(!editing)}>
              <Edit3 className="size-4" />
            </Button>
          )}
          {registration.submission && (
            <Button asChild size="icon" variant="ghost" aria-label="Open registration">
              <Link to={`/admin/submissions/${registration.submission.id}`}>
                <ExternalLink className="size-4" />
              </Link>
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="Regenerate link" disabled={acting}>
                <RotateCcw className="size-4 text-amber-600" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>Regenerate this link?</AlertDialogTitle>
              <AlertDialogDescription>
                The old URL will return 410. History is preserved, scheduled sending is suppressed, and the
                new URL will not be sent automatically.
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    void action(async () => {
                      const result = await api.regenerateInvite(invite.id);
                      await navigator.clipboard.writeText(result.guestUrl);
                    }, "New link created and copied")
                  }
                >
                  Regenerate
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {canReconcile && (
            <Button
              size="icon"
              variant="ghost"
              aria-label="Reconcile Hostex delivery"
              disabled={acting}
              onClick={() =>
                void action(() => api.reconcileBookingInvite(invite.id), "Hostex conversation reconciled")
              }
            >
              <RefreshCw className="size-4 text-sky-700" />
            </Button>
          )}
          {conversationReady &&
            active &&
            latestManual?.status !== "sent" &&
            latestManual?.status !== "confirmed" && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="icon" variant="ghost" aria-label="Send through Hostex" disabled={acting}>
                    <Send className="size-4 text-emerald-700" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogTitle>
                    {latestManual?.status === "unknown"
                      ? "Retry an uncertain delivery?"
                      : "Send through Hostex?"}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {latestManual?.status === "unknown"
                      ? "Hostex may already have accepted the prior message. Continuing creates a duplicate-message risk. Reconcile first whenever possible."
                      : "This sends a real message to the guest conversation. Creating or regenerating a link alone never sends."}
                  </AlertDialogDescription>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() =>
                        void action(
                          () => api.sendBookingInvite(invite.id, latestManual?.status === "unknown"),
                          "Hostex message submitted"
                        )
                      }
                    >
                      {latestManual?.status === "unknown" ? "Accept duplicate risk and retry" : "Send now"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
        </div>
      </div>

      {editing && (
        <form
          className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void action(
              () => api.updateInvite(invite.id, { purpose, expiresAt: new Date(expiresAt).toISOString() }),
              "Link updated"
            ).then(() => setEditing(false));
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={`purpose-${invite.id}`}>Purpose</Label>
            <select
              id={`purpose-${invite.id}`}
              value={purpose}
              onChange={(event) => setPurpose(event.target.value as Purpose)}
              className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
            >
              {PURPOSES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`expires-${invite.id}`}>Expires</Label>
            <Input
              id={`expires-${invite.id}`}
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </div>
          <Button disabled={acting}>Save</Button>
        </form>
      )}
    </article>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="max-w-[65%] truncate font-medium text-slate-800">{value}</dd>
    </div>
  );
}
