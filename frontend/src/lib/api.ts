import type {
  BookingDetail,
  BookingSummary,
  CalendarMonth,
  CreateBookingInviteInput,
  CreateInviteInput,
  EmailTemplate,
  EmailTemplateKind,
  EmailTemplateSet,
  GuestSubmission,
  HostexAutomationStatus,
  InviteSummary,
  PricingConfig,
  PricingPreview,
  PricingRun,
  PricingSettings,
  PublicInvite,
  SettingsStatus,
  SubmissionDetail,
  SubmissionSummary
} from "@cozy-d-714/shared";

export const api = {
  me: () => request<{ admin: { id: string; email: string; name: string } }>("/api/admin/me"),
  createInvite: (body: CreateInviteInput) =>
    request<{ token: string; guestUrl: string; expiresAt: string }>("/api/admin/invites", {
      method: "POST",
      body
    }),
  listInvites: () => request<{ invites: InviteSummary[] }>("/api/admin/invites"),
  deleteInvite: (id: string) => request<{ ok: true }>(`/api/admin/invites/${id}`, { method: "DELETE" }),
  updateInvite: (id: string, body: { purpose?: string; expiresAt?: string }) =>
    request<{ ok: true }>(`/api/admin/invites/${id}`, { method: "PATCH", body }),
  regenerateInvite: (id: string, expiresAt?: string) =>
    request<{ id: string; guestUrl: string; expiresAt: string }>(`/api/admin/invites/${id}/regenerate`, {
      method: "POST",
      body: { expiresAt }
    }),
  assignInviteBooking: (id: string, bookingId: string | null) =>
    request<{ ok: true }>(`/api/admin/invites/${id}/booking`, { method: "PATCH", body: { bookingId } }),
  listBookings: (params: { start?: string; end?: string; status?: string; query?: string } = {}) =>
    request<{ bookings: BookingSummary[] }>(`/api/admin/bookings${queryString(params)}`),
  getBooking: (id: string) => request<{ booking: BookingDetail }>(`/api/admin/bookings/${id}`),
  listUncategorizedRegistrations: () =>
    request<{ registrations: Array<{ invite: InviteSummary; submission?: SubmissionSummary | null }> }>(
      "/api/admin/bookings/uncategorized/list"
    ),
  syncBookings: () =>
    request<{ ok: true; found?: number; sent?: number }>("/api/admin/bookings/sync", { method: "POST" }),
  createBookingInvite: (bookingId: string, body: CreateBookingInviteInput) =>
    request<{ inviteId: string; guestUrl: string; expiresAt: string }>(
      `/api/admin/bookings/${bookingId}/invites`,
      {
        method: "POST",
        body
      }
    ),
  sendBookingInvite: (inviteId: string, allowUnknownDuplicate = false) =>
    request<{ status: string }>(`/api/admin/bookings/invites/${inviteId}/send`, {
      method: "POST",
      body: { allowUnknownDuplicate }
    }),
  reconcileBookingInvite: (inviteId: string) =>
    request<{ ok: true; confirmed: boolean; status: string }>(
      `/api/admin/bookings/invites/${inviteId}/reconcile`,
      { method: "POST" }
    ),
  syncHostex: () =>
    request<{ ok: true; found?: number; sent?: number; alreadyRunning?: boolean }>("/api/admin/hostex/sync", {
      method: "POST"
    }),
  getHostexStatus: () => request<HostexAutomationStatus>("/api/admin/hostex/status"),
  sendHostexInvite: (id: string, allowUnknownDuplicate = false) =>
    request<{ status?: string }>(`/api/admin/hostex/invites/${id}/send`, {
      method: "POST",
      body: { allowUnknownDuplicate }
    }),
  reconcileHostexInvite: (id: string) =>
    request<{ ok: true; confirmed: boolean; status?: string }>(`/api/admin/hostex/invites/${id}/reconcile`, {
      method: "POST"
    }),
  getInvite: (token: string) => request<PublicInvite>(`/api/invites/${token}`),
  submitGuest: (token: string, body: GuestSubmission) =>
    request<{ submissionId: string; status: string }>(`/api/invites/${token}/submission`, {
      method: "POST",
      body
    }),
  listSubmissions: (status: string) =>
    request<{ submissions: SubmissionSummary[] }>(
      `/api/admin/submissions?status=${encodeURIComponent(status)}`
    ),
  getSubmission: (id: string) =>
    request<{ submission: SubmissionDetail & { latestError?: string | null } }>(
      `/api/admin/submissions/${id}`
    ),
  updateSubmission: (id: string, body: unknown) =>
    request<{ ok: true; status: string }>(`/api/admin/submissions/${id}`, { method: "PATCH", body }),
  uploadSubmissionEditFile: (id: string, file: File) =>
    upload<{ key: string; filename: string; size: number }>(
      `/api/admin/submissions/${id}/files`,
      "file",
      file
    ),
  confirmSubmission: (id: string) =>
    request<{ status: string; alreadyRunning?: boolean }>(`/api/admin/submissions/${id}/confirm`, {
      method: "POST"
    }),
  retrySubmissionEmail: (id: string) =>
    request<{ ok: true; status: string }>(`/api/admin/submissions/${id}/retry-email`, {
      method: "POST"
    }),
  rejectSubmission: (id: string) =>
    request<{ ok: true }>(`/api/admin/submissions/${id}/reject`, { method: "POST" }),
  resetSubmission: (id: string) =>
    request<{ ok: true }>(`/api/admin/submissions/${id}/reset-submitting`, { method: "POST" }),
  deleteSubmission: (id: string) =>
    request<{ ok: true }>(`/api/admin/submissions/${id}`, { method: "DELETE" }),
  getSettings: () => request<SettingsStatus>("/api/admin/settings/status"),
  getEmailTemplates: () => request<{ templates: EmailTemplateSet }>("/api/admin/settings/email-templates"),
  saveEmailTemplate: (kind: EmailTemplateKind, body: EmailTemplate) =>
    request<{ template: EmailTemplate }>(`/api/admin/settings/email-templates/${kind}`, {
      method: "POST",
      body
    }),
  checkGoogle: () =>
    request<SettingsStatus["lastCheck"]>("/api/admin/settings/google-session/check", { method: "POST" }),
  uploadFile: (token: string, file: File) =>
    upload<{ key: string; filename: string; size: number }>(`/api/invites/${token}/files`, "file", file),
  uploadGoogleState: (file: File) =>
    upload<{ connected: boolean }>("/api/admin/settings/google-session/upload", "storageState", file),
  getCalendar: (start: string, end: string) =>
    request<CalendarMonth>(
      `/api/admin/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
    ),
  syncCalendar: (start: string, end: string) =>
    request<{ ok: true; days: number; syncedAt: string }>("/api/admin/calendar/sync", {
      method: "POST",
      body: { start, end }
    }),
  getPricingSettings: () => request<PricingSettings>("/api/admin/pricing/settings"),
  updatePricingSettings: (version: number, config: PricingConfig) =>
    request<PricingSettings>("/api/admin/pricing/settings", { method: "PUT", body: { version, config } }),
  setPricingAutomation: (enabled: boolean) =>
    request<PricingSettings>("/api/admin/pricing/automation", { method: "POST", body: { enabled } }),
  previewPricing: () => request<PricingPreview>("/api/admin/pricing/preview", { method: "POST" }),
  applyPricing: (id: string) =>
    request<{ run: PricingPreview }>(`/api/admin/pricing/runs/${id}/apply`, { method: "POST" }),
  retryPricingListing: (runId: string, submissionId: string) =>
    request<{ run: PricingRun }>(`/api/admin/pricing/runs/${runId}/submissions/${submissionId}/retry`, {
      method: "POST",
      body: { confirm: true }
    }),
  listPricingRuns: () => request<{ runs: PricingRun[] }>("/api/admin/pricing/runs")
};

function queryString(params: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const result = query.toString();
  return result ? `?${result}` : "";
}

async function request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    credentials: "include",
    cache: "no-store",
    headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  return read<T>(response);
}

async function upload<T>(path: string, field: string, file: File): Promise<T> {
  const form = new FormData();
  form.append(field, file);
  return read<T>(await fetch(path, { method: "POST", credentials: "include", body: form }));
}

async function read<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
    throw new Error(message ?? body.error ?? "Request failed");
  }
  return body as T;
}
