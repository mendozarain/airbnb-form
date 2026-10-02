import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  CloudOff,
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
import {
  PRICING_TIERS,
  channelPrice,
  tierPrice,
  startingPrice as roundStartingPrice
} from "@cozy-d-714/shared";
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
  const weekendPrice = Math.round(config.baseAirbnbPrice * (1 + config.weekendPremium));

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
              title="Base price"
              description="Starting rate for nights 31+ days away"
              value={config.baseAirbnbPrice}
              onChange={(value) => setConfig({ ...config, baseAirbnbPrice: value })}
            />
            <PriceCard
              title="Weekend price"
              description="Friday and Saturday nights"
              value={weekendPrice}
              onChange={(value) =>
                setConfig({
                  ...config,
                  weekendPremium: Math.max(0, (value - config.baseAirbnbPrice) / config.baseAirbnbPrice)
                })
              }
            />
            <PriceCard
              title="Minimum price"
              description="Airbnb nightly floor before discounts and fees"
              value={config.minimumAirbnbPrice}
              onChange={(value) => setConfig({ ...config, minimumAirbnbPrice: value })}
            />
            <PriceCard
              title="Maximum price"
              description="Maximum outside events"
              value={config.maximumNonEventAirbnbPrice}
              onChange={(value) => setConfig({ ...config, maximumNonEventAirbnbPrice: value })}
            />
          </div>
          <TierTable config={config} />
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
            description="Saved directly to Airbnb through Hostex and confirmed from the live listing."
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
  if (channel.toLowerCase() === "booking.com") return "Booking.com";
  return statusLabel(channel);
}

function PlatformMarkups({
  config,
  setConfig
}: {
  config: PricingConfig;
  setConfig: (config: PricingConfig) => void;
}) {
  return (
    <section className="rounded-xl bg-surface-raised p-5">
      <h3 className="text-title text-ink">Platform markups</h3>
      <p className="mt-1 text-sm text-ink-muted">
        Added after the nightly tier to allow for platform costs and delayed payouts. Guest discounts and fees
        still affect your earnings.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {["booking.com", "agoda"].map((channel) => {
          const listing = config.listings.find((item) => item.channelType.toLowerCase() === channel);
          if (!listing) return null;
          return (
            <label key={channel} className="rounded-lg bg-surface p-4">
              <span className="text-sm font-medium">{platformLabel(channel)} markup</span>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  aria-label={`${platformLabel(channel)} markup`}
                  type="number"
                  min="20"
                  max="40"
                  step="1"
                  value={Math.round((listing.ratio - 1) * 100)}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      listings: config.listings.map((item) =>
                        item.channelType.toLowerCase() === channel
                          ? { ...item, ratio: Number((1 + Number(event.target.value) / 100).toFixed(4)) }
                          : item
                      )
                    })
                  }
                />
                <span>%</span>
              </div>
              <p className="mt-2 text-xs text-ink-muted">
                20–40% · At the Airbnb floor: {money(channelPrice(config.minimumAirbnbPrice, listing.ratio))}
              </p>
            </label>
          );
        })}
      </div>
    </section>
  );
}

function TierTable({ config }: { config: PricingConfig }) {
  const startingPrice = roundStartingPrice(
    config.baseAirbnbPrice,
    config.minimumAirbnbPrice,
    config.maximumNonEventAirbnbPrice,
    config.roundTo
  );
  const platforms = config.listings.filter(
    (listing, index, listings) =>
      listings.findIndex(
        (other) => other.channelType === listing.channelType && other.ratio === listing.ratio
      ) === index
  );
  return (
    <section className="min-w-0 rounded-xl bg-surface-raised p-5">
      <h3 className="text-title text-ink">Empty nights get cheaper as they approach</h3>
      <p className="mt-1 text-sm text-ink-muted">
        Weekday examples using your current inputs. Weekend and event premiums also fade to the minimum within
        two days.
      </p>
      {config.baseAirbnbPrice === config.minimumAirbnbPrice && (
        <p className="mt-2 text-sm text-ink">
          Base and minimum are equal, so ordinary nights have a flat price.
        </p>
      )}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full whitespace-nowrap text-left text-sm">
          <thead>
            <tr>
              <th className="p-2">Days away</th>
              {platforms.map((listing) => (
                <th className="p-2" key={listing.listingId}>
                  {platformLabel(listing.channelType)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PRICING_TIERS.map((tier) => {
              const price = tierPrice(
                startingPrice,
                config.minimumAirbnbPrice,
                tier.minimumDays,
                config.roundTo
              );
              return (
                <tr key={tier.label} className="border-t border-hairline">
                  <td className="p-2">{tier.label}</td>
                  {platforms.map((listing) => (
                    <td className="p-2 font-medium" key={listing.listingId}>
                      {money(channelPrice(price, listing.ratio))}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
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
  onChange
}: {
  title: string;
  description: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="rounded-xl bg-surface-raised p-5">
      <span className="text-title text-ink">{title}</span>
      <span className="mt-1 block min-h-10 text-sm text-ink-muted">{description}</span>
      <span className="mt-4 flex items-center rounded-sm border border-line-strong bg-surface-raised px-4 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-primary">
        <span className="text-sm font-medium text-ink-muted">PHP</span>
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
        <summary className="cursor-pointer font-semibold text-ink">Events, horizon, and rounding</summary>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField
            label="Event increase"
            suffix="%"
            value={config.eventBoost * 100}
            onChange={(value) => setConfig({ ...config, eventBoost: value / 100 })}
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
        </div>
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
        <summary className="cursor-pointer font-semibold text-ink">Recurring events</summary>
        <div className="mt-4 space-y-3">
          {config.recurringEvents.map((event, index) => (
            <div
              key={`${event.name}-${index}`}
              className="grid gap-2 rounded-lg bg-surface p-3 sm:grid-cols-[1fr_110px_110px]"
            >
              <Input
                aria-label="Event name"
                value={event.name}
                onChange={(change) => {
                  const recurringEvents = [...config.recurringEvents];
                  recurringEvents[index] = { ...event, name: change.target.value };
                  setConfig({ ...config, recurringEvents });
                }}
              />
              <Input
                aria-label="Event start"
                value={event.start}
                onChange={(change) => {
                  const recurringEvents = [...config.recurringEvents];
                  recurringEvents[index] = { ...event, start: change.target.value };
                  setConfig({ ...config, recurringEvents });
                }}
              />
              <Input
                aria-label="Event end"
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
      </details>
    </div>
  );
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
            Preview reads Hostex but never writes prices.{" "}
            {dirty && "Save your changes before previewing or applying."}
          </p>
        </div>
        <Button variant="secondary" disabled={working} onClick={onPreview}>
          <Calculator className="size-4" />
          Create preview
        </Button>
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
                      {day.tier}
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
                This writes prices for {preview.days.filter((day) => day.available).length} available nights
                across your configured platforms. Booked and blocked nights are skipped. Hostex acceptance
                starts asynchronous platform updates.
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
