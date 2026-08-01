import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarDays, Copy, Loader2, MessageCircle, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  PURPOSES,
  createInviteSchema,
  type CreateInviteInput,
  type HostexAutomationStatus,
  type InviteSummary,
  type SubmissionSummary
} from "@cozy-d-714/shared";
import { PageHeader } from "@/components/page-header";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";

type Tab = "pending" | "ready_for_review" | "done" | "rejected";

export function DashboardPage() {
  const [tab, setTab] = useState<Tab>("pending");
  const [invites, setInvites] = useState<InviteSummary[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [guestUrl, setGuestUrl] = useState("");
  const [syncingHostex, setSyncingHostex] = useState(false);
  const [hostexStatus, setHostexStatus] = useState<HostexAutomationStatus | null>(null);
  const form = useForm<CreateInviteInput>({
    resolver: zodResolver(createInviteSchema),
    defaultValues: { checkIn: "", checkOut: "", purpose: undefined }
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "pending") {
        const [inviteResult, status] = await Promise.all([api.listInvites(), api.getHostexStatus()]);
        setInvites(inviteResult.invites);
        setHostexStatus(status);
        setSubmissions([]);
      } else {
        setSubmissions((await api.listSubmissions(tab)).submissions);
        setInvites([]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load registrations");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = form.handleSubmit(async (values) => {
    try {
      const result = await api.createInvite(values);
      setGuestUrl(result.guestUrl);
      form.reset();
      toast.success("Guest link created");
      if (tab === "pending") await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create invite");
    }
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Guest registrations"
        description="Create a guest link, then review the registration before sending it to the PMO form."
      />

      <section aria-labelledby="new-invite-heading">
        <div className="mb-4 flex items-center gap-2">
          <Plus className="size-5 text-brand-700" />
          <h2 id="new-invite-heading" className="text-lg font-semibold">
            New guest link
          </h2>
        </div>
        <form
          onSubmit={create}
          className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 sm:items-end lg:grid-cols-[1fr_1fr_1fr_auto]"
        >
          <div className="space-y-2">
            <Label htmlFor="checkIn">Check-in</Label>
            <Input id="checkIn" type="date" {...form.register("checkIn")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="checkOut">Check-out</Label>
            <Input id="checkOut" type="date" {...form.register("checkOut")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="purpose">Purpose</Label>
            <select
              id="purpose"
              className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
              {...form.register("purpose")}
            >
              <option value="">Select purpose</option>
              {PURPOSES.map((purpose) => (
                <option key={purpose}>{purpose}</option>
              ))}
            </select>
          </div>
          <Button disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Create link
          </Button>
          {(form.formState.errors.checkIn ||
            form.formState.errors.checkOut ||
            form.formState.errors.purpose) && (
            <p className="text-sm text-red-600 sm:col-span-2 lg:col-span-4">
              {form.formState.errors.checkIn?.message ??
                form.formState.errors.checkOut?.message ??
                form.formState.errors.purpose?.message}
            </p>
          )}
        </form>
        {guestUrl && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-brand-100 bg-brand-50 p-3">
            <span className="min-w-0 flex-1 truncate text-sm text-brand-700">{guestUrl}</span>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Copy guest link"
              onClick={() => {
                void navigator.clipboard.writeText(guestUrl);
                toast.success("Link copied");
              }}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        )}
      </section>

      <section>
        <div className="flex items-start justify-between gap-3 sm:items-center">
          <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="min-w-0 flex-1">
            <TabsList className="grid grid-cols-2 sm:flex">
              <TabsTrigger value="pending">Pending links</TabsTrigger>
              <TabsTrigger value="ready_for_review">Review</TabsTrigger>
              <TabsTrigger value="done">Done</TabsTrigger>
              <TabsTrigger value="rejected">Rejected</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-1">
            {tab === "pending" && (
              <>
                {hostexStatus && (
                  <div className="hidden items-center gap-1 lg:flex">
                    <Badge
                      className={
                        hostexStatus.webhookVerified
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-amber-200 bg-amber-50 text-amber-700"
                      }
                    >
                      Webhook {hostexStatus.webhookVerified ? "verified" : "pending"}
                    </Badge>
                    <Badge>{hostexStatus.automationEnabled ? "Automation on" : "Automation off"}</Badge>
                  </div>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={syncingHostex}
                  onClick={async () => {
                    setSyncingHostex(true);
                    try {
                      const result = await api.syncHostex();
                      toast.success(
                        result.alreadyRunning
                          ? "Hostex sync is already running"
                          : `Hostex sync found ${result.found ?? 0} upcoming reservation(s)`
                      );
                      await refresh();
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "Could not sync Hostex");
                    } finally {
                      setSyncingHostex(false);
                    }
                  }}
                >
                  <MessageCircle className="size-4" />
                  <span className="hidden sm:inline">Sync Hostex</span>
                </Button>
              </>
            )}
            <Button size="icon" variant="ghost" aria-label="Refresh" onClick={() => void refresh()}>
              <RefreshCw className="size-4" />
            </Button>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
          {loading ? (
            <div className="space-y-3 p-4">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : tab === "pending" ? (
            invites.length ? (
              invites.map((invite) => <InviteRow key={invite.id} invite={invite} onDelete={refresh} />)
            ) : (
              <EmptyState>There are no pending guest links.</EmptyState>
            )
          ) : submissions.length ? (
            submissions.map((submission) => <SubmissionRow key={submission.id} submission={submission} />)
          ) : (
            <EmptyState>There are no registrations in this view.</EmptyState>
          )}
        </div>
      </section>
    </div>
  );
}

function InviteRow({ invite, onDelete }: { invite: InviteSummary; onDelete: () => Promise<void> }) {
  const [acting, setActing] = useState(false);

  async function hostexAction(action: () => Promise<unknown>, success: string) {
    setActing(true);
    try {
      await action();
      toast.success(success);
      await onDelete();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Hostex action failed");
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-b border-slate-100 p-4 last:border-0 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 text-slate-400" />
          <span className="font-medium">
            {formatDate(invite.checkIn)} – {formatDate(invite.checkOut)}
          </span>
        </div>
        <p className="mt-1 text-sm font-medium text-slate-700">{invite.purpose}</p>
        <p className="mt-1 truncate text-sm text-slate-500">{invite.guestUrl}</p>
        {invite.hostex && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{channelLabel(invite.hostex.channelType)}</span>
            <span>Scheduled {formatDateTime(invite.hostex.dueAt)}</span>
            {invite.hostex.lastError && <span className="text-red-600">{invite.hostex.lastError}</span>}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 self-end sm:self-auto">
        <Badge>{invite.hostex ? labelStatus(invite.hostex.status) : invite.status}</Badge>
        {invite.guestUrl && (
          <Button
            size="icon"
            variant="ghost"
            aria-label="Copy link"
            onClick={() => void navigator.clipboard.writeText(invite.guestUrl!)}
          >
            <Copy className="size-4" />
          </Button>
        )}
        {invite.hostex && ["sent", "sending", "unknown"].includes(invite.hostex.status) && (
          <Button
            size="icon"
            variant="ghost"
            aria-label="Reconcile Hostex message"
            disabled={acting}
            onClick={() =>
              void hostexAction(() => api.reconcileHostexInvite(invite.id), "Hostex conversation checked")
            }
          >
            <RefreshCw className="size-4" />
          </Button>
        )}
        {invite.hostex &&
          invite.hostex.status !== "unknown" &&
          !["sent", "confirmed", "cancelled", "skipped_submitted"].includes(invite.hostex.status) && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="icon" variant="ghost" aria-label="Send Hostex message now" disabled={acting}>
                  <Send className="size-4 text-brand-700" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogTitle>Send this link through Hostex now?</AlertDialogTitle>
                <AlertDialogDescription>
                  This sends a real message to the guest on {channelLabel(invite.hostex.channelType)}.
                </AlertDialogDescription>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      void hostexAction(() => api.sendHostexInvite(invite.id), "Hostex message submitted")
                    }
                  >
                    Send now
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        {invite.hostex?.status === "unknown" && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Retry uncertain Hostex message"
                disabled={acting}
              >
                <Send className="size-4 text-amber-600" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>Retry an uncertain delivery?</AlertDialogTitle>
              <AlertDialogDescription>
                Hostex did not confirm the previous request. Retrying may send the guest a duplicate message.
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    void hostexAction(() => api.sendHostexInvite(invite.id, true), "Hostex retry submitted")
                  }
                >
                  Accept risk and retry
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {!invite.hostex && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="Delete link">
                <Trash2 className="size-4 text-red-600" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>Delete this guest link?</AlertDialogTitle>
              <AlertDialogDescription>
                This link will stop working immediately. This cannot be undone.
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={async () => {
                    await api.deleteInvite(invite.id);
                    toast.success("Invite deleted");
                    await onDelete();
                  }}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );
}

function SubmissionRow({ submission }: { submission: SubmissionSummary }) {
  return (
    <Link
      to={`/admin/submissions/${submission.id}`}
      className="grid gap-2 border-b border-slate-100 p-4 transition hover:bg-slate-50 last:border-0 sm:grid-cols-[1fr_auto] sm:items-center"
    >
      <div className="min-w-0">
        <p className="truncate font-medium text-slate-900">{submission.guestEmail}</p>
        <p className="mt-1 text-sm text-slate-500">
          {formatDate(submission.checkIn)} – {formatDate(submission.checkOut)}
        </p>
      </div>
      <Badge className="w-fit">{labelStatus(submission.status)}</Badge>
    </Link>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="p-8 text-center text-sm text-slate-500">{children}</p>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila"
  }).format(new Date(value));
}

function channelLabel(value: string) {
  if (value === "airbnb") return "Airbnb";
  if (value === "booking.com") return "Booking.com";
  if (value === "agoda") return "Agoda";
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function labelStatus(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
