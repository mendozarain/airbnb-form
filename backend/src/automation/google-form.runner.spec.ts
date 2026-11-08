import { jest } from "@jest/globals";
import { chromium } from "playwright";
import {
  assertEntrancePassFormContentVisible,
  assertEntrancePassScreenshotPrivacy,
  areAttachedGoogleFormFilesSettled,
  classifyGoogleFormFailure,
  containsEmailAddress,
  countVisibleEmailAddresses,
  countVisibleGoogleFormQuestions,
  ENTRANCE_PASS_CAPTURE_PROFILE,
  ENTRANCE_PASS_SCREENSHOT_OPTIONS,
  GoogleFormLayoutChangedError,
  GoogleSubmissionUncertainError,
  isFormFailureScreenshotKey,
  listVisibleGoogleFormQuestions,
  matchesBuildingCodeLabel,
  matchesPurposeOptionLabel,
  matchesUnitNumberLabel,
  normalizeGoogleFormQuestionTitle,
  pickUnitNumberQuestionIndex,
  selectBuildingCode,
  selectPurpose,
  setGoogleEmailIdentityVisible,
  shouldHideUnusedGuestRow,
  submitGoogleForm,
  waitForGoogleFormDraftSettled,
  validateEntrancePassScreenshot,
  validatePersistAndSubmitEntrancePass
} from "./google-form.runner.js";

/** Titles observed on the live form when v40 failed (8 Nov 2026). */
const NOV8_VISIBLE_TITLES = [
  "Building",
  "Unit",
  "Date Check in",
  "Date Check out",
  "Purpose :",
  "Tenant",
  "Visitor of tenant",
  "viewing",
  "Guest Names",
  "1.",
  "2.",
  "3.",
  "4",
  "5",
  "6",
  "7.",
  "8.",
  "9",
  "10.",
  "Name of Owner:",
  "Contact Number of Owner/Representative",
  "Attach Valid Id's of each guests. (Kindly attached ID'S of all occupants)",
  "I confirm that the information provided is accurate and I agree to follow the condo rules and regulations I agree",
  "I agree"
] as const;

