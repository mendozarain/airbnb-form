import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  Clock,
  Hash,
  Hourglass,
  IdCard,
  LinkIcon,
  Mail,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Trash2,
  User,
  Users
} from "lucide-react";
import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { guestSubmissionSchema, requiresGuestId, type PublicInvite } from "@cozy-d-714/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { IconField } from "@/components/ui/field";
import { Stepper } from "@/components/guest/stepper";
import { Checklist, StepIntro } from "@/components/guest/step-intro";
import { IdTips } from "@/components/guest/id-tips";
import { ActionBar } from "@/components/ui/action-bar";
import { Badge } from "@/components/ui/badge";
import { LoadingBlock } from "@/components/ui/loading";
import { Skeleton } from "@/components/ui/skeleton";
import { StatGrid } from "@/components/ui/stat-grid";
import { StatusHero } from "@/components/ui/status-hero";
import { Timeline } from "@/components/ui/timeline";
import { api } from "@/lib/api";

type GuestErrors = { name?: string; age?: string; id?: string };
type FormErrors = { email?: string; guests?: Record<number, GuestErrors> };

type FormValues = {
  guestEmail: string;
  guests: Array<{ fullName: string; age: number; idFileKey?: string }>;
  acceptedRules: boolean;
};

export function GuestPage() {
  const { token = "" } = useParams();
  const [invite, setInvite] = useState<PublicInvite | null>(null);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [completedStatus, setCompletedStatus] = useState<string | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [previews, setPreviews] = useState<Record<number, { url: string; name: string; image: boolean }>>({});
  const form = useForm<FormValues>({
    defaultValues: {
      guestEmail: "",
      guests: [{ fullName: "", age: 18 }],
      acceptedRules: false
    }
  });
  const guests = useFieldArray({ control: form.control, name: "guests" });
  const values = form.watch();

  useEffect(() => {
    api
      .getInvite(token)
      .then(setInvite)
      .catch((error) => toast.error(error instanceof Error ? error.message : "Invite is unavailable"))
      .finally(() => setLoading(false));
  }, [token]);

  function validate(forStep: number): FormErrors {
    if (forStep === 0) {
      const email = form.getValues("guestEmail").trim();
      if (!email) return { email: "Add your email so we know where to send your pass." };
      if (!/^\S+@\S+\.\S+$/.test(email)) return { email: "Enter a valid email, like you@example.com." };
    }
    if (forStep === 1 && invite) {
      const guestErrors: Record<number, GuestErrors> = {};
      form.getValues("guests").forEach((guest, index) => {
        const found: GuestErrors = {};
        if (!guest.fullName.trim()) found.name = "Add this guest's full name.";
        if (!(guest.age >= 0)) found.age = "Add this guest's age.";
        else if (requiresGuestId(guest.age, invite.minorIdCutoff, invite.seniorIdCutoff) && !guest.idFileKey)
          found.id = "Upload a photo of this guest's ID.";
        if (Object.keys(found).length) guestErrors[index] = found;
      });
      if (Object.keys(guestErrors).length) return { guests: guestErrors };
    }
    return {};
  }

  async function next() {
    const found = validate(step);
    if (found.email || found.guests) {
      setErrors(found);
      return;
    }
    setErrors({});
    setStep((value) => Math.min(2, value + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // After a failed Continue, bring the first problem into view and focus it.
  useEffect(() => {
    if (!errors.email && !errors.guests) return;
    const first = document.querySelector<HTMLElement>('[aria-invalid="true"], [data-field-error]');
    if (!first) return;
    first.scrollIntoView({ behavior: "smooth", block: "center" });
    if (first instanceof HTMLInputElement) first.focus({ preventScroll: true });
  }, [errors]);

  // Clear a message as soon as that field is fixed (never add new ones until Continue is pressed).
  const snapshot = JSON.stringify(values);
  useEffect(() => {
    setErrors((current) => {
      if (!current.email && !current.guests) return current;
      const fresh = validate(step);
      const next: FormErrors = {};
      if (current.email && fresh.email) next.email = fresh.email;
      if (current.guests) {
        const guestsNext: Record<number, GuestErrors> = {};
        for (const [key, was] of Object.entries(current.guests)) {
          const now = fresh.guests?.[Number(key)];
          const kept: GuestErrors = {};
          if (was.name && now?.name) kept.name = now.name;
          if (was.age && now?.age) kept.age = now.age;
          if (was.id && now?.id) kept.id = now.id;
          if (Object.keys(kept).length) guestsNext[Number(key)] = kept;
        }
        if (Object.keys(guestsNext).length) next.guests = guestsNext;
      }
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  async function upload(index: number, file: File) {
    setUploading(index);
    try {
      const result = await api.uploadFile(token, file);
      form.setValue(`guests.${index}.idFileKey`, result.key, { shouldDirty: true });
      setPreviews((value) => ({
        ...value,
        [index]: { url: URL.createObjectURL(file), name: file.name, image: file.type.startsWith("image/") }
      }));
      toast.success("ID uploaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  }

  const submit = form.handleSubmit(async (raw) => {
    const parsed = guestSubmissionSchema.safeParse(raw);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    try {
      const result = await api.submitGuest(token, parsed.data);
      setCompletedStatus(result.status);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit registration");
    }
  });

  if (loading)
    return (
      <main aria-busy="true" className="mx-auto min-h-screen max-w-2xl px-4 pt-6 sm:px-6 sm:pt-10">
        <section className="relative overflow-hidden rounded-xl bg-surface-raised p-6 sm:p-8">
          <div className="sg-loadbar" aria-hidden="true" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-4 h-9 w-3/4" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton shape="block" className="mt-6 h-16 w-full" />
        </section>
        <LoadingBlock label="Opening your registration…" className="mt-4" />
      </main>
    );
  if (!invite)
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface p-4">
        <div className="w-full max-w-md rounded-xl bg-surface-raised p-6">
          <EmptyState
            icon={LinkIcon}
            tone="attention"
            title="This link has expired"
            description="It may have been used already. Please message your host and they'll send you a fresh link."
          />
        </div>
      </main>
    );
  if (completedStatus) return <Done />;

  const idHint = `Guests under ${invite.minorIdCutoff} or aged ${invite.seniorIdCutoff}+ don't need an ID.`;

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 pb-36 pt-6 sm:px-6 sm:pb-10 sm:pt-10">
      <header className="sg-enter rounded-xl bg-surface-raised p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <span className="size-3.5 rounded-full bg-yellow" aria-hidden="true" />
          <p className="text-heading-s text-ink">Cozy Davao D-714</p>
        </div>
        <h1 className="mt-5 text-[32px] leading-9 font-semibold tracking-tight text-ink sm:text-display">
          Register your stay
        </h1>
        <p className="mt-3 text-base text-ink-muted">
          It takes about two minutes. Building management needs these details before you arrive.
        </p>
        <StatGrid
          className="mt-6"
          items={[
            { label: "Check-in", value: formatDate(invite.checkIn), mono: true },
            { label: "Check-out", value: formatDate(invite.checkOut), mono: true },
            { label: "Unit", value: `${invite.buildingCode}-${invite.unitNumber}`, mono: true }
          ]}
        />
      </header>

      <Stepper
        step={step}
        onJump={(index) => {
          setErrors({});
          setStep(index);
        }}
      />

      <form onSubmit={submit}>
        {step === 0 && (
          <section className="sg-enter space-y-6 rounded-xl bg-surface-raised p-5 sm:p-8">
            <StepIntro
              icon={Mail}
              title="Where should we send your entrance pass?"
              text="We'll email it to you once building management has approved your registration."
            />
            <IconField
              icon={Mail}
              label="Your email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              error={errors.email}
              {...form.register("guestEmail", { required: true })}
            />
            <div className="rounded-lg bg-surface-sunken p-5">
              <p className="mb-4 text-title text-ink">Before you start</p>
              <Checklist
                items={[
                  { icon: Users, text: "Full name and age of everyone staying" },
                  {
                    icon: IdCard,
                    text: `A photo of a valid ID for guests aged ${invite.minorIdCutoff}–${invite.seniorIdCutoff - 1}`
                  },
                  { icon: Clock, text: "About 2 minutes" }
                ]}
              />
            </div>
            <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
              Purpose of visit <Badge>{invite.purpose}</Badge>
            </p>
          </section>
        )}

        {step === 1 && (
          <section className="sg-enter space-y-4">
            <StepIntro
              icon={Users}
              title="Who is staying?"
              text="Add everyone who will be staying, including yourself."
            />
            {guests.fields.map((field, index) => {
              const age = Number(values.guests[index]?.age ?? 0);
              const needsId = requiresGuestId(age, invite.minorIdCutoff, invite.seniorIdCutoff);
              const guestError = errors.guests?.[index];
              return (
                <article key={field.id} className="sg-enter rounded-xl bg-surface-raised p-5 sm:p-6">
                  <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-3 text-title text-ink">
                      <span className="grid size-9 place-items-center rounded-full bg-mint text-sm font-semibold text-on-accent">
                        {index + 1}
                      </span>
                      Guest {index + 1}
                      {index === 0 && <span className="text-sm font-normal text-ink-muted">(you)</span>}
                    </h3>
                    {guests.fields.length > 1 && (
                      <Button
                        type="button"
                        size="icon"
                        variant="secondary"
                        aria-label={`Remove guest ${index + 1}`}
                        onClick={() => guests.remove(index)}
                      >
                        <Trash2 className="size-4 text-danger" strokeWidth={1.75} />
                      </Button>
                    )}
                  </div>
                  <div className="mt-4 grid gap-5 sm:grid-cols-[1fr_120px]">
                    <IconField
                      icon={User}
                      label="Full name"
                      placeholder="As shown on their ID"
                      autoComplete="name"
                      error={guestError?.name}
                      {...form.register(`guests.${index}.fullName`, { required: true })}
                    />
                    <IconField
                      icon={Hash}
                      label="Age"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={120}
                      error={guestError?.age}
                      {...form.register(`guests.${index}.age`, { valueAsNumber: true })}
                    />
                  </div>
                  {needsId ? (
                    <div className="mt-5">
                      <p className="text-sm font-medium text-ink-muted">Valid ID</p>
                      {previews[index] ? (
                        <div className="mt-2 flex items-center gap-3 rounded-lg bg-surface-sunken p-3">
                          {previews[index].image ? (
                            <img
                              src={previews[index].url}
                              alt="ID preview"
                              className="size-14 rounded-sm object-cover"
                            />
                          ) : (
                            <div className="flex size-14 items-center justify-center rounded-sm bg-surface-raised text-xs font-semibold text-ink">
                              PDF
                            </div>
                          )}
                          <span className="min-w-0 flex-1">
                            <Badge tone="done" pop className="h-7 px-3">
                              <Check className="size-4" /> ID uploaded
                            </Badge>
                            <span className="mt-1 block truncate text-xs text-ink-muted">
                              {previews[index].name}
                            </span>
                          </span>
                          <label className="inline-flex h-10 cursor-pointer items-center rounded-full bg-surface-raised px-4 text-sm font-medium text-ink hover:bg-hairline">
                            Replace
                            <input
                              type="file"
                              className="sr-only"
                              accept="image/*,application/pdf"
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) void upload(index, file);
                              }}
                            />
                          </label>
                        </div>
                      ) : (
                        <>
                          <label
                            data-field-error={guestError?.id ? "" : undefined}
                            className={`mt-2 flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed bg-surface-sunken p-4 text-center hover:border-primary ${guestError?.id ? "border-danger" : "border-line-strong"}`}
                          >
                            <input
                              type="file"
                              className="sr-only"
                              accept="image/*,application/pdf"
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) void upload(index, file);
                              }}
                            />
                            {uploading === index ? (
                              <span className="sg-spinner sg-spinner--ring size-6" aria-hidden="true" />
                            ) : (
                              <Camera className="size-6 text-ink" strokeWidth={1.75} />
                            )}
                            <span
                              className="mt-1.5 text-sm font-medium text-ink"
                              role={uploading === index ? "status" : undefined}
                            >
                              {uploading === index ? "Uploading…" : "Tap to take a photo or upload"}
                            </span>
                            <span className="text-xs text-ink-muted">Image or PDF, up to 100 MB</span>
                          </label>
                          {guestError?.id && (
                            <p role="alert" className="mt-2 text-sm font-medium text-danger">
                              {guestError.id}
                            </p>
                          )}
                          <IdTips />
                        </>
                      )}
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-ink-muted">
                      <Badge tone="done" className="mr-2 h-7">
                        <Check className="size-4" /> No ID needed
                      </Badge>
                      for this guest.
                    </p>
                  )}
                </article>
              );
            })}
            {guests.fields.length < 10 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => guests.append({ fullName: "", age: 18 })}
              >
                <Plus className="size-4" />
                Add another guest
              </Button>
            )}
            <p className="text-sm text-ink-muted">{idHint}</p>
          </section>
        )}

        {step === 2 && (
          <section className="sg-enter space-y-5">
            <StepIntro icon={Check} title="Almost done" text="Check the details, tick the box, and submit." />
            <div className="divide-y divide-hairline rounded-xl bg-surface-raised">
              <Review label="Email" value={values.guestEmail} onEdit={() => setStep(0)} />
              {values.guests.map((guest, index) => (
                <Review
                  key={index}
                  label={`Guest ${index + 1}`}
                  value={`${guest.fullName}, age ${guest.age}${guest.idFileKey ? " · ID uploaded" : ""}`}
                  onEdit={() => setStep(1)}
                />
              ))}
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-surface-raised p-5">
              <Checkbox
                className="mt-0.5 size-6"
                checked={values.acceptedRules}
                onCheckedChange={(checked) => form.setValue("acceptedRules", checked === true)}
              />
              <span className="text-base text-ink">
                I confirm the information is accurate and may be submitted to building management.
              </span>
            </label>
          </section>
        )}

        <ActionBar className="sm:mt-6">
          <Button
            type="button"
            size="icon"
            variant="secondary"
            aria-label="Back"
            className={step === 0 ? "invisible" : ""}
            onClick={() => {
              setErrors({});
              setStep((value) => Math.max(0, value - 1));
            }}
          >
            <ArrowLeft className="size-5" />
          </Button>
          {step < 2 ? (
            <Button type="button" size="lg" className="flex-1" onClick={() => void next()}>
              Continue
              <ArrowRight className="size-5" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="lg"
              className="flex-1"
              disabled={!values.acceptedRules}
              loading={form.formState.isSubmitting}
              loadingText="Submitting…"
            >
              <Send className="size-5" />
              Submit registration
            </Button>
          )}
        </ActionBar>
      </form>
    </main>
  );
}

