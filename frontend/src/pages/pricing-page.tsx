import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  CloudOff,
  Download,
  LineChart,
  Percent,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { channelPrice, pricingPreviewCsv } from "@cozy-d-714/shared";
import type {
  AirbnbDiscountRule,
  AirbnbPricingRules,
  AirbnbPricingRulesPatch,
  PricingConfig,
  PricingPreview,
  PricingRun,
  PricingSettings
} from "@cozy-d-714/shared";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadError, LoadingCard } from "@/components/ui/loading";
import { ActionBar } from "@/components/ui/action-bar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { formatDate, formatDateTime, money, statusLabel } from "@/lib/display";

type AirbnbDraft = Omit<AirbnbPricingRules, "syncedAt">;
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function PricingPage() {
  const [settings, setSettings] = useState<PricingSettings | null>(null);
  const [config, setConfig] = useState<PricingConfig | null>(null);
  const [runs, setRuns] = useState<PricingRun[]>([]);
  const [preview, setPreview] = useState<PricingPreview | null>(null);
  const [airbnb, setAirbnb] = useState<AirbnbPricingRules | null>(null);
  const [airbnbDraft, setAirbnbDraft] = useState<AirbnbDraft | null>(null);
  const [airbnbError, setAirbnbError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  async function loadLocal() {
    const [settingResult, runResult] = await Promise.all([api.getPricingSettings(), api.listPricingRuns()]);
    setSettings(settingResult);
    setConfig(settingResult.config);
    setRuns(runResult.runs);
  }

  async function loadAirbnb() {
    setAirbnbError(null);
    try {
      const result = await api.getAirbnbPricingSettings();
      setAirbnb(result);
      setAirbnbDraft(result);
    } catch (error) {
      setAirbnb(null);
      setAirbnbDraft(null);
      setAirbnbError(error instanceof Error ? error.message : "Could not load live Airbnb settings");
    }
  }

  function loadAll() {
    setLoading(true);
    setLoadError(null);
    void Promise.all([loadLocal(), loadAirbnb()])
      .catch((error) => setLoadError(error instanceof Error ? error.message : "Could not load pricing"))
      .finally(() => setLoading(false));
  }

  useEffect(loadAll, []);

  const pricingDirty = Boolean(
    settings && config && JSON.stringify(settings.config) !== JSON.stringify(config)
  );
  const discountsDirty = useMemo(
    () => Boolean(airbnb && airbnbDraft && Object.keys(changedDiscountPatch(airbnb, airbnbDraft)).length),
    [airbnb, airbnbDraft]
  );
  const availabilityDirty = useMemo(
    () => Boolean(airbnb && airbnbDraft && Object.keys(changedAvailabilityPatch(airbnb, airbnbDraft)).length),
    [airbnb, airbnbDraft]
  );

  async function work(key: string, action: () => Promise<void>) {
    setWorking(key);
    try {
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Pricing action failed");
    } finally {
      setWorking(null);
    }
  }

  async function saveAirbnb(key: string, patch: AirbnbPricingRulesPatch, message: string) {
    await work(key, async () => {
      const confirmed = await api.updateAirbnbPricingSettings(patch);
      setAirbnb(confirmed);
      setAirbnbDraft(confirmed);
      toast.success(message);
    });
  }

  if (loadError && (!settings || !config)) return <LoadError message={loadError} onRetry={loadAll} />;
  if (loading || !settings || !config) return <LoadingCard label="Loading pricing controls…" rows={4} />;
  const weekendPrice = config.weekendBasePrice;

  const savePricing = (key: string, message: string) =>
    void work(key, async () => {
      const result = await api.updatePricingSettings(settings.version, config);
      setSettings(result);
      setConfig(result.config);
      setPreview(null);
      toast.success(message);
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pricing"
        description="Simple everyday controls, with advanced automation kept out of the way."
      />
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Status
          icon={settings.automationOn ? CheckCircle2 : AlertTriangle}
          label="Automatic pricing"
          value={settings.automationOn ? "On · daily at 8 AM" : "Paused"}
          good={settings.automationOn}
        />
        <Status
          icon={airbnbError ? CloudOff : CheckCircle2}
          label="Airbnb settings"
          value={airbnbError ? "Could not refresh" : airbnb ? "Live from Hostex" : "Loading"}
          good={!airbnbError && Boolean(airbnb)}
        />
        <Status icon={ShieldCheck} label="Nightly price rules" value={`Version ${settings.version}`} good />
      </div>

      <Tabs defaultValue="pricing" className="space-y-5">
        <TabsList className="grid grid-cols-4">
          {[
            ["pricing", "Pricing"],
            ["discounts", "Discounts"],
            ["availability", "Availability"],
            ["automation", "Automation"]
          ].map(([value, label]) => (
            <TabsTrigger key={value} className="px-1 text-xs sm:px-3 sm:text-sm" value={value}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="pricing" className="space-y-5">
          <SectionIntro
            title="Nightly prices"
            description={
              settings.automationOn && settings.automationAvailable
                ? "Saved changes publish at the next 8 AM Manila run. Use Preview to publish sooner."
                : "Automation is paused. Save changes, then preview and publish when ready."
            }
          />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <PriceCard
              title="Weekday price"
              description="Sunday to Thursday nights"
              value={config.weekdayBasePrice}
              onChange={(value) => setConfig({ ...config, weekdayBasePrice: value })}
            />
            <PriceCard
              title="Weekend price"
              description="Friday and Saturday nights"
              value={weekendPrice}
              onChange={(value) => setConfig({ ...config, weekendBasePrice: value })}
            />
            <PriceCard
              title="Weekday floor"
              description="Only unsold weekdays inside the last-minute window"
              value={config.weekdayFloor}
              onChange={(value) => setConfig({ ...config, weekdayFloor: value })}
            />
            <PriceCard
              title="Weekend floor"
              description="Friday and Saturday never go below this"
              value={config.weekendFloor}
              onChange={(value) => setConfig({ ...config, weekendFloor: value })}
            />
            <PriceCard
              title="Ceiling"
              description="Highest nightly rate, including events"
              value={config.maximumPrice}
              onChange={(value) => setConfig({ ...config, maximumPrice: value })}
            />
            <PriceCard
              title="Last-minute weekday"
              description={`Open weekdays within ${config.lastMinuteLeadDays} days when pace is behind`}
              value={config.lastMinuteWeekdayPrice}
              onChange={(value) => setConfig({ ...config, lastMinuteWeekdayPrice: value })}
            />
            <PriceCard
              title="Weekend minimum"
              description="Friday and Saturday arrivals. Weekdays stay at 1 night."
              value={config.weekendMinStay}
              unit="nights"
              onChange={(value) => setConfig({ ...config, weekendMinStay: value })}
            />
            <PriceCard
              title="Relax within"
              description="Open weekend arrivals inside this window drop back to 1 night"
              value={config.minStayRelaxLeadDays}
              unit="days"
              onChange={(value) => setConfig({ ...config, minStayRelaxLeadDays: value })}
            />
          </div>
          <section className="rounded-xl bg-surface-raised p-5 text-sm text-ink-muted">
            Prices stay at the weekday or weekend rate until the next {config.paceHorizonDays} nights are
            below {Math.round(config.lastMinutePaceThreshold * 100)}% full. A busy surrounding week raises the
            rate, and a weekend with a booked neighbour rises too. Event nights keep their own price and
            minimum stay.
          </section>
          <PlatformMarkups config={config} setConfig={setConfig} />
          <SaveBar
            dirty={pricingDirty}
            working={working === "pricing"}
            text="Nightly price changes"
            onSave={() => savePricing("pricing", "Nightly price rules saved")}
          />
          <PreviewPanel
            preview={preview}
            working={working !== null || pricingDirty}
            dirty={pricingDirty}
            onPreview={() =>
              void work("preview", async () => {
                setPreview(await api.previewPricing());
                toast.success("Pricing preview created");
              })
            }
            onApply={() =>
              void work("apply", async () => {
                if (!preview) return;
                await api.applyPricing(preview.id);
                setPreview(null);
                await loadLocal();
                toast.success("Prices submitted to Hostex");
              })
            }
          />
        </TabsContent>

        <TabsContent value="discounts" className="space-y-5">
          <SectionIntro
            title="Airbnb discounts"
            description="Weekly 10% and monthly 25% are the recommended manual settings. Hostex applies them to the whole Airbnb listing, including Christmas and Kadayawan, so automatic pricing does not write them. Booking.com, Agoda, and direct promotions are set in each channel."
          />
          {!airbnb || !airbnbDraft ? (
            <HostexUnavailable
              error={airbnbError}
              loading={working === "reload-airbnb"}
              retry={() => void work("reload-airbnb", loadAirbnb)}
            />
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <DiscountCard
                  title="Weekly"
                  description="For stays of 7 nights or more"
                  value={discountAt(airbnbDraft.longTermDiscount, 7)}
                  onChange={(value) =>
                    setAirbnbDraft({
                      ...airbnbDraft,
                      longTermDiscount: setDiscountAt(airbnbDraft.longTermDiscount, 7, value)
                    })
                  }
                />
                <DiscountCard
                  title="Monthly"
                  description="For stays of 28 nights or more"
                  value={discountAt(airbnbDraft.longTermDiscount, 28)}
                  onChange={(value) =>
                    setAirbnbDraft({
                      ...airbnbDraft,
                      longTermDiscount: setDiscountAt(airbnbDraft.longTermDiscount, 28, value)
                    })
                  }
                />
                <RuleCard
                  title="Early-bird"
                  description="Reward guests who book in advance"
                  rules={airbnbDraft.earlyBirdDiscount}
                  onChange={(rules) => setAirbnbDraft({ ...airbnbDraft, earlyBirdDiscount: rules })}
                />
                <RuleCard
                  title="Last minute"
                  description="Fill dates close to arrival"
                  rules={airbnbDraft.lastMinuteDiscount}
                  onChange={(rules) => setAirbnbDraft({ ...airbnbDraft, lastMinuteDiscount: rules })}
                />
                <ToggleCard
                  title="Top-rated guests"
                  description="Offer Airbnb's discount to eligible highly rated guests"
                  checked={airbnbDraft.highRatedGuestDiscount}
                  onChange={(checked) => setAirbnbDraft({ ...airbnbDraft, highRatedGuestDiscount: checked })}
                />
                <ToggleCard
                  title="Mobile-only"
                  description="Offer a discount to guests booking on mobile"
                  checked={airbnbDraft.mobileOnlyDiscount}
                  onChange={(checked) => setAirbnbDraft({ ...airbnbDraft, mobileOnlyDiscount: checked })}
                />
              </div>
              <SaveBar
                dirty={discountsDirty}
                working={working === "discounts"}
                text="Airbnb discount changes"
                onSave={() =>
                  void saveAirbnb(
                    "discounts",
                    changedDiscountPatch(airbnb, airbnbDraft),
                    "Airbnb discounts updated"
                  )
                }
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="availability" className="space-y-5">
          <SectionIntro
            title="Airbnb availability"
            description="Booking rules are saved immediately through Hostex and then read back from Airbnb."
          />
          {!airbnb || !airbnbDraft ? (
            <HostexUnavailable
              error={airbnbError}
              loading={working === "reload-airbnb"}
              retry={() => void work("reload-airbnb", loadAirbnb)}
            />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <SettingCard
                  label="Minimum stay"
                  suffix="nights"
                  value={airbnbDraft.minimumStay}
                  onChange={(value) =>
                    value !== null && setAirbnbDraft({ ...airbnbDraft, minimumStay: value })
                  }
                />
                <SettingCard
                  label="Maximum stay"
                  suffix="nights"
                  value={airbnbDraft.maximumStay}
                  onChange={(value) =>
                    value !== null && setAirbnbDraft({ ...airbnbDraft, maximumStay: value })
                  }
                />
                <SettingCard
                  label="Advance notice"
                  suffix="hours"
                  value={airbnbDraft.advanceNotice}
                  onChange={(value) =>
                    value !== null && setAirbnbDraft({ ...airbnbDraft, advanceNotice: value })
                  }
                />
                <SettingCard
                  label="Preparation time"
                  suffix="days"
                  value={airbnbDraft.preparationTime}
                  onChange={(value) =>
                    value !== null && setAirbnbDraft({ ...airbnbDraft, preparationTime: value })
                  }
                />
                <SettingCard
                  label="Booking window"
                  suffix="days ahead"
                  value={airbnbDraft.availabilityWindow}
                  onChange={(value) =>
                    value !== null && setAirbnbDraft({ ...airbnbDraft, availabilityWindow: value })
                  }
                />
              </div>
              <WeekdayCard
                label="Allowed check-in days"
                selected={airbnbDraft.daysOfWeekCheckIn}
                onChange={(days) => setAirbnbDraft({ ...airbnbDraft, daysOfWeekCheckIn: days })}
              />
              <WeekdayCard
                label="Allowed check-out days"
                selected={airbnbDraft.daysOfWeekCheckOut}
                onChange={(days) => setAirbnbDraft({ ...airbnbDraft, daysOfWeekCheckOut: days })}
              />
              <SaveBar
                dirty={availabilityDirty}
                working={working === "availability"}
                text="Airbnb availability changes"
                onSave={() =>
                  void saveAirbnb(
                    "availability",
                    changedAvailabilityPatch(airbnb, airbnbDraft),
                    "Airbnb availability updated"
                  )
                }
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="automation" className="space-y-5">
          <SectionIntro
            title="Advanced automation"
            description="Event premiums, channel adjustments, history, and retry controls."
          />
          <div className="rounded-xl bg-surface-raised p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-title text-ink">Daily 8 AM pricing run</h3>
                <p className="mt-1 text-sm text-ink-muted">
                  Publishes calculated nightly prices to every configured platform.
                </p>
              </div>
              <Button
                variant={settings.automationOn ? "secondary" : "default"}
                disabled={working !== null || !settings.automationAvailable}
                onClick={() =>
                  void work("automation-toggle", async () => {
                    const result = await api.setPricingAutomation(!settings.automationOn);
                    setSettings(result);
                    toast.success(
                      result.automationOn ? "Automatic pricing enabled" : "Automatic pricing paused"
                    );
                  })
                }
              >
                {settings.automationOn ? "Pause automation" : "Enable automation"}
              </Button>
            </div>
            {!settings.automationAvailable && (
              <p className="mt-3 text-sm text-ink">Automation is disabled in the server environment.</p>
            )}
          </div>
          <AdvancedRules config={config} setConfig={setConfig} />
          <SaveBar
            dirty={pricingDirty}
            working={working === "advanced"}
            text="Advanced pricing rule changes"
            onSave={() => savePricing("advanced", "Advanced pricing rules saved")}
          />
          <RunHistory
            runs={runs}
            working={working !== null}
            onRetry={(runId, submissionId) =>
              void work("retry", async () => {
                await api.retryPricingListing(runId, submissionId);
                await loadLocal();
                toast.success("Listing retry completed");
              })
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function platformLabel(channel: string) {
  const normalized = channel.toLowerCase();
  if (normalized === "booking.com") return "Booking.com";
  if (normalized === "booking_site") return "Hostex direct";
  if (normalized === "agoda") return "Agoda";
  if (normalized === "airbnb") return "Airbnb";
  return statusLabel(channel);
}

function PlatformMarkups({
  config,
  setConfig
}: {
  config: PricingConfig;
  setConfig: (config: PricingConfig) => void;
}) {
  const adjustable = config.listings.filter((listing) => listing.channelType.toLowerCase() !== "airbnb");
  return (
    <section className="rounded-xl bg-surface-raised p-5">
      <h3 className="text-title text-ink">Channel markups</h3>
      <p className="mt-1 text-sm text-ink-muted">
        Each listing is priced from the Airbnb night. Defaults are 1.2 for Booking.com and Agoda, and 1.0 for
        Hostex direct. Live plans can differ, so each rate plan has its own ratio.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {adjustable.map((listing) => (
          <label key={`${listing.channelType}-${listing.listingId}`} className="rounded-lg bg-surface p-4">
            <span className="text-sm font-medium">{platformLabel(listing.channelType)}</span>
            <span className="mt-1 block truncate text-xs text-ink-muted">{listing.listingId}</span>
            <div className="mt-2 flex items-center gap-2">
              <Input
                aria-label={`${platformLabel(listing.channelType)} ${listing.listingId} markup`}
                type="number"
                min="0"
                max="200"
                step="0.1"
                value={Math.round((listing.ratio - 1) * 1000) / 10}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    listings: config.listings.map((item) =>
                      item.channelType === listing.channelType && item.listingId === listing.listingId
                        ? { ...item, ratio: Number((1 + Number(event.target.value) / 100).toFixed(4)) }
                        : item
                    )
                  })
                }
              />
              <span>%</span>
            </div>
            <p className="mt-2 text-xs text-ink-muted">
              {listing.ratio.toFixed(3)}× · Weekend night{" "}
              {money(channelPrice(config.weekendBasePrice, listing.ratio))}
            </p>
          </label>
        ))}
      </div>
    </section>
  );
}

function SectionIntro({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-heading-s text-ink sm:text-xl sm:font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-ink-muted">{description}</p>
    </div>
  );
}

function PriceCard({
  title,
  description,
  value,
  onChange,
  unit = "PHP"
}: {
  title: string;
  description: string;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
}) {
  return (
    <label className="rounded-xl bg-surface-raised p-5">
      <span className="text-title text-ink">{title}</span>
      <span className="mt-1 block min-h-10 text-sm text-ink-muted">{description}</span>
      <span className="mt-4 flex items-center rounded-sm border border-line-strong bg-surface-raised px-4 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-primary">
        <span className="text-sm font-medium text-ink-muted">{unit}</span>
        <Input
          className="h-12 border-0 text-right text-xl font-semibold focus:outline-0"
          type="number"
          min="1"
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </span>
    </label>
  );
}

function DiscountCard({
  title,
  description,
  value,
  onChange
}: {
  title: string;
  description: string;
  value: number | null;
  onChange: (value: number) => void;
}) {
  return (
    <div className="rounded-xl bg-surface-raised p-5">
      <h3 className="text-title text-ink">{title}</h3>
      <p className="mt-1 text-sm text-ink-muted">{description}</p>
      <label className="mt-5 flex items-end gap-2">
        <Input
          className="h-14 text-3xl font-semibold"
          type="number"
          min="0"
          max="100"
          value={value ?? ""}
          placeholder="Not set"
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className="pb-3 text-xl font-semibold text-ink-muted">%</span>
      </label>
      {value === null && (
        <p className="mt-2 text-xs text-ink">Hostex did not return this discount. Enter a value to set it.</p>
      )}
    </div>
  );
}

function RuleCard({
  title,
  description,
  rules,
  onChange
}: {
  title: string;
  description: string;
  rules: AirbnbDiscountRule[];
  onChange: (rules: AirbnbDiscountRule[]) => void;
}) {
  return (
    <div className="rounded-xl bg-surface-raised p-5">
      <h3 className="text-title text-ink">{title}</h3>
      <p className="mt-1 text-sm text-ink-muted">{description}</p>
      <div className="mt-4 space-y-3">
        {rules.map((rule, index) => (
          <div key={`${rule.days}-${index}`} className="grid grid-cols-[1fr_1fr_36px] gap-2">
            <label className="text-xs text-ink-muted">
              Discount %
              <Input
                className="mt-1"
                type="number"
                min="0"
                max="100"
                value={rule.discount}
                onChange={(event) =>
                  onChange(
                    rules.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, discount: Number(event.target.value) } : item
                    )
                  )
                }
              />
            </label>
            <label className="text-xs text-ink-muted">
              Days before arrival
              <Input
                className="mt-1"
                type="number"
                min="1"
                value={rule.days}
                onChange={(event) =>
                  onChange(
                    rules.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, days: Number(event.target.value) } : item
                    )
                  )
                }
              />
            </label>
            <Button
              aria-label={`Remove ${title} rule`}
              className="mt-5"
              size="icon"
              variant="secondary"
              onClick={() => onChange(rules.filter((_, itemIndex) => itemIndex !== index))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        {rules.length === 0 && (
          <EmptyState
            size="sm"
            icon={Percent}
            title="No discount set"
            description="Add a rule to discount long stays or last-minute nights."
          />
        )}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onChange([...rules, { discount: 10, days: title === "Early-bird" ? 60 : 2 }])}
        >
          Add rule
        </Button>
      </div>
    </div>
  );
}

function ToggleCard({
  title,
  description,
  checked,
  onChange
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl bg-surface-raised p-5">
      <span>
        <span className="text-title text-ink">{title}</span>
        <span className="mt-1 block text-sm text-ink-muted">{description}</span>
      </span>
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />
    </label>
  );
}

function SettingCard({
  label,
  suffix,
  value,
  onChange
}: {
  label: string;
  suffix: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="rounded-xl bg-surface-raised p-5">
      <span className="text-title text-ink">{label}</span>
      <span className="mt-4 flex items-center gap-2">
        <Input
          type="number"
          min="0"
          value={value ?? ""}
          placeholder="Not set"
          onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
        />
        <span className="whitespace-nowrap text-sm text-ink-muted">{suffix}</span>
      </span>
      {value === null && <span className="mt-2 block text-xs text-ink">No value returned by Hostex.</span>}
    </label>
  );
}

function WeekdayCard({
  label,
  selected,
  onChange
}: {
  label: string;
  selected: number[];
  onChange: (days: number[]) => void;
}) {
  return (
    <div className="rounded-xl bg-surface-raised p-5">
      <h3 className="text-title text-ink">{label}</h3>
      <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-7">
        {weekdays.map((day, index) => {
          const active = selected.includes(index);
          return (
            <button
              key={day}
              type="button"
              aria-pressed={active}
              className={`h-11 rounded-full text-sm font-medium transition-colors ${active ? "bg-primary text-on-primary" : "bg-surface-sunken text-ink-muted hover:text-ink"}`}
              onClick={() =>
                onChange(active ? selected.filter((value) => value !== index) : [...selected, index].sort())
              }
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SaveBar({
  dirty,
  working,
  text,
  onSave
}: {
  dirty: boolean;
  working: boolean;
  text: string;
  onSave: () => void;
}) {
  return (
    <ActionBar fixed={false} className={`justify-between ${dirty ? "sm:sticky sm:bottom-4 z-10" : ""}`}>
      <p className="min-w-0 flex-1 text-sm text-ink-muted">
        {dirty ? `${text} are not saved yet.` : "Everything is up to date."}
      </p>
      <Button disabled={!dirty} loading={working} loadingText="Saving…" onClick={onSave}>
        <Save className="size-4" />
        Save changes
      </Button>
    </ActionBar>
  );
}

function HostexUnavailable({
  error,
  loading,
  retry
}: {
  error: string | null;
  loading: boolean;
  retry: () => void;
}) {
  return (
    <EmptyState
      className="rounded-xl bg-yellow-soft"
      tone="attention"
      icon={CloudOff}
      title="Live Airbnb settings are unavailable"
      description={`${error || "Hostex did not return the listing settings."} Nothing can be saved until the live values are loaded.`}
      action={
        <Button variant="secondary" loading={loading} loadingText="Retrying…" onClick={retry}>
          <RefreshCw className="size-4" />
          Retry
        </Button>
      }
    />
  );
}

function AdvancedRules({
  config,
  setConfig
}: {
  config: PricingConfig;
  setConfig: (config: PricingConfig) => void;
}) {
  return (
    <div className="space-y-3">
      <details className="rounded-xl bg-surface-raised p-5">
        <summary className="cursor-pointer font-semibold text-ink">Pace, horizon, and extra guests</summary>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField
            label="Pace window"
            suffix="days"
            value={config.paceHorizonDays}
            onChange={(value) => setConfig({ ...config, paceHorizonDays: value })}
          />
          <NumberField
            label="Behind-pace below"
            suffix="%"
            value={config.lastMinutePaceThreshold * 100}
            onChange={(value) => setConfig({ ...config, lastMinutePaceThreshold: value / 100 })}
          />
          <NumberField
            label="High occupancy from"
            suffix="%"
            value={config.highOccupancyThreshold * 100}
            onChange={(value) => setConfig({ ...config, highOccupancyThreshold: value / 100 })}
          />
          <NumberField
            label="High occupancy lift"
            suffix="%"
            value={config.highOccupancyPremium * 100}
            onChange={(value) => setConfig({ ...config, highOccupancyPremium: value / 100 })}
          />
          <NumberField
            label="Pricing horizon"
            suffix="days"
            value={config.horizonDays}
            onChange={(value) => setConfig({ ...config, horizonDays: value })}
          />
          <NumberField
            label="Round prices to"
            prefix="PHP"
            value={config.roundTo}
            onChange={(value) => setConfig({ ...config, roundTo: value })}
          />
          <NumberField
            label="Extra guest fee"
            prefix="PHP"
            value={config.extraGuestFee}
            onChange={(value) => setConfig({ ...config, extraGuestFee: value })}
          />
          <NumberField
            label="Guests included"
            suffix="guests"
            value={config.includedGuests}
            onChange={(value) => setConfig({ ...config, includedGuests: value })}
          />
          <NumberField
            label="Weekly discount note"
            suffix="%"
            value={config.weeklyDiscountPercent}
            onChange={(value) => setConfig({ ...config, weeklyDiscountPercent: value })}
          />
          <NumberField
            label="Monthly discount note"
            suffix="%"
            value={config.monthlyDiscountPercent}
            onChange={(value) => setConfig({ ...config, monthlyDiscountPercent: value })}
          />
        </div>
        <p className="mt-3 text-sm text-ink-muted">
          The extra-guest fee is pushed to Airbnb on apply (₱{config.extraGuestFee} after{" "}
          {config.includedGuests} guests). Booking.com, Agoda, and direct need the same fee set in each
          channel. Weekly and monthly percentages are recorded here and are not pushed.
        </p>
      </details>
      <details className="rounded-xl bg-surface-raised p-5">
        <summary className="cursor-pointer font-semibold text-ink">Other platform adjustments</summary>
        <p className="mt-2 text-sm text-ink-muted">
          Shown as the percentage above or below the calculated Airbnb price.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {config.listings.map((listing, index) =>
            ["airbnb", "agoda", "booking.com"].includes(listing.channelType.toLowerCase()) ? null : (
              <NumberField
                key={`${listing.channelType}-${listing.listingId}`}
                label={platformLabel(listing.channelType)}
                suffix="% adjustment"
                value={Math.round((listing.ratio - 1) * 100)}
                onChange={(value) => {
                  const listings = [...config.listings];
                  listings[index] = { ...listing, ratio: 1 + value / 100 };
                  setConfig({ ...config, listings });
                }}
              />
            )
          )}
        </div>
      </details>
      <details className="rounded-xl bg-surface-raised p-5">
        <summary className="cursor-pointer font-semibold text-ink">Dated events</summary>
        <p className="mt-2 text-sm text-ink-muted">
          Holidays are dated so a moving feast can change year to year. Minimum stay applies to every channel
          on those arrival dates.
        </p>
        <div className="mt-4 space-y-3">
          {config.events.map((event, index) => (
            <div
              key={`${event.name}-${event.startDate}-${index}`}
              className="grid gap-2 rounded-lg bg-surface p-3 sm:grid-cols-2 lg:grid-cols-4"
            >
              <Input
                aria-label="Event name"
                value={event.name}
                onChange={(change) => updateEvent(config, setConfig, index, { name: change.target.value })}
              />
              <Input
                aria-label="Event start"
                type="date"
                value={event.startDate}
                onChange={(change) =>
                  updateEvent(config, setConfig, index, { startDate: change.target.value })
                }
              />
              <Input
                aria-label="Event end"
                type="date"
                value={event.endDate}
                onChange={(change) => updateEvent(config, setConfig, index, { endDate: change.target.value })}
              />
              <Input
                aria-label="Event price"
                type="number"
                value={event.price}
                onChange={(change) => {
                  const price = Number(change.target.value);
                  updateEvent(config, setConfig, index, {
                    price,
                    minPrice: price,
                    maxPrice: price
                  });
                }}
              />
              <Input
                aria-label="Event minimum stay"
                type="number"
                min="1"
                placeholder="Min nights"
                value={event.minStay ?? ""}
                onChange={(change) =>
                  updateEvent(config, setConfig, index, {
                    minStay: change.target.value === "" ? undefined : Number(change.target.value)
                  })
                }
              />
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function updateEvent(
  config: PricingConfig,
  setConfig: (config: PricingConfig) => void,
  index: number,
  patch: Partial<PricingConfig["events"][number]>
) {
  const events = config.events.map((event, eventIndex) =>
    eventIndex === index ? { ...event, ...patch } : event
  );
  setConfig({ ...config, events });
}

function NumberField({
  label,
  value,
  onChange,
  prefix,
  suffix
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <label>
      <Label>{label}</Label>
      <span className="mt-2 flex items-center gap-2">
        <span className="text-sm text-ink-muted">{prefix}</span>
        <Input
          type="number"
          value={Number(value.toFixed(2))}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className="whitespace-nowrap text-sm text-ink-muted">{suffix}</span>
      </span>
    </label>
  );
}

function PreviewPanel({
  preview,
  working,
  dirty,
  onPreview,
  onApply
}: {
  preview: PricingPreview | null;
  working: boolean;
  dirty: boolean;
  onPreview: () => void;
  onApply: () => void;
}) {
  return (
    <section className="rounded-xl bg-surface-raised p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-ink">Preview and publish now</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Preview stores the nightly price and the arrival minimum for every channel. It does not write to
            Hostex. {dirty && "Save your changes before previewing or applying."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {preview && (
            <Button
              variant="secondary"
              onClick={() =>
                downloadText(
                  `pricing-preview-${preview.startedAt.slice(0, 10)}.csv`,
                  pricingPreviewCsv(preview)
                )
              }
            >
              <Download className="size-4" />
              Export CSV
            </Button>
          )}
          <Button variant="secondary" disabled={working} onClick={onPreview}>
            <Calculator className="size-4" />
            Create preview
          </Button>
        </div>
      </div>
      {preview && (
        <>
          <div className="mt-4 max-h-72 overflow-auto rounded-lg border border-hairline">
            <div className="divide-y divide-hairline">
              {preview.days.map((day) => (
                <div
                  key={day.date}
                  className="flex flex-col gap-2 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium text-ink">{formatDate(day.date)}</p>
                    <p className="text-xs text-ink-muted">
                      {day.leadDays !== undefined && `${day.leadDays} days away · `}
                      {day.minStay} night minimum
                      {day.event ? ` · ${day.event}` : ""}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {day.reasons.filter((reason) => !reason.includes("days away")).join(", ")}
                    </p>
                  </div>
                  {day.available ? (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs sm:justify-end">
                      {(day.platformPrices?.length
                        ? day.platformPrices
                        : [{ channelType: "airbnb", listingId: "airbnb", price: day.airbnbPrice }]
                      )
                        .filter(
                          (item, index, items) =>
                            items.findIndex(
                              (other) => other.channelType === item.channelType && other.price === item.price
                            ) === index
                        )
                        .map((item) => (
                          <span key={`${item.channelType}-${item.listingId}`}>
                            {platformLabel(item.channelType)} <strong>{money(item.price)}</strong>
                          </span>
                        ))}
                    </div>
                  ) : (
                    <Badge>Skipped · booked or blocked</Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                className="mt-4 w-full sm:w-auto"
                disabled={working || !preview.days.some((day) => day.available)}
              >
                <Play className="size-4" />
                Apply this preview
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>Submit these prices to Hostex?</AlertDialogTitle>
              <AlertDialogDescription>
                This writes prices and arrival minimum stays for{" "}
                {preview.days.filter((day) => day.available).length} available nights on each configured
                listing: Airbnb, every Booking.com rate plan, Agoda, and Hostex direct. Booked nights are
                skipped. Hostex acceptance only queues the channel update.
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction disabled={working} onClick={onApply}>
                  Apply prices
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </section>
  );
}

function RunHistory({
  runs,
  working,
  onRetry
}: {
  runs: PricingRun[];
  working: boolean;
  onRetry: (runId: string, submissionId: string) => void;
}) {
  return (
    <details className="rounded-xl bg-surface-raised p-5">
      <summary className="cursor-pointer font-semibold text-ink">History and failed-listing retries</summary>
      <div className="mt-4 divide-y divide-hairline">
        {runs.slice(0, 8).map((run) => (
          <div key={run.id} className="py-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-ink">{statusLabel(run.mode)}</span>
              <Badge>{statusLabel(run.status)}</Badge>
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              {formatDateTime(run.startedAt)} · settings v{run.settingsVersion}
            </p>
            {latestSubmissions(run).map((submission) => (
              <div key={submission.id} className="mt-2 rounded-lg bg-surface-sunken p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span>
                    {statusLabel(submission.channelType)} · attempt {submission.attempt}
                  </span>
                  <Badge>{statusLabel(submission.status)}</Badge>
                </div>
                {submission.error && <p className="mt-1 text-danger">{submission.error}</p>}
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
                        This submits the same immutable preview only to {submission.channelType}.
                      </AlertDialogDescription>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => onRetry(run.id, submission.id)}>
                          Retry listing
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            ))}
          </div>
        ))}
        {runs.length === 0 && (
          <EmptyState
            icon={LineChart}
            title="No pricing runs yet"
            description="Runs appear here after the first pricing update."
          />
        )}
      </div>
    </details>
  );
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
    <div className="min-w-0 rounded-xl bg-surface-raised p-3 sm:p-5">
      <span
        className={`grid size-9 place-items-center rounded-full sm:size-11 ${good ? "bg-green text-on-accent" : "bg-orange text-on-accent"}`}
      >
        <Icon className="size-4 sm:size-5" strokeWidth={1.75} />
      </span>
      <p className="mt-3 truncate text-xs text-ink-muted sm:text-sm">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-ink sm:text-base">{value}</p>
    </div>
  );
}

function downloadText(filename: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function discountAt(rules: AirbnbDiscountRule[], days: number) {
  return rules.find((rule) => rule.days === days)?.discount ?? null;
}
function setDiscountAt(rules: AirbnbDiscountRule[], days: number, discount: number) {
  const next = new Map(rules.map((rule) => [rule.days, rule]));
  next.set(days, { days, discount });
  return [...next.values()].sort((left, right) => left.days - right.days);
}
function changedDiscountPatch(current: AirbnbPricingRules, draft: AirbnbDraft): AirbnbPricingRulesPatch {
  const patch: AirbnbPricingRulesPatch = {};
  const currentWeekly = discountAt(current.longTermDiscount, 7);
  const draftWeekly = discountAt(draft.longTermDiscount, 7);
  const currentMonthly = discountAt(current.longTermDiscount, 28);
  const draftMonthly = discountAt(draft.longTermDiscount, 28);
  if (draftWeekly !== null && currentWeekly !== draftWeekly) patch.weeklyDiscount = draftWeekly;
  if (draftMonthly !== null && currentMonthly !== draftMonthly) patch.monthlyDiscount = draftMonthly;
  if (!sameValue(current.earlyBirdDiscount, draft.earlyBirdDiscount))
    patch.earlyBirdDiscount = draft.earlyBirdDiscount;
  if (!sameValue(current.lastMinuteDiscount, draft.lastMinuteDiscount))
    patch.lastMinuteDiscount = draft.lastMinuteDiscount;
  if (current.highRatedGuestDiscount !== draft.highRatedGuestDiscount)
    patch.highRatedGuestDiscount = draft.highRatedGuestDiscount;
  if (current.mobileOnlyDiscount !== draft.mobileOnlyDiscount)
    patch.mobileOnlyDiscount = draft.mobileOnlyDiscount;
  return patch;
}

function changedAvailabilityPatch(current: AirbnbPricingRules, draft: AirbnbDraft): AirbnbPricingRulesPatch {
  const patch: AirbnbPricingRulesPatch = {};
  if (current.minimumStay !== draft.minimumStay) patch.minimumStay = draft.minimumStay;
  if (current.maximumStay !== draft.maximumStay) patch.maximumStay = draft.maximumStay;
  if (draft.advanceNotice !== null && current.advanceNotice !== draft.advanceNotice)
    patch.advanceNotice = draft.advanceNotice;
  if (current.availabilityWindow !== draft.availabilityWindow)
    patch.availabilityWindow = draft.availabilityWindow;
  if (current.preparationTime !== draft.preparationTime) patch.preparationTime = draft.preparationTime;
  if (!sameValue(current.daysOfWeekCheckIn, draft.daysOfWeekCheckIn))
    patch.daysOfWeekCheckIn = draft.daysOfWeekCheckIn;
  if (!sameValue(current.daysOfWeekCheckOut, draft.daysOfWeekCheckOut))
    patch.daysOfWeekCheckOut = draft.daysOfWeekCheckOut;
  return patch;
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
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
