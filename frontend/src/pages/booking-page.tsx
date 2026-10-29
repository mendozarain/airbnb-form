import {
  ArrowLeft,
  Copy,
  Edit3,
  ExternalLink,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Link2Off,
  Mail
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { PURPOSES, isRelayEmail, type BookingDetail, type Purpose } from "@cozy-d-714/shared";
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
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadError, LoadingCard } from "@/components/ui/loading";
import { Select } from "@/components/ui/select";
import { StatGrid } from "@/components/ui/stat-grid";
import { api } from "@/lib/api";
import {
  channelLabel,
  formatDate,
  formatDateTime,
  registrationTone,
  statusLabel,
  submissionTone
} from "@/lib/display";

function clampGuests(value: number) {
  return Math.min(10, Math.max(1, Math.trunc(value) || 1));
}

export function BookingPage() {
  const { id = "" } = useParams();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [purpose, setPurpose] = useState<Purpose>("Visitor of Tenant");
  const [expiresAt, setExpiresAt] = useState(() =>
    new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 16)
  );
  const [expectedGuestCount, setExpectedGuestCount] = useState(1);
  const [creating, setCreating] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setBooking((await api.getBooking(id)).booking);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load this booking");
    }
  }, [id]);

  useEffect(() => void load(), [load]);

  useEffect(() => {
    if (booking) setExpectedGuestCount(clampGuests(booking.numberOfGuests ?? 1));
  }, [booking?.id, booking?.numberOfGuests]);

  if (!booking)
    return error ? (
      <LoadError message={error} onRetry={() => void load()} />
    ) : (
      <LoadingCard label="Loading booking…" rows={3} />
    );
  const nights = Math.max(
    0,
    Math.round((Date.parse(booking.checkOut) - Date.parse(booking.checkIn)) / 86_400_000)
  );

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="secondary" size="sm" className="mb-4">
          <Link to="/admin/registrations">
            <ArrowLeft className="size-4" /> Registrations
          </Link>
        </Button>
        <section className="sg-enter rounded-xl bg-surface-raised p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-[28px] leading-8 font-semibold tracking-tight text-ink sm:text-heading-xl">
                {booking.guestName || "Guest"}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge>{channelLabel(booking.channelType)}</Badge>
                <Badge tone={registrationTone(booking.status)}>{statusLabel(booking.status)}</Badge>
                <span className="text-mono text-ink-muted">{booking.reservationCode}</span>
              </div>
            </div>
            <Button variant="secondary" onClick={() => void load()}>
              <RefreshCw className="size-4" /> Refresh
            </Button>
          </div>
          <StatGrid
            className="mt-5"
            items={[
              { label: "Check-in", value: formatDate(booking.checkIn), mono: true },
              { label: "Check-out", value: formatDate(booking.checkOut), mono: true },
              { label: "Nights", value: String(nights) },
              { label: "Guests", value: String(booking.numberOfGuests ?? "—") }
            ]}
          />
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="space-y-4">
          <div className="px-1">
            <h2 className="text-heading-s text-ink">Registration history</h2>
            <p className="mt-0.5 text-sm text-ink-muted">
              Links, submissions, and every send attempt are preserved.
            </p>
          </div>
          {booking.registrations.map((registration) => (
            <RegistrationCard
              key={registration.invite.id}
              registration={registration}
              conversationReady={Boolean(booking.conversationId)}
              guestEmail={isRelayEmail(booking.guestEmail) ? "" : (booking.guestEmail ?? "")}
              onChanged={load}
            />
          ))}
          {booking.registrations.length === 0 && (
            <EmptyState
              className="rounded-xl bg-surface-raised"
              icon={Link2Off}
              title="No guest links yet"
              description="Create a registration link to send this guest their check-in form."
            />
          )}
        </section>

        <aside className="space-y-5">
          <form
            className="rounded-xl bg-surface-raised p-5 sm:p-6"
            onSubmit={async (event) => {
              event.preventDefault();
              setCreating(true);
              try {
                const result = await api.createBookingInvite(booking.id, {
                  purpose,
                  expiresAt: new Date(expiresAt).toISOString(),
                  expectedGuestCount: clampGuests(expectedGuestCount)
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
              <Plus className="size-4 text-green" />
              <h2 className="text-heading-s text-ink">Create booking link</h2>
            </div>
            <p className="mt-1 text-sm text-ink-muted">Dates come from Hostex. Creating never sends.</p>
            <div className="mt-4 space-y-2">
              <Label htmlFor="booking-purpose">Purpose</Label>
              <Select
                id="booking-purpose"
                value={purpose}
                onChange={(event) => setPurpose(event.target.value as Purpose)}
              >
                {PURPOSES.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </Select>
            </div>
            <div className="mt-4 space-y-2">
              <Label htmlFor="booking-guests">Guests on form</Label>
              <Input
                id="booking-guests"
                type="number"
                min={1}
                max={10}
                value={expectedGuestCount}
                onChange={(event) => setExpectedGuestCount(clampGuests(Number(event.target.value)))}
              />
              <p className="text-xs text-ink-muted">
                Prefills from Hostex ({booking.numberOfGuests ?? "unknown"}). Guests must name everyone; only
                the form-filler uploads an ID.
              </p>
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
            <Button className="mt-5 w-full" loading={creating} loadingText="Creating…">
              <Plus className="size-4" /> Create and copy
            </Button>
          </form>

          <div className="rounded-xl bg-surface-raised p-5 sm:p-6">
            <h2 className="text-heading-s text-ink">Booking details</h2>
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
  guestEmail,
  onChanged
}: {
  registration: BookingDetail["registrations"][number];
  conversationReady: boolean;
  guestEmail: string;
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
  const [guestCount, setGuestCount] = useState(() => clampGuests(invite.expectedGuestCount));
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState(guestEmail);
  const [sendGuestCount, setSendGuestCount] = useState(() => clampGuests(invite.expectedGuestCount));
  const emailDeliveries = registration.deliveries.filter((delivery) => delivery.kind === "email");
  const lastEmail = emailDeliveries[emailDeliveries.length - 1];
  const emailValid = /^\S+@\S+\.\S+$/.test(emailTo.trim());

  useEffect(() => {
    setGuestCount(clampGuests(invite.expectedGuestCount));
    setSendGuestCount(clampGuests(invite.expectedGuestCount));
    setPurpose(invite.purpose);
    setExpiresAt(new Date(invite.expiresAt).toISOString().slice(0, 16));
  }, [invite.expectedGuestCount, invite.purpose, invite.expiresAt, invite.id]);

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

  async function persistGuestCountIfNeeded(count: number) {
    const next = clampGuests(count);
    if (next !== invite.expectedGuestCount) {
      await api.updateInvite(invite.id, { expectedGuestCount: next });
    }
  }

  return (
    <article className="sg-enter rounded-xl bg-surface-raised p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-title text-ink">{invite.purpose}</h3>
            <Badge tone={submissionTone(registration.submission?.status || invite.status)}>
              {statusLabel(registration.submission?.status || invite.status)}
            </Badge>
            {automationManaged && <Badge tone="sent">Scheduled Tenant</Badge>}
            <Badge tone="sent">
              {invite.expectedGuestCount} guest{invite.expectedGuestCount === 1 ? "" : "s"} on form
            </Badge>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            Created {formatDateTime(invite.createdAt)} · expires {formatDateTime(invite.expiresAt)}
          </p>
          {registration.deliveries.map((delivery) => (
            <p key={delivery.id} className="mt-2 text-xs text-ink-muted">
              {statusLabel(delivery.kind)} delivery: {statusLabel(delivery.status)}
              {delivery.to ? ` to ${delivery.to}` : ""}
              {delivery.kind === "email" && delivery.sentAt ? ` · ${formatDateTime(delivery.sentAt)}` : ""}
              {delivery.lastError ? ` · ${delivery.lastError}` : ""}
            </p>
          ))}
        </div>

        <div className="flex flex-wrap gap-1">
          <Button
            size="icon"
            variant="secondary"
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
            <Button
              size="icon"
              variant="secondary"
              aria-label="Edit link"
              onClick={() => setEditing(!editing)}
            >
              <Edit3 className="size-4" />
            </Button>
          )}
          {registration.submission && (
            <Button asChild size="icon" variant="secondary" aria-label="Open registration">
              <Link to={`/admin/submissions/${registration.submission.id}`}>
                <ExternalLink className="size-4" />
              </Link>
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="icon" variant="secondary" aria-label="Regenerate link" disabled={acting}>
                <RotateCcw className="size-4 text-ink" />
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
          {active && (
            <AlertDialog
              open={emailOpen}
              onOpenChange={(open) => {
                setEmailOpen(open);
                if (open) {
                  setEmailTo(lastEmail?.to || guestEmail);
                  setSendGuestCount(clampGuests(invite.expectedGuestCount));
                }
              }}
            >
              <AlertDialogTrigger asChild>
                <Button
                  size="icon"
                  variant="secondary"
                  aria-label="Email registration link"
                  disabled={acting}
                >
                  <Mail className="size-4 text-primary" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!emailValid) return;
                    void action(async () => {
                      await persistGuestCountIfNeeded(sendGuestCount);
                      await api.emailBookingInvite(invite.id, emailTo.trim());
                    }, "Registration email sent").then(() => setEmailOpen(false));
                  }}
                >
                  <AlertDialogTitle>Email registration link</AlertDialogTitle>
                  <AlertDialogDescription>
                    {lastEmail?.sentAt
                      ? `Already emailed${lastEmail.to ? ` to ${lastEmail.to}` : ""} on ${formatDateTime(lastEmail.sentAt)}. Send again?`
                      : "Paste the guest's email from the chat. They'll get a branded email asking them to register with this link."}
                  </AlertDialogDescription>
                  <div className="mt-4 space-y-2">
                    <Label htmlFor={`email-${invite.id}`}>Guest email</Label>
                    <Input
                      id={`email-${invite.id}`}
                      type="email"
                      autoComplete="off"
                      placeholder="guest@example.com"
                      value={emailTo}
                      onChange={(event) => setEmailTo(event.target.value)}
                    />
                  </div>
                  <div className="mt-4 space-y-2">
                    <Label htmlFor={`email-guests-${invite.id}`}>Guests on form</Label>
                    <Input
                      id={`email-guests-${invite.id}`}
                      type="number"
                      min={1}
                      max={10}
                      value={sendGuestCount}
                      onChange={(event) => setSendGuestCount(clampGuests(Number(event.target.value)))}
                    />
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
                    <Button type="submit" disabled={!emailValid} loading={acting} loadingText="Sending…">
                      <Send className="size-4" /> Send email
                    </Button>
                  </AlertDialogFooter>
                </form>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {canReconcile && (
            <Button
              size="icon"
              variant="secondary"
              aria-label="Reconcile Hostex delivery"
              disabled={acting}
              onClick={() =>
                void action(() => api.reconcileBookingInvite(invite.id), "Hostex conversation reconciled")
              }
            >
              <RefreshCw className="size-4 text-primary" />
            </Button>
          )}
          {conversationReady &&
            active &&
            latestManual?.status !== "sent" &&
            latestManual?.status !== "confirmed" && (
              <AlertDialog
                onOpenChange={(open) => {
                  if (open) setSendGuestCount(clampGuests(invite.expectedGuestCount));
                }}
              >
                <AlertDialogTrigger asChild>
                  <Button size="icon" variant="secondary" aria-label="Send through Hostex" disabled={acting}>
                    <Send className="size-4 text-green" />
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
                  <div className="mt-4 space-y-2">
                    <Label htmlFor={`send-guests-${invite.id}`}>Guests on form</Label>
                    <Input
                      id={`send-guests-${invite.id}`}
                      type="number"
                      min={1}
                      max={10}
                      value={sendGuestCount}
                      onChange={(event) => setSendGuestCount(clampGuests(Number(event.target.value)))}
                    />
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() =>
                        void action(async () => {
                          await persistGuestCountIfNeeded(sendGuestCount);
                          await api.sendBookingInvite(invite.id, latestManual?.status === "unknown");
                        }, "Hostex message submitted")
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
          className="mt-4 grid gap-3 border-t border-hairline pt-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void action(
              () =>
                api.updateInvite(invite.id, {
                  purpose,
                  expiresAt: new Date(expiresAt).toISOString(),
                  expectedGuestCount: clampGuests(guestCount)
                }),
              "Link updated"
            ).then(() => setEditing(false));
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={`purpose-${invite.id}`}>Purpose</Label>
            <Select
              id={`purpose-${invite.id}`}
              value={purpose}
              onChange={(event) => setPurpose(event.target.value as Purpose)}
            >
              {PURPOSES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`guests-${invite.id}`}>Guests on form</Label>
            <Input
              id={`guests-${invite.id}`}
              type="number"
              min={1}
              max={10}
              value={guestCount}
              onChange={(event) => setGuestCount(clampGuests(Number(event.target.value)))}
            />
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
          <Button loading={acting} loadingText="Saving…">
            Save
          </Button>
        </form>
      )}
    </article>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="max-w-[65%] truncate font-medium text-ink">{value}</dd>
    </div>
  );
}