function Review({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <div className="flex items-center gap-3 p-4 sm:p-5">
      <div className="grid min-w-0 flex-1 gap-1 sm:grid-cols-[110px_1fr]">
        <span className="text-sm text-ink-muted">{label}</span>
        <span className="break-words text-base font-medium text-ink">{value}</span>
      </div>
      <Button type="button" size="sm" variant="secondary" onClick={onEdit}>
        <Pencil className="size-3.5" /> Edit
      </Button>
    </div>
  );
}

function Done() {
  const submitted = new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila"
  }).format(new Date());
  const day = new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Manila"
  }).format(new Date());
  return (
    <main className="mx-auto min-h-screen max-w-2xl space-y-5 px-4 py-6 sm:px-6 sm:py-10">
      <StatusHero
        chipIcon={Check}
        chip="Registration received"
        title="Pending review"
        sub={<span className="text-mono">Submitted · {submitted}</span>}
        stats={[
          { label: "Next step", value: "Building management review" },
          { label: "We'll email", value: "Your entrance pass" }
        ]}
      />
      <section
        className="sg-enter rounded-xl bg-surface-raised p-5 sm:p-6"
        style={{ "--i": 2 } as React.CSSProperties}
      >
        <h2 className="mb-5 text-heading-s text-ink sm:text-xl sm:font-semibold">What happens next</h2>
        <Timeline
          items={[
            { date: "Soon", icon: Sparkles, title: "Entrance pass emailed", meta: "Sent once approved" },
            {
              date: day,
              icon: Hourglass,
              title: "Building management review",
              meta: "In progress",
              tone: "yellow",
              live: true
            },
            {
              date: day,
              icon: Send,
              title: "Registration submitted",
              meta: "Thanks, we have everything we need",
              tone: "mint"
            }
          ]}
        />
      </section>
    </main>
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
