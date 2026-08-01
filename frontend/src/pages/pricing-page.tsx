import { AlertTriangle, Calculator, CheckCircle2, Play, Save, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { PricingConfig, PricingPreview, PricingRun, PricingSettings } from "@cozy-d-714/shared";
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
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { formatDate, formatDateTime, money, statusLabel } from "@/lib/display";

const ruleFields: Array<{ key: keyof PricingConfig; label: string; step?: string }> = [
  { key: "horizonDays", label: "Pricing horizon (days)" },
  { key: "baseAirbnbPrice", label: "Base Airbnb price" },
  { key: "minimumAirbnbPrice", label: "Minimum Airbnb price" },
  { key: "maximumNonEventAirbnbPrice", label: "Maximum non-event price" },
  { key: "rainySeasonDiscount", label: "Rainy-season discount", step: "0.01" },
  { key: "urgentGapDays", label: "Urgent-gap days" },
  { key: "urgentGapDiscount", label: "Urgent-gap discount", step: "0.01" },
  { key: "weekendPremium", label: "Weekend premium", step: "0.01" },
  { key: "lowOccupancyThreshold", label: "Low occupancy threshold", step: "0.01" },
  { key: "lowOccupancyDiscount", label: "Low occupancy discount", step: "0.01" },
  { key: "lowOccupancyLeadDays", label: "Low occupancy lead days" },
  { key: "mediumOccupancyThreshold", label: "Medium threshold", step: "0.01" },
  { key: "mediumOccupancyPremium", label: "Medium premium", step: "0.01" },
  { key: "highOccupancyThreshold", label: "High threshold", step: "0.01" },
  { key: "highOccupancyPremium", label: "High premium", step: "0.01" },
  { key: "eventBoost", label: "Event boost", step: "0.01" },
  { key: "roundTo", label: "Round to" }
];

export function PricingPage() {
  const [settings, setSettings] = useState<PricingSettings | null>(null);
  const [config, setConfig] = useState<PricingConfig | null>(null);
  const [runs, setRuns] = useState<PricingRun[]>([]);
  const [preview, setPreview] = useState<PricingPreview | null>(null);
  const [working, setWorking] = useState(false);
  async function load() {
    const [settingResult, runResult] = await Promise.all([api.getPricingSettings(), api.listPricingRuns()]);
    setSettings(settingResult);
    setConfig(settingResult.config);
    setRuns(runResult.runs);
  }
  useEffect(() => void load(), []);
  if (!settings || !config)
    return <p className="p-10 text-center text-sm text-slate-500">Loading pricing controls…</p>;
  async function work(action: () => Promise<void>) {
    setWorking(true);
    try {
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Pricing action failed");
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="Dynamic pricing"
        description="Preview, audit, and apply Hostex prices with hard guardrails."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Status
          icon={ShieldCheck}
          label="Master switch"
          value={settings.automationAvailable ? "Available" : "Railway off"}
          good={settings.automationAvailable}
        />
        <Status
          icon={settings.automationOn ? CheckCircle2 : AlertTriangle}
          label="Daily 8 AM run"
          value={settings.automationOn ? "Enabled" : "Paused"}
          good={settings.automationOn}
        />
        <Status icon={Calculator} label="Settings version" value={`v${settings.version}`} good />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold text-slate-950">Pricing rules</h2>
              <p className="text-sm text-slate-500">Changes are versioned and audited.</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={working || !settings.automationAvailable}
                onClick={() =>
                  void work(async () => {
                    const result = await api.setPricingAutomation(!settings.automationOn);
                    setSettings(result);
                    toast.success(
                      result.automationOn ? "Automatic pricing enabled" : "Automatic pricing paused"
                    );
                  })
                }
              >
                {settings.automationOn ? "Pause automatic" : "Enable automatic"}
              </Button>
              <Button
                disabled={working}
                onClick={() =>
                  void work(async () => {
                    const result = await api.updatePricingSettings(settings.version, config);
                    setSettings(result);
                    setConfig(result.config);
                    setPreview(null);
                    toast.success("Pricing rules saved");
                  })
                }
              >
                <Save className="size-4" />
                Save rules
              </Button>
            </div>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ruleFields.map((field) => (
              <div key={String(field.key)} className="space-y-2">
                <Label htmlFor={String(field.key)}>{field.label}</Label>
                <Input
                  id={String(field.key)}
                  type="number"
                  step={field.step || "1"}
                  value={String(config[field.key])}
                  onChange={(event) => setConfig({ ...config, [field.key]: Number(event.target.value) })}
                />
              </div>
            ))}
          </div>
          <div className="mt-6 border-t border-slate-100 pt-5">
            <h3 className="font-medium text-slate-900">Channel ratios</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {config.listings.map((listing, index) => (
                <div
                  key={`${listing.channelType}-${listing.listingId}`}
                  className="grid grid-cols-[1fr_90px] items-end gap-2 rounded-lg bg-slate-50 p-3"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-800">{listing.channelType}</p>
                    <p className="truncate text-xs text-slate-400">{listing.listingId}</p>
                  </div>
                  <Input
                    type="number"
                    step="0.05"
                    value={listing.ratio}
                    onChange={(event) => {
                      const listings = [...config.listings];
                      listings[index] = { ...listing, ratio: Number(event.target.value) };
                      setConfig({ ...config, listings });
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="mt-6 border-t border-slate-100 pt-5">
            <h3 className="font-medium text-slate-900">Rule history</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {settings.history.slice(0, 6).map((item) => (
                <div key={item.version} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <span className="font-semibold text-slate-800">Version {item.version}</span>
                  {` · ${formatDateTime(item.createdAt)}`}
                  <span className="mt-0.5 block">{item.changedBy || "System seed"}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-6 border-t border-slate-100 pt-5">
            <h3 className="font-medium text-slate-900">Recurring events</h3>
            <div className="mt-3 space-y-2">
              {config.recurringEvents.map((event, index) => (
                <div
                  key={`${event.name}-${index}`}
                  className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-[1fr_110px_110px]"
                >
                  {" "}
                  <Input
                    value={event.name}
                    onChange={(change) => {
                      const recurringEvents = [...config.recurringEvents];
                      recurringEvents[index] = { ...event, name: change.target.value };
                      setConfig({ ...config, recurringEvents });
                    }}
                  />
                  <Input
                    value={event.start}
                    onChange={(change) => {
                      const recurringEvents = [...config.recurringEvents];
                      recurringEvents[index] = { ...event, start: change.target.value };
                      setConfig({ ...config, recurringEvents });
                    }}
                  />
                  <Input
                    value={event.end}
                    onChange={(change) => {
                      const recurringEvents = [...config.recurringEvents];
                      recurringEvents[index] = { ...event, end: change.target.value };
                      setConfig({ ...config, recurringEvents });
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </section>
        <aside className="space-y-5">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-slate-950">Preview and apply</h2>
            <p className="mt-1 text-sm text-slate-500">Preview reads Hostex but never writes prices.</p>
            <Button
              className="mt-4 w-full"
              variant="secondary"
              disabled={working}
              onClick={() =>
                void work(async () => {
                  const result = await api.previewPricing();
                  setPreview(result);
                  toast.success("Pricing preview created");
                })
              }
            >
              <Calculator className="size-4" />
              Create preview
            </Button>
            {preview && (
              <>
                <div className="mt-4 max-h-72 overflow-auto rounded-lg border border-slate-200">
                  <div className="divide-y divide-slate-100">
                    {preview.days.slice(0, 31).map((day) => (
                      <div key={day.date} className="flex items-center justify-between px-3 py-2 text-sm">
                        <div>
                          <p className="font-medium text-slate-800">{formatDate(day.date)}</p>
                          <p className="text-xs text-slate-400">
                            {day.reasons.slice(1).join(", ") || "base"}
                          </p>
                        </div>
                        <span className="font-semibold">{money(day.airbnbPrice)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button className="mt-4 w-full" disabled={working}>
                      <Play className="size-4" />
                      Apply this preview
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogTitle>Submit these prices to Hostex?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This writes {preview.days.length} daily recommendations across every configured listing.
                      Hostex acceptance starts asynchronous OTA updates.
                    </AlertDialogDescription>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() =>
                          void work(async () => {
                            await api.applyPricing(preview.id);
                            setPreview(null);
                            await load();
                            toast.success("Prices submitted to Hostex");
                          })
                        }
                      >
                        Apply prices
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </section>
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-5">
              <h2 className="font-semibold text-slate-950">Recent runs</h2>
            </div>
            <div className="divide-y divide-slate-100">
              {runs.slice(0, 8).map((run) => {
                const submissions = latestSubmissions(run);
                return (
                  <div key={run.id} className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-800">{statusLabel(run.mode)}</span>
                      <Badge>{statusLabel(run.status)}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatDateTime(run.startedAt)} · settings v{run.settingsVersion}
                    </p>
                    {submissions.length > 0 && (
                      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                        {submissions.map((submission) => (
                          <div key={submission.id} className="rounded-md bg-slate-50 p-2 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate font-medium text-slate-700">
                                {submission.channelType} · attempt {submission.attempt}
                              </span>
                              <Badge>{statusLabel(submission.status)}</Badge>
                            </div>
                            {submission.error && <p className="mt-1 text-rose-600">{submission.error}</p>}
                            {submission.status === "failed" && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button className="mt-2" size="sm" variant="secondary" disabled={working}>
                                    Retry failed listing
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogTitle>Retry this Hostex price submission?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This submits the same immutable preview to {submission.channelType}.
                                    Hostex processes accepted price updates asynchronously.
                                  </AlertDialogDescription>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() =>
                                        void work(async () => {
                                          await api.retryPricingListing(run.id, submission.id);
                                          await load();
                                          toast.success("Listing retry completed");
                                        })
                                      }
                                    >
                                      Retry listing
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {runs.length === 0 && (
                <p className="p-6 text-center text-sm text-slate-500">No pricing runs yet.</p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function latestSubmissions(run: PricingRun) {
  const latest = new Map<string, NonNullable<PricingRun["submissions"]>[number]>();
  for (const submission of run.submissions ?? []) {
    const key = `${submission.channelType}:${submission.listingId}`;
    const current = latest.get(key);
    if (!current || submission.attempt > current.attempt) latest.set(key, submission);
  }
  return [...latest.values()];
}

function Status({
  icon: Icon,
  label,
  value,
  good
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string;
  good: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <Icon className={`size-5 ${good ? "text-emerald-600" : "text-amber-600"}`} />
      <p className="mt-3 text-sm text-slate-500">{label}</p>
      <p className="mt-1 font-semibold text-slate-950">{value}</p>
    </div>
  );
}
