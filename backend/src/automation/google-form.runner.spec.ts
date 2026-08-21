import { jest } from "@jest/globals";
import { chromium } from "playwright";
import {
  assertEntrancePassFormContentVisible,
  assertEntrancePassScreenshotPrivacy,
  containsEmailAddress,
  countVisibleEmailAddresses,
  countVisibleGoogleFormQuestions,
  ENTRANCE_PASS_CAPTURE_PROFILE,
  ENTRANCE_PASS_SCREENSHOT_OPTIONS,
  selectBuildingCode,
  setGoogleEmailIdentityVisible,
  shouldHideUnusedGuestRow,
  submitGoogleForm,
  validateEntrancePassScreenshot,
  validatePersistAndSubmitEntrancePass
} from "./google-form.runner.js";

describe("entrance pass screenshot capture", () => {
  it("verifies Google's receipt without waiting for click navigation", async () => {
    const click = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const page = {
      getByRole: jest.fn(() => ({ click })),
      waitForLoadState: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      evaluate: jest.fn<() => Promise<{ href: string; bodyText: string; requiredErrors: string[] }>>()
        .mockResolvedValue({
          href: "https://docs.google.com/forms/d/e/form-id/formResponse",
          bodyText: "Your response has been recorded",
          requiredErrors: []
        }),
      url: jest.fn(() => "https://docs.google.com/forms/d/e/form-id/formResponse"),
      waitForTimeout: jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
    };

    await expect(submitGoogleForm(page)).resolves.toBeUndefined();
    expect(page.getByRole).toHaveBeenCalledWith("button", { name: /^Submit$/ });
    expect(click).toHaveBeenCalledWith({ timeout: 20_000, noWaitAfter: true });
  });

  it("selects only the requested Building Code option", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <div role="listitem">
          <div role="heading"><span>Building Code</span></div>
          <div role="checkbox" aria-label="A" aria-checked="true" style="width:20px;height:20px"></div>
          <div role="checkbox" aria-label="B" aria-checked="false" style="width:20px;height:20px"></div>
          <div role="checkbox" aria-label="C" aria-checked="false" style="width:20px;height:20px"></div>
          <div role="checkbox" aria-label="D" aria-checked="false" style="width:20px;height:20px"></div>
          <div role="checkbox" aria-label="E" aria-checked="false" style="width:20px;height:20px"></div>
        </div>
      `);
      await page.locator('[role="checkbox"]').evaluateAll((options) => {
        for (const option of options) {
          option.addEventListener("click", () => {
            option.setAttribute(
              "aria-checked",
              option.getAttribute("aria-checked") === "true" ? "false" : "true"
            );
          });
        }
      });

      await selectBuildingCode(page, "D");

      await expect(page.getByRole("checkbox", { name: "A" }).getAttribute("aria-checked")).resolves.toBe(
        "false"
      );
      await expect(page.getByRole("checkbox", { name: "D" }).getAttribute("aria-checked")).resolves.toBe(
        "true"
      );
    } finally {
      await browser.close();
    }
  });

  it("uses the high-density mobile capture profile", () => {
    expect(ENTRANCE_PASS_CAPTURE_PROFILE).toEqual({
      name: "mobile-430-dpr2-account-ui-redacted-v6",
      viewport: { width: 430, height: 932 },
      deviceScaleFactor: 2,
      expectedPixelWidth: 860
    });
    expect(ENTRANCE_PASS_SCREENSHOT_OPTIONS).toEqual({
      type: "png",
      fullPage: true,
      scale: "device",
      animations: "disabled",
      caret: "hide",
      timeout: 15_000
    });
  });

  it("recognises visible Google account email text without retaining the address", () => {
    expect(containsEmailAddress("Signed in as guest@example.com")).toBe(true);
    expect(containsEmailAddress("Switch account")).toBe(false);
  });

  it("stops capture when any visible email-shaped text remains", () => {
    expect(() => assertEntrancePassScreenshotPrivacy(2)).toThrow(
      "privacy check found 2 visible email addresses"
    );
    expect(() => assertEntrancePassScreenshotPrivacy(0)).not.toThrow();
  });

  it("hides and restores all Google email identity shapes through the same capture gate", async () => {
    const page = {
      evaluate: jest
        .fn<(callback: unknown, options: { show: boolean }) => Promise<number>>()
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(3)
    };

    await expect(setGoogleEmailIdentityVisible(page, false)).resolves.toBe(3);
    await expect(setGoogleEmailIdentityVisible(page, true)).resolves.toBe(3);
    expect(page.evaluate.mock.calls.map((call) => call[1].show)).toEqual([false, true]);
  });

  it("hides and restores the complete Google account and email receipt UI without hiding form questions", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <div id="account-row"><span>guest@example.com</span><a href="#">Switch account</a></div>
        <div id="saving"><span aria-hidden="true">↻</span><span>Saving...</span></div>
        <div id="account-notice">The name, email, and photo associated with your Google account will be recorded when you upload files and submit this form</div>
        <div role="list">
          <div id="email-question">
            <h2>Email *</h2>
            <label>Record <span>guest@example.com</span> as the email to be included with my response</label>
          </div>
        </div>
        ${Array.from(
          { length: 6 },
          (_, index) => `<div role="listitem">Visible question ${index + 1}</div>`
        ).join("")}
        <div id="receipt-copy">A copy of your responses will be emailed to guest@example.com.</div>
        <div id="restored-progress"><span>Your progress has been restored</span></div>
      `);

      await expect(setGoogleEmailIdentityVisible(page, false)).resolves.toBeGreaterThanOrEqual(5);
      await expect(countVisibleEmailAddresses(page)).resolves.toBe(0);
      await expect(countVisibleGoogleFormQuestions(page)).resolves.toBe(6);
      for (const selector of [
        "#account-row",
        "#saving",
        "#account-notice",
        "#email-question",
        "#receipt-copy",
        "#restored-progress"
      ]) {
        await expect(page.locator(selector).isVisible()).resolves.toBe(false);
      }

      await expect(setGoogleEmailIdentityVisible(page, true)).resolves.toBeGreaterThanOrEqual(5);
      await expect(countVisibleEmailAddresses(page)).resolves.toBe(3);
      await expect(countVisibleGoogleFormQuestions(page)).resolves.toBe(6);
      for (const selector of [
        "#account-row",
        "#saving",
        "#account-notice",
        "#email-question",
        "#receipt-copy",
        "#restored-progress"
      ]) {
        await expect(page.locator(selector).isVisible()).resolves.toBe(true);
      }
    } finally {
      await browser.close();
    }
  });

  it("stops capture when the filled Google Form content is no longer visible", () => {
    expect(() => assertEntrancePassFormContentVisible(0)).toThrow("expected at least 5");
    expect(() => assertEntrancePassFormContentVisible(4)).toThrow("expected at least 5");
    expect(() => assertEntrancePassFormContentVisible(5)).not.toThrow();
  });

  it("hides only empty numbered guest rows after the first guest", () => {
    expect(shouldHideUnusedGuestRow("2. Guest full name", [""])).toBe(true);
    expect(shouldHideUnusedGuestRow("10. Guest full name", ["   "])).toBe(true);
    expect(shouldHideUnusedGuestRow("1. Guest full name", [""])).toBe(false);
    expect(shouldHideUnusedGuestRow("2. Guest full name", ["Second Guest"])).toBe(false);
    expect(shouldHideUnusedGuestRow("2026 booking year", [""])).toBe(false);
    expect(shouldHideUnusedGuestRow("2. Guest full name", ["", ""])).toBe(false);
  });

  it("accepts a mobile PNG with the expected pixel width", () => {
    expect(validateEntrancePassScreenshot(pngHeader(860, 9_240))).toEqual({
      width: 860,
      height: 9_240
    });
  });

  it.each([
    ["non-PNG bytes", Buffer.from("not a png"), "not a valid PNG"],
    ["the desktop width", pngHeader(1280, 4_268), "expected 860px"],
    ["a zero height", pngHeader(860, 0), "height is invalid"]
  ])("rejects %s", (_case, screenshot, message) => {
    expect(() => validateEntrancePassScreenshot(screenshot)).toThrow(message);
  });

  it("does not persist or submit an invalid screenshot", async () => {
    const persist = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const submit = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

    await expect(
      validatePersistAndSubmitEntrancePass(pngHeader(1280, 4_268), { persist, submit })
    ).rejects.toThrow("expected 860px");
    expect(persist).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("persists a valid screenshot before submitting the form", async () => {
    const order: string[] = [];
    const persist = jest.fn<(dimensions: { width: number; height: number }) => Promise<void>>(
      (dimensions) => {
        order.push(`persist:${dimensions.width}x${dimensions.height}`);
        return Promise.resolve();
      }
    );
    const submit = jest.fn<() => Promise<void>>(() => {
      order.push("submit");
      return Promise.resolve();
    });

    await expect(
      validatePersistAndSubmitEntrancePass(pngHeader(860, 9_240), { persist, submit })
    ).resolves.toEqual({ width: 860, height: 9_240 });
    expect(order).toEqual(["persist:860x9240", "submit"]);
  });
});

function pngHeader(width: number, height: number) {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
