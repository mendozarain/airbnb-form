import { CheckCircle2, Loader2, RefreshCw, Upload, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { EmailTemplate, EmailTemplateKind, EmailTemplateSet, SettingsStatus } from "@cozy-d-714/shared";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";

const EMPTY_TEMPLATES: EmailTemplateSet = {
  tenant: { subject: "", html: "" },
  visitorViewing: { subject: "", html: "" }
};

export function SettingsPage() {
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [templates, setTemplates] = useState<EmailTemplateSet>(EMPTY_TEMPLATES);
  const [savedTemplates, setSavedTemplates] = useState<EmailTemplateSet>(EMPTY_TEMPLATES);
  const [activeTemplate, setActiveTemplate] = useState<EmailTemplateKind>("tenant");
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextStatus, email] = await Promise.all([api.getSettings(), api.getEmailTemplates()]);
      setStatus(nextStatus);
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

  if (loading && !status)
    return (
      <div className="space-y-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-48" />
      </div>
    );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Settings"
        description="Manage the Google browser session and the email sent after PMO submission."
        actions={
          <Button variant="secondary" onClick={() => void refresh()}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        }
      />

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Connections</h2>
          <p className="text-sm text-slate-500">
            These services are used only after you confirm a registration.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
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
            <span className="inline-flex h-10 items-center gap-2 rounded-md bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
              <Upload className="size-4" />
              Upload session
            </span>
          </label>
          <Button
            variant="secondary"
            disabled={acting || !status?.hasStorageState}
            onClick={() => void run(() => api.checkGoogle(), "Google session checked")}
          >
            {acting ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}Check
            session
          </Button>
        </div>
      </section>

      <section className="space-y-4 border-t border-slate-200 pt-7">
        <div>
          <h2 className="text-lg font-semibold">Guest email</h2>
          <p className="text-sm text-slate-500">
            Each message shows the entrance pass inline with a button for the full-size image. No file is
            attached.
          </p>
        </div>
        <Tabs value={activeTemplate} onValueChange={(value) => setActiveTemplate(value as EmailTemplateKind)}>
          <TabsList>
            <TabsTrigger value="tenant">
              Tenant{templatesEqual(templates.tenant, savedTemplates.tenant) ? "" : " •"}
            </TabsTrigger>
            <TabsTrigger value="visitorViewing">
              Visitor / Viewing
              {templatesEqual(templates.visitorViewing, savedTemplates.visitorViewing) ? "" : " •"}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">
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
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-slate-500">{dirty ? "Unsaved changes" : "All changes saved"}</span>
            <Button disabled={acting || !dirty} onClick={() => void saveActiveTemplate()}>
              Save {activeTemplate === "tenant" ? "Tenant" : "Visitor / Viewing"}
            </Button>
          </div>
        </div>
        <details className="rounded-lg border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-medium">Preview email</summary>
          <div
            className="mt-4 overflow-hidden rounded-md border border-slate-200"
            dangerouslySetInnerHTML={{ __html: template.html }}
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
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">{title}</h3>
        <Badge
          className={
            connected
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-amber-200 bg-amber-50 text-amber-700"
          }
        >
          {connected ? <CheckCircle2 className="mr-1 size-3" /> : <XCircle className="mr-1 size-3" />}
          {connected ? "Connected" : "Needs setup"}
        </Badge>
      </div>
      <p className="mt-2 text-sm text-slate-500">{detail}</p>
    </div>
  );
}
