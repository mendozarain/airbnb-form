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
  setGoogleEmailIdentityVisible,
  shouldHideUnusedGuestRow,
  validateEntrancePassScreenshot,
  validatePersistAndSubmitEntrancePass
} from "./google-form.runner.js";

describe("entrance pass screenshot capture", () => {
  it("uses the high-density mobile capture profile", () => {
    expect(ENTRANCE_PASS_CAPTURE_PROFILE).toEqual({
      name: "mobile-430-dpr2-email-text-redacted-v5",
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

  it("redacts only email text while keeping a wrapping Google Form label and its questions visible", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <label id="receipt">
          <div>Record <span>guest@example.com</span> as the email to be included with my response</div>
          ${Array.from(
            { length: 6 },
            (_, index) => `<div role="listitem">Visible question ${index + 1}</div>`
          ).join("")}
        </label>
        <div id="account">Signed in as guest@example.com · Switch account</div>
      `);

      await expect(setGoogleEmailIdentityVisible(page, false)).resolves.toBe(2);
      await expect(countVisibleEmailAddresses(page)).resolves.toBe(0);
      await expect(countVisibleGoogleFormQuestions(page)).resolves.toBe(6);
      await expect(
        page.locator("#receipt").evaluate((element) => getComputedStyle(element).display)
      ).resolves.not.toBe("none");

      await expect(setGoogleEmailIdentityVisible(page, true)).resolves.toBe(2);
      await expect(countVisibleEmailAddresses(page)).resolves.toBe(2);
      await expect(countVisibleGoogleFormQuestions(page)).resolves.toBe(6);
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
