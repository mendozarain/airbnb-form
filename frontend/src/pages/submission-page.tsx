import {
  ArrowLeft,
  Clock,
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  Edit3,
  Mail,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  XCircle,
  FileQuestion
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import type { SubmissionDetail } from "@cozy-d-714/shared";
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
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActionBar as FloatingBar } from "@/components/ui/action-bar";
import { LoadingCard } from "@/components/ui/loading";
import { StatusHero } from "@/components/ui/status-hero";
import { api } from "@/lib/api";

type Detail = SubmissionDetail & { latestError?: string | null };

export function SubmissionPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [submission, setSubmission] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{
    guestEmail: string;
    purpose: SubmissionDetail["purpose"];
    guests: Array<{
      id?: string;
      fullName: string;
      age: number;
      retainFileIds: string[];
      idFileKey?: string;
    }>;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      setSubmission((await api.getSubmission(id)).submission);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load submission");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (
      !submission ||
      (!["ai_check_pending", "ai_checking", "queued", "submitting"].includes(submission.status) &&
        !submission.chatDeliveries?.some((delivery) => ["queued", "sending"].includes(delivery.status)))
    )
      return;
    const timer = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(timer);
  }, [submission, load]);

  async function act(action: () => Promise<unknown>, message: string, leave = false) {
    setActing(true);
    try {
      await action();
      toast.success(message);
      if (leave) navigate("/admin/registrations");
      else await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
    } finally {
      setActing(false);
    }
  }

  if (loading) return <LoadingCard label="Loading registration…" rows={3} />;
  if (!submission)
    return (
      <EmptyState
        icon={FileQuestion}
        title="Registration not found"
        description="It may have been removed."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link to="/admin/registrations">Back to registrations</Link>
          </Button>
        }
      />
    );

  const canReview = ["ready_for_review", "failed"].includes(submission.status);
  const canEdit = [
    "ai_check_pending",
    "ai_review_required",
    "ready_for_review",
    "failed",
    "rejected"
  ].includes(submission.status);
  const canRetryEmail = submission.status === "submitted_email_failed";
  const canResendEmail = submission.status === "submitted_email_sent";
  const isRunning = ["queued", "submitting"].includes(submission.status);
  const canOverrideAi =
    ["ai_review_required", "rejected"].includes(submission.status) && Boolean(submission.aiReview);

  return (
    <div className="space-y-7 pb-24 sm:pb-0">
      <PageHeader
        title="Registration review"
        description={submission.guestEmail}
        actions={
          <Button asChild variant="secondary">
            <Link to="/admin/registrations">
              <ArrowLeft className="size-4" />
              Back to registrations
            </Link>
          </Button>
        }
      />

      <StatusHero
        plain={!isRunning && submission.status !== "ai_check_pending"}
        chipIcon={isRunning ? Clock : ShieldCheck}
        chip={labelStatus(submission.status)}
        title={isRunning ? "Submitting to building management" : heroTitle(submission.status)}
        sub={<span className="text-mono">{submission.guestEmail}</span>}
        stats={[
          {
            label: submission.purpose === "Tenant" ? "Stay" : "Visit",
            value: `${formatDate(submission.checkIn)} – ${formatDate(submission.checkOut)}`
          },
          { label: "Unit", value: `Building ${submission.buildingCode}, ${submission.unitNumber}` },
          { label: "Purpose", value: submission.purpose }
        ]}
      />

      {submission.latestError && (
        <div className="rounded-xl bg-surface-raised p-5 text-base text-danger">{submission.latestError}</div>
      )}

      {Boolean(submission.chatDeliveries?.length) && (
        <section className="sg-enter space-y-4 rounded-xl bg-surface-raised p-5 sm:p-6">
          <h2 className="text-heading-s">Platform email confirmations</h2>
          <p className="text-sm text-ink-muted">
            Chat delivery is tracked separately. Retrying chat does not resend the email.
          </p>
          {submission.chatDeliveries?.map((delivery) => (
            <div key={delivery.id} className="space-y-2 border-t border-hairline pt-3">
              <div className="flex flex-wrap items-center gap-3">
                <Badge>{labelStatus(delivery.status)}</Badge>
                <span className="text-sm text-ink-muted">
                  {delivery.emailSentAt
                    ? `Email sent ${new Date(delivery.emailSentAt).toLocaleString()}`
                    : "Email not confirmed sent"}
                </span>
              </div>
              <p className="text-sm">{delivery.message}</p>
              {delivery.lastError && <p className="text-sm text-ink">{delivery.lastError}</p>}
              {delivery.status === "waiting_email" && (
                <p className="text-sm text-ink">
                  Waiting for the email outcome. If this persists, check email provider history before sending
                  another copy.
                </p>
              )}
              {delivery.status === "failed" && (
                <Button
                  variant="secondary"
                  disabled={acting}
                  onClick={() =>
                    void act(async () => {
                      const result = await api.retrySubmissionChat(id, delivery.id);
                      if (result.status !== "sent")
                        toast.warning(`Chat status: ${labelStatus(result.status)}`);
                    }, "Chat delivery updated")
                  }
                >
                  Retry chat only
                </Button>
              )}
              {delivery.status === "unknown" && (
                <Button
                  variant="secondary"
                  disabled={acting}
                  onClick={() =>
                    void act(async () => {
                      const result = await api.reconcileSubmissionChat(id, delivery.id);
                      if (result.status === "unknown")
                        toast.warning("Delivery is still uncertain; no duplicate message was sent.");
                    }, "Chat delivery checked")
                  }
                >
                  Check chat delivery
                </Button>
              )}
            </div>
          ))}
        </section>
      )}

      {submission.aiReview && (
        <section className="sg-enter space-y-4 rounded-xl bg-surface-raised p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-heading-s">
                AI ID review{" "}
                <Badge tone="ai">
                  <Sparkles className="size-4" />
                  AI-generated
                </Badge>
              </h2>
              <p className="text-sm text-ink-muted">
                {submission.aiReview.model}
                {submission.aiReview.checkedAt
                  ? ` · ${new Date(submission.aiReview.checkedAt).toLocaleString()}`
                  : " · Waiting to run"}
              </p>
            </div>
            <Badge>{labelStatus(submission.aiReview.status)}</Badge>
          </div>
          {submission.aiReview.error && (
            <p className="rounded-lg border bg-yellow-soft p-3 text-sm text-ink">
              {submission.aiReview.error}
            </p>
          )}
          {submission.aiReview.results.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="border-b border-hairline text-xs text-ink-muted">
                  <tr>
                    <th className="px-3 py-2">Entered name</th>
                    <th className="px-3 py-2">All extracted names</th>
                    <th className="px-3 py-2">Matched name</th>
                    <th className="px-3 py-2">Finding</th>
                    <th className="px-3 py-2">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {submission.aiReview.results.map((result, index) => (
                    <tr key={`${result.guestId}-${index}`} className="border-b border-hairline last:border-0">
                      <td className="px-3 py-3 font-medium">{result.enteredName}</td>
                      <td className="px-3 py-3">
                        {(result.extractedNames?.length ? result.extractedNames : [result.extractedName])
                          .filter(Boolean)
                          .join(", ") || "—"}
                      </td>
                      <td className="px-3 py-3">{result.matchedName ?? "—"}</td>
                      <td className="px-3 py-3">
                        <Badge className="mr-2">{labelStatus(result.verdict)}</Badge>
                        {result.reason}
                      </td>
                      <td className="px-3 py-3">{Math.round(result.confidence * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="text-sm text-ink-muted">
            {submission.aiReview.notificationSentAt
              ? `Review notification sent ${new Date(submission.aiReview.notificationSentAt).toLocaleString()}.`
              : submission.aiReview.notificationError
                ? `Notification failed: ${submission.aiReview.notificationError}`
                : "No review notification has been sent."}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-heading-s">Guests</h2>
          {canEdit && !editing && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setDraft({
                  guestEmail: submission.guestEmail,
                  purpose: submission.purpose,
                  guests: submission.guests.map((guest) => ({
                    id: guest.id,
                    fullName: guest.fullName,
                    age: guest.age,
                    retainFileIds: guest.files.map((file) => file.id)
                  }))
                });
                setEditing(true);
              }}
            >
              <Edit3 className="size-4" />
              Edit registration
            </Button>
          )}
        </div>
        {editing && draft ? (
          <div className="mt-3 space-y-4 rounded-xl border border-transparent bg-surface-sunken p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-email">Guest email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={draft.guestEmail}
                  onChange={(event) => setDraft({ ...draft, guestEmail: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-purpose">Purpose</Label>
                <select
                  id="edit-purpose"
                  value={draft.purpose}
                  onChange={(event) =>
                    setDraft({ ...draft, purpose: event.target.value as SubmissionDetail["purpose"] })
                  }
                  className="h-11 w-full rounded-lg border border-line-strong bg-surface-raised px-3 text-sm"
                >
                  <option>Tenant</option>
                  <option>Visitor of Tenant</option>
                  <option>Viewing</option>
                </select>
              </div>
            </div>
            {draft.guests.map((guest, index) => (
              <div key={guest.id ?? index} className="rounded-xl bg-surface-raised p-4">
                <div className="grid gap-3 sm:grid-cols-[1fr_100px_auto]">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input
                      value={guest.fullName}
                      onChange={(event) => {
                        const guests = [...draft.guests];
                        guests[index] = { ...guest, fullName: event.target.value };
                        setDraft({ ...draft, guests });
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Age</Label>
                    <Input
                      type="number"
                      min="0"
                      max="120"
                      value={guest.age}
                      onChange={(event) => {
                        const guests = [...draft.guests];
                        guests[index] = { ...guest, age: Number(event.target.value) };
                        setDraft({ ...draft, guests });
                      }}
                    />
                  </div>
                  <Button
                    size="icon"
                    variant="secondary"
                    className="self-end"
                    aria-label="Remove guest"
                    disabled={draft.guests.length === 1}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        guests: draft.guests.filter((_, guestIndex) => guestIndex !== index)
                      })
                    }
                  >
                    <Trash2 className="size-4 text-danger" />
                  </Button>
                </div>
                {guest.id &&
                  submission.guests
                    .find((item) => item.id === guest.id)
                    ?.files.map((file) => (
                      <label key={file.id} className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
                        <input
                          type="checkbox"
                          checked={guest.retainFileIds.includes(file.id)}
                          onChange={(event) => {
                            const guests = [...draft.guests];
                            guests[index] = {
                              ...guest,
                              retainFileIds: event.target.checked
                                ? [...guest.retainFileIds, file.id]
                                : guest.retainFileIds.filter((value) => value !== file.id)
                            };
                            setDraft({ ...draft, guests });
                          }}
                        />
                        Keep {file.filename}
                      </label>
                    ))}
                <div className="mt-3">
                  <Label className="text-xs">Replace/add ID</Label>
                  <Input
                    className="mt-1"
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      void (async () => {
                        setActing(true);
                        try {
                          const uploaded = await api.uploadSubmissionEditFile(id, file);
                          const guests = [...draft.guests];
                          guests[index] = { ...guest, idFileKey: uploaded.key };
                          setDraft({ ...draft, guests });
                          toast.success("ID uploaded for this edit");
                        } finally {
                          setActing(false);
                        }
                      })();
                    }}
                  />
                </div>
              </div>
            ))}
            <div className="flex flex-wrap justify-between gap-2">
              <Button
                variant="secondary"
                onClick={() =>
                  setDraft({
                    ...draft,
                    guests: [...draft.guests, { fullName: "", age: 0, retainFileIds: [] }]
                  })
                }
              >
                <Plus className="size-4" />
                Add guest
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditing(false);
                    setDraft(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  disabled={acting}
                  onClick={() =>
                    void act(async () => {
                      await api.updateSubmission(id, draft);
                      setEditing(false);
                      setDraft(null);
                    }, "Registration updated")
                  }
                >
                  <Save className="size-4" />
                  Save changes
                </Button>
              </div>
            </div>
          </div>
        ) : null}
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {!editing &&
            submission.guests.map((guest) => (
              <article key={guest.id} className="rounded-xl bg-surface-raised p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{guest.fullName}</h3>
                    <p className="text-sm text-ink-muted">Age {guest.age}</p>
                  </div>
                  {guest.requiresId && <Badge>ID required</Badge>}
                </div>
                {guest.files.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    {guest.files.map((file) => (
                      <a
                        key={file.id}
                        href={file.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block overflow-hidden rounded-lg border border-hairline"
                      >
                        {file.contentType.startsWith("image/") ? (
                          <img
                            src={file.url}
                            alt={`${guest.fullName} ID`}
                            className="aspect-[4/3] w-full object-contain bg-surface"
                          />
                        ) : (
                          <div className="p-4 text-sm text-primary-hover">Open {file.filename}</div>
                        )}
                        <div className="border-t border-hairline px-3 py-2 text-xs text-ink-muted">
                          {file.filename}
                        </div>
                      </a>
                    ))}
                  </div>
                ) : guest.requiresId ? (
                  <p className="mt-4 text-sm text-ink">The retained ID file is no longer available.</p>
                ) : null}
              </article>
            ))}
        </div>
      </section>

      <ActionBar>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={acting}>
              <Trash2 className="size-4" />
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>Delete this registration?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the registration and its retained files. This cannot be undone.
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => void act(() => api.deleteSubmission(id), "Registration deleted", true)}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {isRunning && (
          <Button
            variant="secondary"
            disabled={acting}
            onClick={() => void act(() => api.resetSubmission(id), "Submission reset")}
          >
            <RotateCcw className="size-4" />
            Reset
          </Button>
        )}
        {canReview && (
          <>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="secondary" disabled={acting}>
                  <XCircle className="size-4" />
                  Reject
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogTitle>Reject this registration?</AlertDialogTitle>
                <AlertDialogDescription>
                  The registration will move to the rejected list.
                </AlertDialogDescription>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => void act(() => api.rejectSubmission(id), "Registration rejected", true)}
                  >
                    Reject
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button
              loading={acting}
              loadingText="Confirming…"
              onClick={() => void act(() => api.confirmSubmission(id), "Submission queued")}
            >
              <CheckCircle2 className="size-4" />
              Confirm
            </Button>
          </>
        )}
        {canOverrideAi && (
          <>
            <Button
              variant="secondary"
              disabled={acting}
              onClick={() => void act(() => api.retryAiReview(id), "AI ID check queued again")}
            >
              <RotateCcw className="size-4" />
              Run AI check again
            </Button>
            {submission.aiReview?.notificationError && (
              <Button
                variant="secondary"
                disabled={acting}
                onClick={() =>
                  void act(() => api.retryAiReviewNotification(id), "AI review notification sent")
                }
              >
                <Mail className="size-4" />
                Retry notification
              </Button>
            )}
            <Button
              loading={acting}
              loadingText="Approving…"
              onClick={() => void act(() => api.approveAiReview(id), "AI review overridden and queued")}
            >
              <CheckCircle2 className="size-4" />
              Approve &amp; queue
            </Button>
          </>
        )}
        {canRetryEmail && (
          <Button
            loading={acting}
            loadingText="Sending…"
            onClick={() => void act(() => api.retrySubmissionEmail(id), "Entrance pass emailed")}
          >
            <Mail className="size-4" />
            Retry email
          </Button>
        )}
        {canResendEmail && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="secondary" disabled={acting}>
                <Mail className="size-4" />
                Resend email
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>Resend the entrance pass?</AlertDialogTitle>
              <AlertDialogDescription>
                This sends another copy of the entrance pass to {submission.guestEmail}.
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => void act(() => api.retrySubmissionEmail(id), "Entrance pass resent")}
                >
                  Resend email
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </ActionBar>
    </div>
  );
}

function heroTitle(status: string) {
  if (status === "submitted_email_sent") return "Submitted and entrance pass sent";
  if (status === "ready_for_review") return "Ready for your review";
  if (status === "rejected") return "Registration rejected";
  if (status === "ai_review_required") return "AI check needs your review";
  if (status === "failed" || status === "submitted_email_failed") return "Needs attention";
  return labelStatus(status);
}

function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <FloatingBar className="bottom-[calc(5.25rem+env(safe-area-inset-bottom))] flex-wrap justify-end lg:bottom-4 sm:static">
      {children}
    </FloatingBar>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(value));
}

function labelStatus(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
