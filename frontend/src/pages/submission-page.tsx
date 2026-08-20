import {
  ArrowLeft,
  CheckCircle2,
  Edit3,
  Loader2,
  Mail,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  XCircle
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
    if (!submission || !["queued", "submitting"].includes(submission.status)) return;
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

  if (loading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-72" />
      </div>
    );
  if (!submission) return <p className="text-sm text-slate-600">Submission not found.</p>;

  const canReview = ["ready_for_review", "failed"].includes(submission.status);
  const canEdit = ["ready_for_review", "failed", "rejected"].includes(submission.status);
  const canRetryEmail = submission.status === "submitted_email_failed";
  const canResendEmail = submission.status === "submitted_email_sent";
  const isRunning = ["queued", "submitting"].includes(submission.status);

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

      <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Info label="Stay" value={`${formatDate(submission.checkIn)} – ${formatDate(submission.checkOut)}`} />
        <Info label="Unit" value={`Building ${submission.buildingCode}, ${submission.unitNumber}`} />
        <Info label="Purpose" value={submission.purpose} />
        <div>
          <p className="text-xs font-medium uppercase text-slate-500">Status</p>
          <Badge className="mt-2">{labelStatus(submission.status)}</Badge>
        </div>
      </section>

      {submission.latestError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {submission.latestError}
        </div>
      )}

      <section>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Guests</h2>
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
          <div className="mt-3 space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/30 p-4">
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
                  className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                >
                  <option>Tenant</option>
                  <option>Visitor of Tenant</option>
                  <option>Viewing</option>
                </select>
              </div>
            </div>
            {draft.guests.map((guest, index) => (
              <div key={guest.id ?? index} className="rounded-lg border border-slate-200 bg-white p-4">
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
                    variant="ghost"
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
                    <Trash2 className="size-4 text-red-600" />
                  </Button>
                </div>
                {guest.id &&
                  submission.guests
                    .find((item) => item.id === guest.id)
                    ?.files.map((file) => (
                      <label key={file.id} className="mt-3 flex items-center gap-2 text-sm text-slate-600">
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
                  variant="ghost"
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
              <article key={guest.id} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{guest.fullName}</h3>
                    <p className="text-sm text-slate-500">Age {guest.age}</p>
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
                        className="block overflow-hidden rounded-md border border-slate-200"
                      >
                        {file.contentType.startsWith("image/") ? (
                          <img
                            src={file.url}
                            alt={`${guest.fullName} ID`}
                            className="aspect-[4/3] w-full object-contain bg-slate-50"
                          />
                        ) : (
                          <div className="p-4 text-sm text-brand-700">Open {file.filename}</div>
                        )}
                        <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
                          {file.filename}
                        </div>
                      </a>
                    ))}
                  </div>
                ) : guest.requiresId ? (
                  <p className="mt-4 text-sm text-amber-700">The retained ID file is no longer available.</p>
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
              disabled={acting}
              onClick={() => void act(() => api.confirmSubmission(id), "Submission queued")}
            >
              {acting ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              Confirm
            </Button>
          </>
        )}
        {canRetryEmail && (
          <Button
            disabled={acting}
            onClick={() => void act(() => api.retrySubmissionEmail(id), "Entrance pass emailed")}
          >
            {acting ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
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

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-900">{value}</p>
    </div>
  );
}

function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(3.625rem+env(safe-area-inset-bottom))] z-40 grid grid-flow-col auto-cols-fr gap-2 border-t border-slate-200 bg-white p-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] [&_button]:min-w-0 [&_button]:gap-1 [&_button]:px-2 [&_svg]:hidden sm:static sm:flex sm:justify-end sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:[&_button]:gap-2 sm:[&_button]:px-4 sm:[&_svg]:block">
      {children}
    </div>
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
