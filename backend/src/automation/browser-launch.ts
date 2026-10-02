import type { LaunchOptions } from "playwright";

// Chromium cannot create its own sandbox inside AWS Lambda (no user namespaces, no /dev/shm, no GPU), so
// the launch crashes with "Zygote could not fork" / "GPU process isn't usable" unless these flags are set.
const LAMBDA_CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--no-zygote",
  "--disable-gpu",
  "--disable-dev-shm-usage"
];

export function chromiumLaunchOptions(): LaunchOptions {
  const inLambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
  return { headless: true, ...(inLambda ? { args: LAMBDA_CHROMIUM_ARGS } : {}) };
}
