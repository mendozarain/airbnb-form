export type Env = {
  APP_ORIGIN: string;
  PUBLIC_APP_ORIGIN?: string;
  DATABASE_URL?: string;
  NEON_AUTH_URL?: string;
  ADMIN_EMAILS?: string;
  BUILDING_CODE: "A" | "B" | "C" | "D";
  UNIT_NUMBER: string;
  OWNER_NAME: string;
  OWNER_CONTACT: string;
  GOOGLE_FORM_URL: string;
  MINOR_ID_CUTOFF: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_WORKER_NAME?: string;
  GMAIL_SMTP_USER?: string;
  GMAIL_SMTP_APP_PASSWORD?: string;
  ID_BUCKET: R2Bucket;
  BROWSER: Fetcher;
};

export type AdminContext = {
  id: string;
  email?: string;
};

export type AppEnv = {
  Bindings: Env;
  Variables: {
    admin: AdminContext;
  };
};