describe("Nov 2026 Google Form title compatibility", () => {
  it("strips trailing form punctuation without touching inner punctuation", () => {
    expect(normalizeGoogleFormQuestionTitle("Name of Owner:")).toBe("Name of Owner");
    expect(normalizeGoogleFormQuestionTitle("Purpose :")).toBe("Purpose");
    expect(normalizeGoogleFormQuestionTitle("Unit No.")).toBe("Unit No");
    expect(normalizeGoogleFormQuestionTitle("Contact Number of Owner/Representative")).toBe(
      "Contact Number of Owner/Representative"
    );
    expect(normalizeGoogleFormQuestionTitle("Name of Owner *")).toBe("Name of Owner");
  });

  it("matches Building and Building Code, but not unrelated Building* titles", () => {
    expect(matchesBuildingCodeLabel("Building")).toBe(true);
    expect(matchesBuildingCodeLabel("Building Code")).toBe(true);
    expect(matchesBuildingCodeLabel("Building Code *")).toBe(true);
    expect(matchesBuildingCodeLabel("Building Something")).toBe(false);
    expect(matchesBuildingCodeLabel("Unit")).toBe(false);
  });

  it("matches owner/unit/building labels from the Nov 8 title list", () => {
    expect(NOV8_VISIBLE_TITLES.some((title) => matchesBuildingCodeLabel(title))).toBe(true);
    expect(NOV8_VISIBLE_TITLES.some((title) => matchesUnitNumberLabel(title))).toBe(true);
    expect(
      NOV8_VISIBLE_TITLES.some(
        (title) => normalizeGoogleFormQuestionTitle(title) === "Name of Owner"
      )
    ).toBe(true);
  });

  it("matches purpose options case-insensitively against the live casing", () => {
    expect(matchesPurposeOptionLabel("Tenant", "Tenant")).toBe(true);
    expect(matchesPurposeOptionLabel("Visitor of tenant", "Visitor of Tenant")).toBe(true);
    expect(matchesPurposeOptionLabel("viewing", "Viewing")).toBe(true);
    expect(matchesPurposeOptionLabel("Visitor of Tenant", "Viewing")).toBe(false);
    expect(matchesPurposeOptionLabel("Tenant guest", "Tenant")).toBe(false);
  });

  it("picks Unit by label when Building is shortened", () => {
    const questions = [
      { title: "Building", required: false, kind: "short_text" as const },
      { title: "Unit", required: true, kind: "short_text" as const },
      { title: "Date Check in", required: true, kind: "date" as const }
    ];
    expect(pickUnitNumberQuestionIndex(questions)).toBe(1);
  });

  it("fills Building short text and case-shifted Purpose options from the Nov 8 layout", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <div role="list">
          <div role="listitem">
            <div role="heading">Building</div>
            <input type="text" />
          </div>
          <div role="listitem">
            <div role="heading">Unit</div>
            <input type="text" />
          </div>
          <div role="listitem">
            <div role="heading">Name of Owner:</div>
            <input type="text" />
          </div>
          <div role="listitem">
            <div role="heading">Purpose :</div>
            <div role="radio" aria-checked="false">Tenant</div>
            <div role="radio" aria-checked="false">Visitor of tenant</div>
            <div role="radio" aria-checked="false">viewing</div>
          </div>
        </div>
      `);
      await page.locator('[role="radio"]').evaluateAll((options) => {
        for (const option of options) {
          option.addEventListener("click", () => {
            for (const other of options) other.setAttribute("aria-checked", "false");
            option.setAttribute("aria-checked", "true");
          });
        }
      });

      await selectBuildingCode(page, "D");
      await expect(page.locator('div[role="listitem"]').nth(0).locator("input").inputValue()).resolves.toBe(
        "D"
      );

      const ownerHeading = page.getByRole("heading", { name: "Name of Owner:" });
      const ownerQuestion = ownerHeading.locator("xpath=ancestor::div[@role='listitem'][1]");
      await ownerQuestion.getByRole("textbox").fill("Owner Name");
      await expect(ownerQuestion.locator("input").inputValue()).resolves.toBe("Owner Name");
      expect(normalizeGoogleFormQuestionTitle(await ownerHeading.innerText())).toBe("Name of Owner");

      await selectPurpose(page, "Viewing");
      await expect(page.getByText("viewing", { exact: true }).getAttribute("aria-checked")).resolves.toBe(
        "true"
      );

      await selectPurpose(page, "Visitor of Tenant");
      await expect(
        page.getByText("Visitor of tenant", { exact: true }).getAttribute("aria-checked")
      ).resolves.toBe("true");
    } finally {
      await browser.close();
    }
  });
});

describe("unit number label matching", () => {
  it.each([
    ["Unit Number", true],
    ["Unit Number *", true],
    ["Unit No.", true],
    ["Unit No", true],
    ["Unit #", true],
    ["Unit", true],
    ["Unit Num", true],
    ["519", false],
    ["Building Code", false],
    ["Date Check in", false],
    ["1", false]
  ])("matchesUnitNumberLabel(%j) → %s", (title, expected) => {
    expect(matchesUnitNumberLabel(title)).toBe(expected);
  });

  it("prefers a restored Unit Number title over structural position", () => {
    const questions = [
      { title: "Email", required: true, kind: "other" as const },
      { title: "Building Code", required: false, kind: "short_text" as const },
      { title: "Unit Number", required: true, kind: "short_text" as const },
      { title: "Date Check in", required: true, kind: "date" as const }
    ];
    expect(pickUnitNumberQuestionIndex(questions)).toBe(2);
  });

  it("falls back to the required short text after Building Code when the title is mistyped", () => {
    const questions = [
      { title: "Email", required: true, kind: "other" as const },
      { title: "Building Code", required: false, kind: "short_text" as const },
      { title: "519", required: true, kind: "short_text" as const },
      { title: "Date Check in", required: true, kind: "date" as const }
    ];
    expect(pickUnitNumberQuestionIndex(questions)).toBe(2);
  });

  it("returns -1 when neither a unit label nor a structural candidate exists", () => {
    expect(
      pickUnitNumberQuestionIndex([
        { title: "Email", required: true, kind: "other" },
        { title: "Purpose", required: true, kind: "choice" }
      ])
    ).toBe(-1);
  });
});

describe("Google Form failure classification", () => {
  it("treats form layout changes as hard submission failures", () => {
    expect(
      classifyGoogleFormFailure(new GoogleFormLayoutChangedError("Unit Number", ["Building Code", "519"]))
    ).toBe("submission_failed");
  });

  it("does not classify Playwright locator timeouts as temporary navigation", () => {
    const message =
      "locator.fill: Timeout 30000ms exceeded.\nCall log:\n- waiting for getByText('Unit Number').locator(\"xpath=ancestor::div[@role='listitem']\").getByRole('textbox').first()";
    expect(classifyGoogleFormFailure(new Error(message))).toBe("submission_failed");
  });

  it("still treats genuine network timeouts as temporary navigation", () => {
    expect(classifyGoogleFormFailure(new Error("page.goto: net::ERR_CONNECTION_RESET"))).toBe(
      "temporary_navigation"
    );
    expect(classifyGoogleFormFailure(new Error("Navigation timeout exceeded"))).toBe("temporary_navigation");
  });

  it("recognises form-failure screenshot keys under the automation prefix", () => {
    expect(isFormFailureScreenshotKey("automation/abc-form-failure.png")).toBe(true);
    expect(isFormFailureScreenshotKey("automation/abc-entrance-pass-before-submit.png")).toBe(false);
  });
});

describe("unit field fill against mistyped Google Form titles", () => {
  it("fills the required short text after Building Code when the title is 519", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <div role="list">
          <div role="listitem">
            <div role="heading">Email *</div>
            <div role="checkbox" aria-checked="false">Record email</div>
          </div>
          <div role="listitem">
            <div role="heading">Building Code</div>
            <input type="text" />
          </div>
          <div role="listitem">
            <div role="heading">519 *</div>
            <input type="text" aria-required="true" />
          </div>
          <div role="listitem">
            <div role="heading">Date Check in *</div>
            <input type="date" />
          </div>
        </div>
      `);

      const questions = await listVisibleGoogleFormQuestions(page);
      const index = pickUnitNumberQuestionIndex(questions);
      expect(index).toBe(2);
      await page.locator('div[role="listitem"]').nth(index).getByRole("textbox").fill("714");
      await expect(page.locator('div[role="listitem"]').nth(2).locator("input").inputValue()).resolves.toBe(
        "714"
      );
    } finally {
      await browser.close();
    }
  });

  it("fills a restored Unit Number title without relying on position", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <div role="list">
          <div role="listitem">
            <div role="heading">Building Code</div>
            <input type="text" />
          </div>
          <div role="listitem">
            <div role="heading">Something else</div>
            <input type="text" />
          </div>
          <div role="listitem">
            <div role="heading">Unit No.</div>
            <input type="text" aria-required="true" />
          </div>
        </div>
      `);

      const questions = await listVisibleGoogleFormQuestions(page);
      const index = pickUnitNumberQuestionIndex(questions);
      expect(questions[index].title).toMatch(/Unit/i);
      await page.locator('div[role="listitem"]').nth(index).getByRole("textbox").fill("714");
      await expect(page.locator('div[role="listitem"]').nth(index).locator("input").inputValue()).resolves.toBe(
        "714"
      );
    } finally {
      await browser.close();
    }
  });
});

describe("entrance pass screenshot capture", () => {
  it("verifies Google's receipt without waiting for click navigation", async () => {
    const click = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const page = {
      getByRole: jest.fn(() => ({ click })),
      waitForLoadState: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      evaluate: jest
        .fn<() => Promise<{ href: string; bodyText: string; requiredErrors: string[] }>>()
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

  it("marks a missing post-click receipt as uncertain so it cannot be replayed", async () => {
    let now = 0;
    const clock = jest.spyOn(Date, "now").mockImplementation(() => now);
    const page = {
      getByRole: jest.fn(() => ({
        click: jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
      })),
      waitForLoadState: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      evaluate: jest
        .fn<() => Promise<{ href: string; bodyText: string; requiredErrors: string[] }>>()
        .mockResolvedValue({
          href: "https://docs.google.com/forms/d/e/form-id/viewform",
          bodyText: "Registration form",
          requiredErrors: []
        }),
      url: jest.fn(() => "https://docs.google.com/forms/d/e/form-id/viewform"),
      waitForTimeout: jest.fn<() => Promise<void>>().mockImplementation(() => {
        now += 1_000;
        return Promise.resolve();
      })
    };

    try {
      await expect(submitGoogleForm(page)).rejects.toBeInstanceOf(GoogleSubmissionUncertainError);
    } finally {
      clock.mockRestore();
    }
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

  it("accepts attached ID files when Google keeps a thumbnail Loading label", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <div role="listitem" id="id-upload">
          <div role="heading">Attach Valid Id</div>
          <div>guest-passport.jpg <span>Loading...</span></div>
        </div>
      `);

      await expect(
        areAttachedGoogleFormFilesSettled(page.locator("#id-upload"), ["guest-passport.jpg"])
      ).resolves.toBe(true);
    } finally {
      await browser.close();
    }
  });

  it("does not treat explicitly Uploading ID files as settled", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <div role="listitem" id="id-upload">
          <div role="heading">Attach Valid Id</div>
          <div>guest-passport.jpg <span>Uploading...</span></div>
        </div>
      `);

      await expect(
        areAttachedGoogleFormFilesSettled(page.locator("#id-upload"), ["guest-passport.jpg"])
      ).resolves.toBe(false);
    } finally {
      await browser.close();
    }
  });

  it("waits for Google Forms to finish saving before continuing", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`<div id="save-state">Saving...</div>`);
      await page.evaluate(() => {
        window.setTimeout(() => {
          const saveState = document.querySelector("#save-state");
          if (saveState) saveState.textContent = "Draft saved";
        }, 100);
      });

      await expect(waitForGoogleFormDraftSettled(page, 5_000)).resolves.toBeUndefined();
    } finally {
      await browser.close();
    }
  });

  it("accepts named ID files after Google has finished processing them", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <div role="listitem" id="id-upload">
          <div role="heading">Attach Valid Id</div>
          <div>guest-passport.jpg <button aria-label="Remove guest-passport.jpg">Remove</button></div>
        </div>
      `);

      await expect(
        areAttachedGoogleFormFilesSettled(page.locator("#id-upload"), ["guest-passport.jpg"])
      ).resolves.toBe(true);
    } finally {
      await browser.close();
    }
  });

  it("reports the exact required question instead of copying the whole form", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <div role="listitem">
          <div role="heading">Attach Valid Id</div>
          <div>guest-passport.jpg</div>
          <span>Required</span>
        </div>
        <div>Unrelated private form content</div>
        <button>Submit</button>
      `);

      await expect(submitGoogleForm(page)).rejects.toThrow(
        "required field is still missing: Attach Valid Id"
      );
      await expect(submitGoogleForm(page)).rejects.not.toThrow("Unrelated private form content");
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
