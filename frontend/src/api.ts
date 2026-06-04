import type { CreateInviteInput, GuestSubmission } from "@cozy-d-714/shared";
import { getAdminAccessToken } from "./authClient";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";

export async function createInvite(input: CreateInviteInput) {
  const response = await appFetch(`${API_BASE}/api/admin/invites`, {
    method: "POST",
    headers: await adminJsonHeaders(),
    body: JSON.stringify(input)
  });
  return readJson(response);
}

export async function listInvites() {
  const response = await appFetch(`${API_BASE}/api/admin/invites`, {
    headers: await adminHeaders()
  });
  return readJson(response);
}

export async function deleteInvite(id: string) {
  const response = await appFetch(`${API_BASE}/api/admin/invites/${id}`, {
    method: "DELETE",
    headers: await adminHeaders()
  });
  return readJson(response);
}

export async function getInvite(token: string) {
  const response = await appFetch(`${API_BASE}/api/invites/${token}`);
  return readJson(response);
}

export async function submitGuestForm(token: string, input: GuestSubmission) {
  const response = await appFetch(`${API_BASE}/api/invites/${token}/submission`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return readJson(response);
}

export async function uploadGuestFile(token: string, file: File) {
  const body = new FormData();
  body.append("file", file);

  const response = await appFetch(`${API_BASE}/api/invites/${token}/files`, {
    method: "POST",
    body
  });
  return readJson(response);
}

export async function listSubmissions(status?: string) {
  const url = new URL(`${API_BASE}/api/admin/submissions`);
  if (status) url.searchParams.set("status", status);

  const response = await appFetch(url, {
    headers: await adminHeaders()
  });
  return readJson(response);
}

export async function getSubmission(id: string) {
  const response = await appFetch(`${API_BASE}/api/admin/submissions/${id}`, {
    headers: await adminHeaders()
  });
  return readJson(response);
}

export async function confirmSubmission(id: string) {
  const response = await appFetch(`${API_BASE}/api/admin/submissions/${id}/confirm`, {
    method: "POST",
    headers: await adminHeaders()
  });
  return readJson(response);
}

export async function rejectSubmission(id: string) {
  const response = await appFetch(`${API_BASE}/api/admin/submissions/${id}/reject`, {
    method: "POST",
    headers: await adminHeaders()
  });
  return readJson(response);
}

export async function deleteSubmission(id: string) {
  const response = await appFetch(`${API_BASE}/api/admin/submissions/${id}`, {
    method: "DELETE",
    headers: await adminHeaders()
  });
  return readJson(response);
}

export async function resetSubmittingSubmission(id: string) {
  const response = await appFetch(`${API_BASE}/api/admin/submissions/${id}/reset-submitting`, {
    method: "POST",
    headers: await adminHeaders()
  });
  return readJson(response);
}

export async function getAdminFileUrl(path: string) {
  const token = await getAdminAccessToken();
  return `${API_BASE}${path}?token=${encodeURIComponent(token)}`;
}

export async function getCurrentAdmin() {
  const response = await appFetch(`${API_BASE}/api/admin/me`, {
    headers: await adminHeaders()
  });
  return readJson(response);
}

export async function getSettingsStatus() {
  const response = await appFetch(`${API_BASE}/api/admin/settings/status`, {
    headers: await adminHeaders()
  });
  return readJson(response);
}

export async function getEmailTemplate() {
  const response = await appFetch(`${API_BASE}/api/admin/settings/email-template`, {
    headers: await adminHeaders()
  });
  return readJson(response) as Promise<{ template: { subject: string; html: string } }>;
}

export async function saveEmailTemplate(template: { subject: string; html: string }) {
  const response = await appFetch(`${API_BASE}/api/admin/settings/email-template`, {
    method: "POST",
    headers: await adminJsonHeaders(),
    body: JSON.stringify(template)
  });
  return readJson(response) as Promise<{ template: { subject: string; html: string } }>;
}

export async function uploadGoogleStorageState(file: File) {
  const body = new FormData();
  body.append("storageState", file);

  const response = await appFetch(`${API_BASE}/api/admin/google-session/upload`, {
    method: "POST",
    headers: await adminHeaders(),
    body
  });
  return readJson(response);
}

export async function checkGoogleSession() {
  const response = await appFetch(`${API_BASE}/api/admin/google-session/check`, {
    method: "POST",
    headers: await adminHeaders()
  });
  return readJson(response);
}

export async function getBrowserLivePreview() {
  const response = await appFetch(`${API_BASE}/api/admin/browser/live-preview`, {
    headers: await adminHeaders()
  });
  return readJson(response);
}

export async function getPasswordState(email: string) {
  const response = await appFetch(`${API_BASE}/api/auth/password-state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  });
  return readJson(response) as Promise<{ exists: boolean; hasPassword: boolean }>;
}

export async function createPassword(email: string, password: string) {
  const response = await appFetch(`${API_BASE}/api/auth/create-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  return readJson(response);
}

async function adminHeaders() {
  return {
    Authorization: `Bearer ${await getAdminAccessToken()}`
  };
}

async function adminJsonHeaders() {
  return {
    "Content-Type": "application/json",
    ...(await adminHeaders())
  };
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed");
  }
  return data;
}

async function appFetch(input: RequestInfo | URL, init: RequestInit = {}, options: { timeoutMs?: number } = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 150_000);

  try {
    return await fetch(input, {
      ...init,
      cache: "no-store",
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
