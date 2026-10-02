import { RefreshCw, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type {
  EmailTemplate,
  EmailTemplateKind,
  EmailTemplateSet,
  HostexAutomationStatus,
  PricingSettings,
  SettingsStatus
} from "@cozy-d-714/shared";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingCard } from "@/components/ui/loading";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";

const EMPTY_TEMPLATES: EmailTemplateSet = {
  tenant: { subject: "", html: "" },
  visitorViewing: { subject: "", html: "" }
};

export function SettingsPage() {
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [hostex, setHostex] = useState<HostexAutomationStatus | null>(null);
  const [pricing, setPricing] = useState<PricingSettings | null>(null);
  const [templates, setTemplates] = useState<EmailTemplateSet>(EMPTY_TEMPLATES);
  const [savedTemplates, setSavedTemplates] = useState<EmailTemplateSet>(EMPTY_TEMPLATES);
  const [activeTemplate, setActiveTemplate] = useState<EmailTemplateKind>("tenant");
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [aiReviewEmail, setAiReviewEmail] = useState("mendozarhainne@gmail.com");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextStatus, email, nextHostex, nextPricing] = await Promise.all([
        api.getSettings(),
        api.getEmailTemplates(),
        api.getHostexStatus(),
        api.getPricingSettings()
      ]);
      setStatus(nextStatus);
      setAiReviewEmail(nextStatus.aiIdCheck.reviewEmail);
      setHostex(nextHostex);
      setPricing(nextPricing);
      setTemplates(email.templates);
      setSavedTemplates(email.templates);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(action: () => Promise<unknown>, message: string) {
    setActing(true);
    try {
      await action();
      toast.success(message);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
    } finally {
      setActing(false);
    }
  }

  function updateTemplate(update: Partial<EmailTemplate>) {
    setTemplates((current) => ({
      ...current,
      [activeTemplate]: { ...current[activeTemplate], ...update }
    }));
  }

  async function saveActiveTemplate() {
    setActing(true);
    try {
      const current = templates[activeTemplate];
      const result = await api.saveEmailTemplate(activeTemplate, current);
      setTemplates((value) => ({ ...value, [activeTemplate]: result.template }));
      setSavedTemplates((value) => ({ ...value, [activeTemplate]: result.template }));
      toast.success(
        activeTemplate === "tenant" ? "Tenant email template saved" : "Visitor / Viewing email template saved"
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save email template");
    } finally {
      setActing(false);
    }
  }

  const template = templates[activeTemplate];
  const dirty = !templatesEqual(template, savedTemplates[activeTemplate]);

  if (loading && !status) return <LoadingCard label="Loading settings…" rows={5} />;

  return (
    <div className="space-y-7">
      <PageHeader
        title="Settings"
        description="Connections, safety switches, and the email sent after PMO submission."
        actions={
          <Button variant="secondary" onClick={() => void refresh()}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        }
      />

      <section className="space-y-4">
        <div>
          <h2 className="text-heading-s text-ink">Connections</h2>
          <p className="text-sm text-ink-muted">Live connection health without exposing credentials.</p>
        </div>
        <div className="grid gap-3 rounded-xl bg-surface-raised p-5 sm:p-5">
          <Connection
            title="Google session"
            connected={Boolean(status?.connected)}
            detail={status?.lastCheck?.message ?? "No session check has been recorded."}
          />
          <Connection
            title="AgentMail"
            connected={Boolean(status?.email.configured)}
            detail={
              status?.email.configured
                ? "Ready to send entrance passes."
                : "AgentMail API configuration is missing."
            }
          />
          <Connection
            title="OpenRouter AI"
            connected={Boolean(status?.aiIdCheck.configured)}
            detail={
              status?.aiIdCheck.configured
                ? `${status.aiIdCheck.model} is ready for ID checks.`
                : "OPENROUTER_API_KEY is missing; ID checks will be held for review."
            }
          />
          <Connection
            title="Hostex webhook"
            connected={Boolean(hostex?.webhookVerified)}
            detail={
              hostex?.webhookVerified
                ? `Verified${hostex.webhookVerifiedAt ? ` ${new Date(hostex.webhookVerifiedAt).toLocaleString()}` : ""}.`
                : "Waiting for the first verified Hostex event."
            }
          />
          <Connection
            title="Pricing scheduler"
            connected={Boolean(pricing?.automationAvailable && pricing.automationOn)}
            detail={
              !pricing?.automationAvailable
                ? "Railway master switch is off."
                : pricing.automationOn
                  ? "Daily 8:00 AM Manila run is enabled."
                  : "Available but paused in the database."
            }
          />
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-ink-muted">
          <Badge>Guest messages: {hostex?.automationEnabled ? "enabled" : "off"}</Badge>
          <Badge>Pricing rules: v{pricing?.version ?? "—"}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex">
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              disabled={acting}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void run(() => api.uploadGoogleState(file), "Google session uploaded");
                event.target.value = "";
              }}
            />
            <span className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-on-primary transition-transform active:scale-[.96] hover:bg-primary-hover">
              <Upload className="size-4" />
              Upload session
            </span>
          </label>
          <Button
            variant="secondary"
            disabled={acting || !status?.hasStorageState}
            onClick={() => void run(() => api.checkGoogle(), "Google session checked")}
          >
            <RefreshCw className="size-4" />
            Check session
          </Button>
        </div>
        <div className="rounded-xl bg-surface-raised p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <label className="flex cursor-pointer items-start gap-3">
              <Checkbox
                checked={status?.googleRecovery.enabled ?? false}
                disabled={acting || !status?.googleRecovery.configured}
                onCheckedChange={(checked) =>
                  void run(
                    () => api.setGoogleAutoRecovery(checked === true),
                    checked === true
                      ? "Automatic Google recovery enabled"
                      : "Automatic Google recovery disabled"
                  )
                }
              />
              <span className="space-y-1">
                <span className="block text-title">Recover Google automatically</span>
                <span className="block text-sm text-ink-muted">
                  Uses only the 1Password item for {status?.googleRecovery.expectedAccount} when the PMO form
                  redirects to Google login.
                </span>
              </span>
            </label>
            <Badge
              dot
              live={status?.googleRecovery.state === "recovering"}
              tone={
                status?.googleRecovery.state === "recovering"
                  ? "pending"
                  : status?.googleRecovery.state === "manual_required"
                    ? "attention"
                    : "done"
              }
            >
              {status?.googleRecovery.state === "recovering"
                ? "Reconnecting Google"
                : status?.googleRecovery.state === "manual_required"
                  ? "Waiting for manual Google session"
                  : "Ready"}
            </Badge>
          </div>
          {!status?.googleRecovery.configured && (
            <p className="mt-3 text-sm text-ink">
              Add the Browser Use integration, vault, item, and profile IDs in Railway before enabling
              recovery.
            </p>
          )}
          {status?.googleRecovery.lastError && (
            <p className="mt-3 text-sm text-danger">{status.googleRecovery.lastError}</p>
          )}
          {status?.pendingVerification && (
            <p className="mt-3 text-sm text-ink">
              A manually uploaded session is waiting for Check session before it can become active.
            </p>
          )}
          {status?.googleRecovery.state === "manual_required" && status.googleRecovery.configured && (
            <Button
              className="mt-3"
              variant="secondary"
              disabled={acting}
              onClick={() => void run(() => api.retryGoogleRecovery(), "Google recovery attempt completed")}
            >
              <RefreshCw className="size-4" />
              Retry automatic recovery
            </Button>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-heading-s text-ink">Registration workflow</h2>
          <p className="text-sm text-ink-muted">Choose whether new guest registrations need admin review.</p>
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-surface-raised p-5">
          <Checkbox
            checked={status?.autoQueue ?? true}
            disabled={acting}
            onCheckedChange={(checked) =>
              void run(
                () => api.setAutoQueue(checked === true),
                checked === true ? "Auto queue enabled" : "Auto queue disabled"
              )
            }
          />
          <span className="space-y-1">
            <span className="block text-title">Auto queue new registrations</span>
            <span className="block text-sm text-ink-muted">
              When enabled, a guest submission is queued for PMO processing immediately without pressing
              Confirm. This is enabled by default.
            </span>
          </span>
        </label>
        <div className="space-y-4 rounded-xl bg-surface-raised p-5">
          <label className="flex cursor-pointer items-start gap-3">
            <Checkbox
              checked={status?.aiIdCheck.enabled ?? true}
              disabled={acting}
              onCheckedChange={(checked) =>
                void run(
                  () => api.setAiIdCheck(checked === true, aiReviewEmail),
                  checked === true ? "AI ID checks enabled" : "AI ID checks disabled"
                )
              }
            />
            <span className="space-y-1">
              <span className="block text-title">Check required IDs with AI</span>
              <span className="block text-sm text-ink-muted">
                Required IDs are checked before Auto Queue. Clear name mismatches are rejected; uncertain
                results are held for manual review.
              </span>
            </span>
          </label>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="ai-review-email">AI review notification email</Label>
              <Input
                id="ai-review-email"
                type="email"
                value={aiReviewEmail}
                onChange={(event) => setAiReviewEmail(event.target.value)}
              />
            </div>
            <Button
              variant="secondary"
              disabled={acting || !aiReviewEmail.trim()}
              onClick={() =>
                void run(
                  () => api.setAiIdCheck(status?.aiIdCheck.enabled ?? true, aiReviewEmail),
                  "AI review settings saved"
                )
              }
            >
              Save review email
            </Button>
          </div>
          <p className="text-xs text-ink-muted">
            IDs are required only for guests aged 16–59. Review emails contain findings and a link, never the
            ID itself.
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-heading-s text-ink">Guest email</h2>
          <p className="text-sm text-ink-muted">
            Each message shows the entrance pass inline with a button for the full-size image. No file is
            attached.
          </p>
        </div>
        <Tabs value={activeTemplate} onValueChange={(value) => setActiveTemplate(value as EmailTemplateKind)}>
          <TabsList className="sm:max-w-md">
            <TabsTrigger value="tenant">
              Tenant{templatesEqual(templates.tenant, savedTemplates.tenant) ? "" : " •"}
            </TabsTrigger>
            <TabsTrigger value="visitorViewing">
              Visitor / Viewing
              {templatesEqual(templates.visitorViewing, savedTemplates.visitorViewing) ? "" : " •"}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="space-y-4 rounded-xl bg-surface-raised p-5">
          <p className="text-sm text-ink-muted">
            {activeTemplate === "tenant"
              ? "Complete arrival, check-in, appliance, and stay guide for tenants."
              : "Shared essentials-only message for visitors of tenants and property viewings."}
          </p>
          <div className="space-y-2">
            <Label htmlFor={`${activeTemplate}-subject`}>Subject</Label>
            <Input
              id={`${activeTemplate}-subject`}
              value={template.subject}
              onChange={(event) => updateTemplate({ subject: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${activeTemplate}-html`}>HTML body</Label>
            <Textarea
              id={`${activeTemplate}-html`}
              className="min-h-72 font-mono text-xs"
              value={template.html}
              onChange={(event) => updateTemplate({ html: event.target.value })}
            />
            <p className="text-xs text-ink-muted">
              Use <code className="rounded-sm bg-surface px-1">{"{{greeting_name}}"}</code> in the subject or
              body. It becomes the guest's first name when the email is sent.
            </p>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-ink-muted">{dirty ? "Unsaved changes" : "All changes saved"}</span>
            <Button
              disabled={!dirty}
              loading={acting}
              loadingText="Saving…"
              onClick={() => void saveActiveTemplate()}
            >
              Save {activeTemplate === "tenant" ? "Tenant" : "Visitor / Viewing"}
            </Button>
          </div>
        </div>
        <details className="rounded-xl bg-surface-raised p-5">
          <summary className="cursor-pointer text-sm font-medium">Preview email</summary>
          <div
            className="mt-4 overflow-hidden rounded-lg border border-hairline"
            dangerouslySetInnerHTML={{ __html: template.html.replaceAll("{{greeting_name}}", "Maria") }}
          />
        </details>
      </section>
    </div>
  );
}

function templatesEqual(left: EmailTemplate, right: EmailTemplate) {
  return left.subject === right.subject && left.html === right.html;
}

function Connection({ title, connected, detail }: { title: string; connected: boolean; detail: string }) {
  return (
    <div className="sg-row flex flex-col gap-2 rounded-lg bg-surface-sunken p-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
      <div className="min-w-0 flex-1">
        <h3 className="text-title text-ink">{title}</h3>
        <p className="mt-0.5 text-sm text-ink-muted">{detail}</p>
      </div>
      <Badge tone={connected ? "done" : "attention"} dot>
        {connected ? "Connected" : "Needs setup"}
      </Badge>
    </div>
  );
}
