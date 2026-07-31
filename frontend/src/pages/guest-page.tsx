import { ArrowLeft, ArrowRight, Check, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { guestSubmissionSchema, type PublicInvite } from "@cozy-d-714/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const [complete, setComplete] = useState(false);
  const [uploading, setUploading] = useState("");
  const [previews, setPreviews] = useState<Record<number, { url: string; name: string }>>({});
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
        toast.error("Enter a valid guest email");
        return;
      }
    }
    if (step === 1 && invite) {
      const missing = values.guests.find(
        (guest) =>
          !guest.fullName.trim() || guest.age < 0 || (guest.age >= invite.minorIdCutoff && !guest.idFileKey)
      );
      if (missing) {
        toast.error("Complete each guest and upload IDs for guests who require one");
        return;
      }
    }
    setStep((value) => Math.min(2, value + 1));
  }

  async function upload(index: number, file: File) {
    setUploading(file.name);
    try {
      const result = await api.uploadFile(token, file);
      form.setValue(`guests.${index}.idFileKey`, result.key, { shouldDirty: true });
      setPreviews((value) => ({ ...value, [index]: { url: URL.createObjectURL(file), name: file.name } }));
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
      await api.submitGuest(token, parsed.data);
      setComplete(true);
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
    return <Centered title="Invite unavailable" body="This link may have expired or already been used." />;
  if (complete)
    return (
      <Centered
        title="Registration received"
        body="Your host will review it before submitting it to building management."
        success
      />
    );

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 pb-28 pt-6 sm:px-6 sm:pb-10 sm:pt-10">
      <header className="border-b border-slate-200 pb-5">
        <p className="text-xs font-semibold uppercase text-brand-700">Cozy Davao D-714</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Guest registration</h1>
        <p className="mt-1 text-sm text-slate-600">
          Building {invite.buildingCode}, Unit {invite.unitNumber} · {formatDate(invite.checkIn)} –{" "}
          {formatDate(invite.checkOut)}
        </p>
      </header>

      <ol className="my-6 grid grid-cols-3 gap-2" aria-label="Registration progress">
        {["Booking", "Guests", "Review"].map((label, index) => (
          <li
            key={label}
            className={`border-t-2 pt-2 text-xs font-medium ${index <= step ? "border-brand-600 text-brand-700" : "border-slate-200 text-slate-400"}`}
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      <form onSubmit={submit}>
        {step === 0 && (
          <section className="space-y-5 rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
            <div>
              <h2 className="text-lg font-semibold">Booking details</h2>
              <p className="text-sm text-slate-500">Tell us where to send registration updates.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="guestEmail">Guest email</Label>
              <Input
                id="guestEmail"
                type="email"
                autoComplete="email"
                required
                {...form.register("guestEmail", { required: true })}
              />
            </div>
            <div className="space-y-2">
              <Label>Purpose</Label>
              <div className="flex h-11 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-900">
                {invite.purpose}
              </div>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Who is staying?</h2>
              <p className="text-sm text-slate-500">
                Guests aged {invite.minorIdCutoff} or older need a valid ID.
              </p>
            </div>
            {guests.fields.map((field, index) => {
              const age = Number(values.guests[index]?.age ?? 0);
              return (
                <article key={field.id} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">Guest {index + 1}</h3>
                    {guests.fields.length > 1 && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Remove guest"
                        onClick={() => guests.remove(index)}
                      >
                        <Trash2 className="size-4 text-red-600" />
                      </Button>
                    )}
                  </div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_120px]">
                    <div className="space-y-2">
                      <Label htmlFor={`name-${index}`}>Full name</Label>
                      <Input
                        id={`name-${index}`}
                        required
                        {...form.register(`guests.${index}.fullName`, { required: true })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`age-${index}`}>Age</Label>
                      <Input
                        id={`age-${index}`}
                        type="number"
                        min={0}
                        max={120}
                        required
                        {...form.register(`guests.${index}.age`, { valueAsNumber: true })}
                      />
                    </div>
                  </div>
                  {age >= invite.minorIdCutoff && (
                    <div className="mt-4">
                      <Label>Valid ID</Label>
                      {previews[index] ? (
                        <div className="mt-2 flex items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3">
                          <img
                            src={previews[index].url}
                            alt="ID preview"
                            className="size-14 rounded object-cover"
                          />
                          <span className="min-w-0 flex-1 truncate text-sm text-emerald-800">
                            {previews[index].name}
                          </span>
                          <Check className="size-5 text-emerald-700" />
                        </div>
                      ) : (
                        <label className="mt-2 flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-center hover:border-brand-600">
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
                            <Loader2 className="size-5 animate-spin text-brand-700" />
                          ) : (
                            <Upload className="size-5 text-brand-700" />
                          )}
                          <span className="mt-1 text-sm font-medium">Upload ID</span>
                          <span className="text-xs text-slate-500">Image or PDF, up to 100 MB</span>
                        </label>
                      )}
                    </div>
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
                Add guest
              </Button>
            )}
          </section>
        )}

        {step === 2 && (
          <section className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">Review registration</h2>
              <p className="text-sm text-slate-500">Check everything before submitting.</p>
            </div>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              <Review label="Email" value={values.guestEmail} />
              <Review label="Purpose" value={invite.purpose} />
              {values.guests.map((guest, index) => (
                <Review
                  key={index}
                  label={`Guest ${index + 1}`}
                  value={`${guest.fullName}, age ${guest.age}${guest.idFileKey ? " · ID uploaded" : ""}`}
                />
              ))}
            </div>
            <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-4">
              <Checkbox
                checked={values.acceptedRules}
                onCheckedChange={(checked) => form.setValue("acceptedRules", checked === true)}
              />
              <span className="text-sm text-slate-700">
                I confirm the information is accurate and may be submitted to building management.
              </span>
            </label>
          </section>
        )}

        <div className="fixed inset-x-0 bottom-0 z-20 flex justify-between gap-3 border-t border-slate-200 bg-white p-3 sm:static sm:mt-7 sm:border-0 sm:bg-transparent sm:p-0">
          <Button
            type="button"
            variant="secondary"
            disabled={step === 0}
            onClick={() => setStep((value) => Math.max(0, value - 1))}
          >
            <ArrowLeft className="size-4" />
            Back
          </Button>
          {step < 2 ? (
            <Button type="button" onClick={() => void next()}>
              Continue
              <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button type="submit" disabled={!values.acceptedRules || form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}Submit registration
            </Button>
          )}
        </div>
      </form>
    </main>
  );
}

function Review({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 p-4 sm:grid-cols-[130px_1fr]">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-900">{value}</span>
    </div>
  );
}

function Centered({ title, body, success }: { title: string; body: string; success?: boolean }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="max-w-md text-center">
        {success && (
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-emerald-100">
            <Check className="size-6 text-emerald-700" />
          </div>
        )}
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-slate-600">{body}</p>
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
