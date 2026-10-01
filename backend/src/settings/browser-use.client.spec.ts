import { afterEach, describe, expect, it } from "@jest/globals";
import {
  buildRecoveryRunRequest,
  expectedGoogleAccount,
  sanitizeBrowserUseError
} from "./browser-use.client.js";

const ORIGINAL_ENV = { ...process.env };

describe("BrowserUseClient recovery contract", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("binds only the exact 1Password item fields to Google Accounts", () => {
    Object.assign(process.env, {
      GOOGLE_FORM_URL: "https://docs.google.com/forms/d/e/form-id/viewform",
      BROWSER_USE_1PASSWORD_INTEGRATION_ID: "integration-1",
      BROWSER_USE_1PASSWORD_VAULT_ID: "vault-1",
      BROWSER_USE_1PASSWORD_ITEM_ID: "item-for-rhainne",
      BROWSER_USE_PROFILE_ID: "profile-1"
    });

    const request = buildRecoveryRunRequest();

    expect(request.model).toBe("gpt-5.6-luna");
    expect(request.maxCostUsd).toBe(1);
    expect(request.browserSettings).toMatchObject({ profileId: "profile-1", proxyCountryCode: "au" });
    expect(request.task).toContain("mendozarhainne@gmail.com");
    expect(request.secretBindings).toEqual(
      ["username", "password", "one-time-password"].map((fieldId, index) => ({
        alias: ["google_username", "google_password", "google_one_time_password"][index],
        source: {
          type: "onepassword",
          integrationId: "integration-1",
          vaultId: "vault-1",
          itemId: "item-for-rhainne",
          fieldId
        },
        allowedDomains: ["accounts.google.com"]
      }))
    );
  });

  it("refuses a different configured Google account", () => {
    process.env.GOOGLE_ACCOUNT_EMAIL = "someone-else@gmail.com";
    expect(() => expectedGoogleAccount()).toThrow("must be mendozarhainne@gmail.com");
  });

  it("redacts credentials and long tokens from errors", () => {
    const output = sanitizeBrowserUseError(
      new Error("password=hunter2 api_key=abcdefghijklmnopqrstuvwxyz1234567890")
    );
    expect(output).not.toContain("hunter2");
    expect(output).not.toContain("abcdefghijklmnopqrstuvwxyz1234567890");
  });
});
