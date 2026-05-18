const neonAuthUrl = import.meta.env.VITE_NEON_AUTH_URL?.replace(/\/+$/, "");
const signedOutKey = "cozy-d-714-admin-signed-out";

export type AdminSession = {
  user: {
    id: string;
    email: string;
    name?: string;
    role?: string | null;
  };
  session: {
    token: string;
    expiresAt: string;
  };
};

export function isAuthConfigured() {
  return Boolean(neonAuthUrl);
}

export async function signInAdmin(email: string, password: string) {
  const result = await authRequest("sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  window.localStorage.removeItem(signedOutKey);
  return result;
}

export async function signUpAdmin(email: string, password: string, name: string) {
  const result = await authRequest("sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name })
  });
  window.localStorage.removeItem(signedOutKey);
  return result;
}

export async function signOutAdmin() {
  window.localStorage.setItem(signedOutKey, "true");
  await authRequest("sign-out", {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function getAdminSession(): Promise<AdminSession | null> {
  if (window.localStorage.getItem(signedOutKey) === "true") {
    return null;
  }

  return authRequest("get-session", { method: "GET" });
}

export async function getAdminAccessToken() {
  const result = await authRequest<{ token: string }>("token", { method: "GET" });

  if (!result?.token) {
    throw new Error("Admin login is required");
  }

  return result.token;
}

async function authRequest<T = unknown>(path: string, init: RequestInit): Promise<T> {
  if (!neonAuthUrl) {
    throw new Error("VITE_NEON_AUTH_URL is not configured");
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);

  try {
    // Django analogy: these are direct calls to Neon Auth's login views.
    // Cookies are included so the browser keeps the admin session afterward.
    const response = await fetch(`${neonAuthUrl}/${path}`, {
      ...init,
      cache: "no-store",
      credentials: "include",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...init.headers
      }
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(data?.message ?? data?.error ?? "Authentication failed");
    }

    return data as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Authentication timed out. Please try again.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
