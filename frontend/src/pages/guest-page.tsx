import {
  ArrowRight,
  Calendar,
  Camera,
  Check,
  Clock,
  Hash,
  IdCard,
  LinkIcon,
  Loader2,
  Mail,
  Pencil,
  Plus,
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
import { Confetti } from "@/components/ui/confetti";
import { EmptyState } from "@/components/ui/empty-state";
import { IconField } from "@/components/ui/field";
import { Stepper } from "@/components/guest/stepper";
import { Checklist, StepIntro } from "@/components/guest/step-intro";
import { IdTips } from "@/components/guest/id-tips";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

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
  const [uploading, setUploading] = useState("");
  const [errors, setErrors] = useState<{ email?: string; guests?: Record<number, string> }>({});
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

  async function next() {
    if (step === 0) {
      const valid = await form.trigger("guestEmail");
      if (!valid || !form.getValues("guestEmail").includes("@")) {
        setErrors({ email: "Enter a valid email so we know where to send your pass." });
        return;
      }
    }
    if (step === 1 && invite) {
      const guestErrors: Record<number, string> = {};
      values.guests.forEach((guest, index) => {
        if (!guest.fullName.trim()) guestErrors[index] = "Add this guest's full name.";
        else if (!(guest.age >= 0)) guestErrors[index] = "Add this guest's age.";
        else if (requiresGuestId(guest.age, invite.minorIdCutoff, invite.seniorIdCutoff) && !guest.idFileKey)
          guestErrors[index] = "Upload a photo of this guest's ID.";
      });
      if (Object.keys(guestErrors).length) {
        setErrors({ guests: guestErrors });
        return;
      }
    }
    setErrors({});
    setStep((value) => Math.min(2, value + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function upload(index: number, file: File) {
    setUploading(file.name);
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
      setUploading("");
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
      <main className="mx-auto max-w-3xl p-4 sm:p-8">
        <Skeleton className="h-24" />
        <Skeleton className="mt-5 h-96" />
      </main>
    );
  if (!invite)
    return (
      <main className="flex min-h-screen items-center justify-center bg-lavender p-4">
        <div className="w-full max-w-md rounded-xl bg-surface-raised p-6 shadow-card">
          <EmptyState
            icon={LinkIcon}
            tone="error"
            title="This link has expired"
            description="It may have been used already. Please message your host and they'll send you a fresh link."
          />
        </div>
      </main>
    );
  if (completedStatus) return <Done />;

  const idHint = `Guests under ${invite.minorIdCutoff} or aged ${invite.seniorIdCutoff}+ don't need an ID.`;

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 pb-32 pt-6 sm:px-6 sm:pb-10 sm:pt-10">
      <header className="rounded-xl bg-surface-raised px-6 pb-6 pt-8 text-center shadow-card">
        <Confetti />
        <p className="text-label text-primary">Cozy Davao D-714</p>
        <h1 className="font-display mt-2 text-[32px] leading-[38px] text-ink sm:text-[44px] sm:leading-[50px]">
          Welcome! Let's get you registered
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          It only takes a couple of minutes. Building management needs these details before you arrive.
        </p>
        <div className="mt-5 grid grid-cols-3 gap-2 text-left text-ink">
          <div className="rounded-md bg-butter p-3">
            <Calendar className="size-4" strokeWidth={1.5} aria-hidden="true" />
            <p className="mt-1 text-xs font-semibold">Check-in</p>
            <p className="text-sm font-bold">{formatDate(invite.checkIn)}</p>
          </div>
          <div className="rounded-md bg-sky p-3">
            <Calendar className="size-4" strokeWidth={1.5} aria-hidden="true" />
            <p className="mt-1 text-xs font-semibold">Check-out</p>
            <p className="text-sm font-bold">{formatDate(invite.checkOut)}</p>
          </div>
          <div className="rounded-md bg-mint p-3">
            <Hash className="size-4" strokeWidth={1.5} aria-hidden="true" />
            <p className="mt-1 text-xs font-semibold">Unit</p>
            <p className="text-sm font-bold">
              {invite.buildingCode}-{invite.unitNumber}
            </p>
          </div>
        </div>
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
          <section className="space-y-6 rounded-xl bg-surface-raised p-5 shadow-card sm:p-8">
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
            <div className="rounded-lg bg-primary-soft p-5">
              <p className="text-label mb-3 text-primary">Before you start</p>
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
            <p className="text-sm text-ink-muted">
              Purpose of visit: <span className="font-semibold text-ink">{invite.purpose}</span>
            </p>
          </section>
        )}

        {step === 1 && (
          <section className="space-y-4">
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
                <article key={field.id} className="rounded-xl bg-surface-raised p-5 shadow-card">
                  <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-lg font-semibold text-ink">
                      <span className="flex size-7 items-center justify-center rounded-full bg-primary-soft text-sm text-primary">
                        {index + 1}
                      </span>
                      Guest {index + 1}
                      {index === 0 && <span className="text-sm font-normal text-ink-muted">(you)</span>}
                    </h3>
                    {guests.fields.length > 1 && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove guest ${index + 1}`}
                        onClick={() => guests.remove(index)}
                      >
                        <Trash2 className="size-4 text-danger" strokeWidth={1.5} />
                      </Button>
                    )}
                  </div>
                  <div className="mt-4 grid gap-5 sm:grid-cols-[1fr_120px]">
                    <IconField
                      icon={User}
                      label="Full name"
                      placeholder="As shown on their ID"
                      autoComplete="name"
                      {...form.register(`guests.${index}.fullName`, { required: true })}
                    />
                    <IconField
                      icon={Hash}
                      label="Age"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={120}
                      {...form.register(`guests.${index}.age`, { valueAsNumber: true })}
                    />
                  </div>
                  {needsId ? (
                    <div className="mt-5">
                      <p className="text-sm font-semibold text-ink">Valid ID</p>
                      {previews[index] ? (
                        <div className="mt-2 flex items-center gap-3 rounded-md bg-success/10 p-3">
                          {previews[index].image ? (
                            <img
                              src={previews[index].url}
                              alt="ID preview"
                              className="size-14 rounded-sm object-cover"
                            />
                          ) : (
                            <div className="flex size-14 items-center justify-center rounded-sm bg-surface-raised text-xs font-semibold text-success">
                              PDF
                            </div>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1 text-sm font-semibold text-success">
                              <Check className="size-4" /> ID uploaded
                            </span>
                            <span className="block truncate text-xs text-ink-muted">
                              {previews[index].name}
                            </span>
                          </span>
                          <label className="cursor-pointer text-sm font-semibold text-primary hover:underline">
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
                          <label className="mt-2 flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-primary/40 bg-primary-soft p-4 text-center hover:border-primary">
                            <input
                              type="file"
                              className="sr-only"
                              accept="image/*,application/pdf"
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) void upload(index, file);
                              }}
                            />
                            {uploading ? (
                              <Loader2 className="size-6 animate-spin text-primary" />
                            ) : (
                              <Camera className="size-6 text-primary" strokeWidth={1.5} />
                            )}
                            <span className="mt-1 text-sm font-semibold text-ink">
                              Tap to take a photo or upload
                            </span>
                            <span className="text-xs text-ink-muted">Image or PDF, up to 100 MB</span>
                          </label>
                          <IdTips />
                        </>
                      )}
                    </div>
                  ) : (
                    <p className="mt-4 flex items-center gap-2 text-sm text-ink-muted">
                      <Check className="size-4 text-success" /> No ID needed for this guest.
                    </p>
                  )}
                  {guestError && (
                    <p role="alert" className="mt-4 text-sm font-semibold text-danger">
                      {guestError}
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
          <section className="space-y-5">
            <StepIntro icon={Check} title="Almost done" text="Check the details, tick the box, and submit." />
            <div className="divide-y divide-hairline rounded-xl bg-surface-raised shadow-card">
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
            <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-surface-raised p-5 shadow-card">
              <Checkbox
                className="mt-0.5 size-6"
                checked={values.acceptedRules}
                onCheckedChange={(checked) => form.setValue("acceptedRules", checked === true)}
              />
              <span className="text-sm text-ink">
                I confirm the information is accurate and may be submitted to building management.
              </span>
            </label>
          </section>
        )}

        <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 border-t border-hairline bg-surface-raised p-3 sm:static sm:mt-7 sm:border-0 sm:bg-transparent sm:p-0">
          <Button
            type="button"
            variant="link"
            className={step === 0 ? "invisible" : ""}
            onClick={() => {
              setErrors({});
              setStep((value) => Math.max(0, value - 1));
            }}
          >
            Back
          </Button>
          {step < 2 ? (
            <Button type="button" size="lg" onClick={() => void next()}>
              Continue
              <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button type="submit" size="lg" disabled={!values.acceptedRules || form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}Submit registration
            </Button>
          )}
        </div>
      </form>
    </main>
  );
}

function Review({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <div className="flex items-center gap-3 p-4">
      <div className="grid min-w-0 flex-1 gap-1 sm:grid-cols-[110px_1fr]">
        <span className="text-sm text-ink-muted">{label}</span>
        <span className="break-words text-sm font-semibold text-ink">{value}</span>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
      >
        <Pencil className="size-3.5" /> Edit
      </button>
    </div>
  );
}

function Done() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-lavender p-4">
      <div className="w-full max-w-md rounded-xl bg-surface-raised p-6 text-center shadow-card sm:p-8">
        <Confetti />
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-success/10">
          <Check className="size-7 text-success" />
        </div>
        <h1 className="font-display mt-4 text-[32px] leading-[38px] text-ink">Thank you!</h1>
        <p className="mt-2 text-sm text-ink-muted">We've received your registration.</p>
      </div>
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
