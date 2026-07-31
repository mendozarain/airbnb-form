import { Injectable } from "@nestjs/common";
import { chromium } from "playwright";
import { Buffer } from "node:buffer";
import type { BuildingCode, Purpose } from "@cozy-d-714/shared";
import { requiredEnv } from "../config/env.js";
import { StorageService } from "../storage/storage.service.js";
import { GoogleSessionService } from "../settings/google-session.service.js";

const AUTOMATION_VERSION = "google-form-compact-inline-pass-v31";

export const ENTRANCE_PASS_CAPTURE_PROFILE = {
  name: "mobile-430-dpr2-compact-v2",
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 2,
  expectedPixelWidth: 860
} as const;

export const ENTRANCE_PASS_SCREENSHOT_OPTIONS = {
  type: "png",
  fullPage: true,
  scale: "device",
  animations: "disabled",
  caret: "hide",
  timeout: 15_000
} as const;

export type GoogleFormFile = {
  filename: string;
  contentType: string;
  bytes: ArrayBuffer;
};

export type GoogleFormSubmission = {
  guestEmail: string;
  buildingCode: BuildingCode;
  unitNumber: string;
  checkIn: string;
  checkOut: string;
  purpose: Purpose;
  ownerName: string;
  ownerContact: string;
  guests: Array<{ fullName: string; age: number }>;
  idFiles: GoogleFormFile[];
};

export type GoogleFormResult = {
  ok: boolean;
  screenshotKey?: string;
  error?: string;
  retryable?: boolean;
};

@Injectable()
export class GoogleFormRunner {
  constructor(
    private readonly storage: StorageService,
    private readonly googleSession: GoogleSessionService
  ) {}

  async submit(submission: GoogleFormSubmission): Promise<GoogleFormResult> {
    const storageState = await this.googleSession.loadStorageState();

    if (!storageState) {
      return {
        ok: false,
        error: "Google browser session is not connected. Open Settings and connect Google first."
      };
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      storageState: storageState as any,
      viewport: ENTRANCE_PASS_CAPTURE_PROFILE.viewport,
      deviceScaleFactor: ENTRANCE_PASS_CAPTURE_PROFILE.deviceScaleFactor
    });
    const page = await context.newPage();

    try {
      await page.goto(requiredEnv("GOOGLE_FORM_URL"), { waitUntil: "networkidle" });

      if (page.url().includes("ServiceLogin") || page.url().includes("accounts.google.com")) {
        throw new Error("Google redirected to login. Browser auth storage is not configured yet.");
      }

      await clickEmailReceiptCheckbox(page);
      await fillTextByLabel(page, "Unit Number", submission.unitNumber);
      await fillDateByLabel(page, "Date Check in", submission.checkIn);
      await fillDateByLabel(page, "Date Check out", submission.checkOut);
      await fillTextByLabel(page, "Name of Owner", submission.ownerName);
      await fillTextByLabel(page, "Contact Number of Owner/Representative", submission.ownerContact);
      await fillTextByLabel(page, "Building Code", submission.buildingCode);
      await clickText(page, submission.purpose);

      const names = submission.guests.map((guest) => guest.fullName).slice(0, 10);
      for (const [index, name] of names.entries()) {
        await fillNthShortAnswer(page, index + 1, name);
      }

      const idFiles = uniqueFiles(submission.idFiles);

      if (idFiles.length > 0) {
        await uploadIdFiles(page, idFiles);
      }

      await clickQuestionCheckbox(page, /I confirm that the information provided is accurate/i, "agreement");
      await waitForNoUploadPicker(page, 45_000);
      await closeUnexpectedTabs(page);

      await setGoogleFormSubmitControlsVisible(page, false);
      await setUnusedGuestRowsVisible(page, false);
      let screenshot: Buffer;
      try {
        await prepareEntrancePassScreenshot(page);
        screenshot = await page.screenshot(ENTRANCE_PASS_SCREENSHOT_OPTIONS);
      } finally {
        await setUnusedGuestRowsVisible(page, true);
        await setGoogleFormSubmitControlsVisible(page, true);
      }

      const screenshotKey = `automation/${crypto.randomUUID()}-entrance-pass-before-submit.png`;
      await validatePersistAndSubmitEntrancePass(screenshot, {
        persist: async ({ width, height }) => {
          await this.storage.put(screenshotKey, screenshot, {
            contentType: "image/png",
            metadata: {
              captureProfile: ENTRANCE_PASS_CAPTURE_PROFILE.name,
              viewportWidth: String(ENTRANCE_PASS_CAPTURE_PROFILE.viewport.width),
              viewportHeight: String(ENTRANCE_PASS_CAPTURE_PROFILE.viewport.height),
              deviceScaleFactor: String(ENTRANCE_PASS_CAPTURE_PROFILE.deviceScaleFactor),
              pixelWidth: String(width),
              pixelHeight: String(height)
            }
          });
        },
        submit: async () => {
          await page.getByRole("button", { name: /^Submit$/ }).click({ timeout: 20_000 });
          await waitForGoogleFormSubmission(page);
        }
      });

      const updatedStorageState = await context.storageState({ indexedDB: true });
      await this.storage.put("google/storage-state.json", JSON.stringify(updatedStorageState), {
        contentType: "application/json",
        metadata: { savedAt: new Date().toISOString() }
      });

      return { ok: true, screenshotKey };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown automation error";
      return {
        ok: false,
        retryable: message.includes("429") || message.includes("Rate limit"),
        error: `[${AUTOMATION_VERSION}] ${message}`
      };
    } finally {
      await browser.close();
    }
  }
}

type EntrancePassDimensions = {
  width: number;
  height: number;
};

type EntrancePassActions = {
  persist: (dimensions: EntrancePassDimensions) => Promise<void>;
  submit: () => Promise<void>;
};

async function prepareEntrancePassScreenshot(page: any) {
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await document.fonts?.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

export function shouldHideUnusedGuestRow(questionText: string, textboxValues: string[]) {
  return (
    /^\s*(?:[2-9]|10)(?!\d)/.test(questionText) &&
    textboxValues.length === 1 &&
    textboxValues[0].trim() === ""
  );
}

export function validateEntrancePassScreenshot(screenshot: Uint8Array): EntrancePassDimensions {
  const bytes = Buffer.from(screenshot);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  if (
    bytes.length < 24 ||
    !bytes.subarray(0, pngSignature.length).equals(pngSignature) ||
    bytes.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    throw new Error("Entrance pass screenshot is not a valid PNG");
  }

  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);

  if (width !== ENTRANCE_PASS_CAPTURE_PROFILE.expectedPixelWidth) {
    throw new Error(
      `Entrance pass screenshot width is ${width}px; expected ${ENTRANCE_PASS_CAPTURE_PROFILE.expectedPixelWidth}px`
    );
  }

  if (height < 1) {
    throw new Error("Entrance pass screenshot height is invalid");
  }

  return { width, height };
}

export async function validatePersistAndSubmitEntrancePass(
  screenshot: Uint8Array,
  actions: EntrancePassActions
) {
  const dimensions = validateEntrancePassScreenshot(screenshot);
  await actions.persist(dimensions);
  await actions.submit();
  return dimensions;
}

async function fillTextByLabel(page: any, label: string, value: string) {
  const field = page
    .getByText(label)
    .locator("xpath=ancestor::div[@role='listitem']")
    .getByRole("textbox")
    .first();
  await field.fill(value);
}

async function fillNthShortAnswer(page: any, questionNumber: number, value: string) {
  const question = page
    .locator('div[role="listitem"]')
    .filter({ hasText: new RegExp(`^\\s*${questionNumber}(?!\\d)`) })
    .first();
  const field = question.getByRole("textbox").first();
  await field.fill(value);
}

async function fillDateByLabel(page: any, label: string, value: string) {
  const field = page
    .getByText(label)
    .locator("xpath=ancestor::div[@role='listitem']")
    .locator("input[type='date'], input[type='text']")
    .first();
  const type = await field.getAttribute("type");
  await field.fill(type === "date" ? toDateInputValue(value) : toGoogleDateText(value));
}

async function clickText(page: any, text: string) {
  await page.getByText(text, { exact: true }).first().click();
}

async function clickTextIfVisible(page: any, text: string | RegExp) {
  const target = page.getByText(text).first();
  if (await target.isVisible().catch(() => false)) {
    await target.click();
  }
}

async function uploadIdFiles(page: any, files: GoogleFormFile[]) {
  const uploadQuestion = page
    .locator('div[role="listitem"]')
    .filter({
      hasText: /Attach\s+Valid\s+Id/i
    })
    .first();
  const uploadTimeoutMs = uploadTimeoutFor(files);
  const expectedFilenames = files.map((file) => file.filename);

  // Google Forms file uploads are wrapped in a custom "Add file" button.
  // Django analogy: this is closer to driving the browser widget than POSTing
  // multipart data straight to a view.
  await removeAttachedFiles(page, uploadQuestion, 0);
  await closeUnexpectedTabs(page);

  await uploadIdFileBatch(page, uploadQuestion, files, uploadTimeoutMs);
  await closeUploadPickerIfOpen(page);
  await waitForAttachedFiles(page, uploadQuestion, expectedFilenames, uploadTimeoutMs);
}

async function uploadIdFileBatch(
  page: any,
  uploadQuestion: any,
  files: GoogleFormFile[],
  uploadTimeoutMs: number
) {
  const payloads = files.map((file) => ({
    name: file.filename,
    mimeType: file.contentType,
    buffer: Buffer.from(file.bytes)
  }));
  const expectedFilenames = files.map((file) => file.filename);

  const dialog = page
    .locator('[role="dialog"], div[aria-modal="true"]')
    .filter({ hasText: /Insert file|Upload up to|Browse/i })
    .last();
  await closeUnexpectedTabs(page);

  if (!(await dialog.isVisible({ timeout: 1_000 }).catch(() => false))) {
    await uploadQuestion.getByText(/Add file/i).click();
  }

  await dialog.waitFor({ state: "visible", timeout: 45_000 });

  const chooserPromise = page.waitForEvent("filechooser", { timeout: 10_000 }).catch(() => null);
  await clickBrowseInPicker(page, dialog);
  await closeUnexpectedTabs(page);
  const fileChooser = await chooserPromise;

  if (fileChooser) {
    await fileChooser.setFiles(payloads, { timeout: uploadTimeoutMs });
  } else if (!(await setFilesInAnyFrame(page, payloads, 45_000, uploadTimeoutMs))) {
    throw new Error("Could not find Google Drive picker's file input after clicking Browse.");
  }

  await waitForPickerUploadComplete(page, files.length, uploadTimeoutMs).catch(() => undefined);
  await waitForUploadChunkOutcome(page, dialog, uploadQuestion, expectedFilenames, uploadTimeoutMs);
}

async function clickBrowseInPicker(page: any, dialog: any) {
  const browseButton = dialog.getByRole("button", { name: /^Browse$/i }).last();

  if (await browseButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await browseButton.click({ timeout: 12_000 });
    return;
  }

  await clickVisibleTextButtonInAnyFrame(page, "Browse");
}

async function clickVisibleTextButtonInAnyFrame(page: any, text: string) {
  const startedAt = Date.now();
  const timeoutMs = 30_000;

  while (Date.now() - startedAt < timeoutMs) {
    for (const frame of page.frames()) {
      const clicked = await frame
        .evaluate((buttonText: string) => {
          const candidates = Array.from(document.querySelectorAll("button, [role='button'], span, div"));
          const target = candidates.find((element) => {
            const text = element.textContent?.trim();
            const rect = element.getBoundingClientRect();
            return text === buttonText && rect.width > 0 && rect.height > 0;
          });

          const clickable = target?.closest("button, [role='button']") ?? target;
          if (!clickable) return false;

          (clickable as HTMLElement).click();
          return true;
        }, text)
        .catch(() => false);

      if (clicked) {
        return;
      }
    }

    await page.waitForTimeout(500);
  }

  throw new Error(`Could not click ${text} in the Google file picker.`);
}

async function clickPickerPrimaryAction(page: any, dialog: any, timeoutMs = 20_000) {
  // Google's file picker is loaded in frames and the button text shifts between
  // "Upload", "Insert", and "Select". Treat it like a third-party widget rather
  // than a normal form field.
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const localButton = dialog.getByRole("button", { name: /^(Insert|Select|Done)$/i }).last();

    if (await localButton.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await localButton.click({ timeout: 20_000 });
      return;
    }

    const clickedInFrame = await clickVisibleTextButtonMatchingInAnyFrame(
      page,
      /^(Insert|Select|Done)$/i,
      2_000
    ).catch(() => false);

    if (clickedInFrame) {
      return;
    }

    await page.keyboard.press("Enter").catch(() => undefined);
    await page.waitForTimeout(1_000);

    if (!(await isUploadPickerVisible(page))) {
      return;
    }
  }

  throw new Error("Google Drive picker did not expose an Upload/Insert action after the files uploaded.");
}

async function waitForUploadChunkOutcome(
  page: any,
  dialog: any,
  uploadQuestion: any,
  filenames: string[],
  timeoutMs: number
) {
  const startedAt = Date.now();
  let enterPresses = 0;

  while (Date.now() - startedAt < timeoutMs) {
    await closeUnexpectedTabs(page);
    const attachedCount = await countAttachedFiles(uploadQuestion, filenames);
    const hasExpectedFiles = await hasExpectedAttachedFiles(uploadQuestion, filenames);
    const pickerVisible = await isUploadPickerVisible(page);

    if (
      (attachedCount >= filenames.length || hasExpectedFiles) &&
      (!pickerVisible || (await isPickerReadyForMoreFiles(page)))
    ) {
      return;
    }

    if (!pickerVisible) {
      await page.waitForTimeout(1_000);
      continue;
    }

    const clicked = await clickPickerPrimaryActionOnce(page, dialog);
    if (!clicked && enterPresses < 3) {
      enterPresses += 1;
      await page.keyboard.press("Enter").catch(() => undefined);
    }

    await page.waitForTimeout(1_500);
  }

  const attachedCount = await countAttachedFiles(uploadQuestion, filenames);
  throw new Error(
    `Google Drive picker did not finish attaching files. Attached ${attachedCount}/${filenames.length}.`
  );
}

async function waitForAttachedFiles(page: any, uploadQuestion: any, filenames: string[], timeoutMs: number) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    await closeUnexpectedTabs(page);

    if (await hasExpectedAttachedFiles(uploadQuestion, filenames)) {
      return;
    }

    const attachedCount = await countAttachedFiles(uploadQuestion, filenames);
    if (attachedCount >= filenames.length) {
      return;
    }

    if (await isUploadPickerVisible(page)) {
      await closeUploadPickerIfOpen(page);
    }

    await page.waitForTimeout(1_000);
  }

  const attachedCount = await countAttachedFiles(uploadQuestion, filenames);
  throw new Error(
    `Uploaded ID files did not all attach to the Google Form. Attached ${attachedCount}/${filenames.length}.`
  );
}

async function clickPickerPrimaryActionOnce(page: any, dialog: any) {
  const localButton = dialog.getByRole("button", { name: /^(Insert|Select|Done)$/i }).last();

  if (await localButton.isVisible({ timeout: 500 }).catch(() => false)) {
    await localButton.click({ timeout: 10_000 });
    return true;
  }

  return clickVisibleTextButtonMatchingInAnyFrame(page, /^(Insert|Select|Done)$/i, 1_000).catch(() => false);
}

async function waitForUploadToAttach(
  page: any,
  dialog: any,
  uploadQuestion: any,
  filenames: string[],
  timeoutMs: number
) {
  const attachedFile = filenames[0]
    ? uploadQuestion.getByText(filenames[0]).first()
    : uploadQuestion.getByText(/\.(jpg|jpeg|png|pdf)$/i).first();
  const startedAt = Date.now();

  await attachedFile.waitFor({ timeout: Math.min(timeoutMs, 180_000) }).catch(() => undefined);
  await waitForNoUploadPicker(page, timeoutMs);
  await dialog.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);

  const visibleAttachedCount = await countAttachedFiles(uploadQuestion, filenames);
  if (visibleAttachedCount >= filenames.length) {
    return;
  }

  // Google truncates long filenames in the chip UI. If at least one new chip
  // appeared and the picker closed, do not wait forever for exact filename text.
  if (visibleAttachedCount > 0 && !(await isUploadPickerVisible(page))) {
    return;
  }

  // If Drive accepted the upload but left the picker modal open, close it so the
  // final agreement and submit controls are reachable.
  const closeButton = dialog.getByRole("button", { name: /Close|Cancel/i }).last();
  if (await closeButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await closeButton.click({ timeout: 5_000 }).catch(() => undefined);
    await waitForNoUploadPicker(page, 30_000);
  }

  while (Date.now() - startedAt < timeoutMs) {
    const attachedCount = await countAttachedFiles(uploadQuestion, filenames);

    if (attachedCount >= filenames.length || (attachedCount > 0 && !(await isUploadPickerVisible(page)))) {
      return;
    }

    await page.waitForTimeout(1_000);
  }

  if (await attachedFile.isVisible().catch(() => false)) {
    return;
  }

  throw new Error(`Uploaded ID files did not all attach to the Google Form. Expected ${filenames.length}.`);
}

async function waitForNoUploadPicker(page: any, timeoutMs = 75_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    await closeUnexpectedTabs(page);
    const pickerVisible = await isUploadPickerVisible(page);

    if (!pickerVisible) {
      return;
    }

    await page.waitForTimeout(1_000);
  }

  throw new Error(`Google Drive upload picker did not close within ${Math.round(timeoutMs / 1000)} seconds.`);
}

async function isUploadPickerVisible(page: any) {
  return page
    .evaluate(() => {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"], div[aria-modal="true"]'));

      return dialogs.some((dialog) => {
        const rect = dialog.getBoundingClientRect();
        const text = dialog.textContent ?? "";
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          /Insert file|Upload up to|drag files|My Drive|Browse/i.test(text)
        );
      });
    })
    .catch(() => false);
}

async function isPickerReadyForMoreFiles(page: any) {
  for (const frame of page.frames()) {
    const ready = await frame
      .evaluate(() => {
        const bodyText = document.body?.innerText ?? "";
        const browse = Array.from(document.querySelectorAll("button, [role='button'], span, div")).some(
          (element) => {
            const text = element.textContent?.trim();
            const rect = element.getBoundingClientRect();
            return text === "Browse" && rect.width > 0 && rect.height > 0;
          }
        );

        return browse && /drag files to upload|Browse/i.test(bodyText);
      })
      .catch(() => false);

    if (ready) {
      return true;
    }
  }

  return false;
}

async function closeUploadPickerIfOpen(page: any) {
  if (!(await isUploadPickerVisible(page))) {
    return;
  }

  await clickVisibleTextButtonMatchingInAnyFrame(page, /^(Insert|Select|Done)$/i, 5_000).catch(() => false);

  if (!(await isUploadPickerVisible(page))) {
    return;
  }

  await page.keyboard.press("Escape").catch(() => undefined);
  await waitForNoUploadPicker(page, 15_000).catch(() => undefined);
}

async function waitForPickerUploadComplete(page: any, expectedCount: number, timeoutMs: number) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const frameStates = await Promise.all(
      page.frames().map((frame: any) => {
        return frame
          .evaluate(() => {
            const bodyText = document.body?.innerText ?? "";
            const uploadedCount = (bodyText.match(/\buploaded\b/gi) ?? []).length;
            const hasProgress = Boolean(
              document.querySelector('[role="progressbar"], mat-progress-bar, .progress, [aria-valuenow]')
            );
            const hasUploadingText = /uploading|processing|scanning/i.test(bodyText);

            return { uploadedCount, hasProgress, hasUploadingText };
          })
          .catch(() => ({ uploadedCount: 0, hasProgress: false, hasUploadingText: false }));
      })
    );
    const state = frameStates.reduce(
      (
        combined: { uploadedCount: number; hasProgress: boolean; hasUploadingText: boolean },
        current: { uploadedCount: number; hasProgress: boolean; hasUploadingText: boolean }
      ) => ({
        uploadedCount: Math.max(combined.uploadedCount, current.uploadedCount),
        hasProgress: combined.hasProgress || current.hasProgress,
        hasUploadingText: combined.hasUploadingText || current.hasUploadingText
      }),
      { uploadedCount: 0, hasProgress: false, hasUploadingText: false }
    );

    if (
      state.uploadedCount >= expectedCount ||
      (!state.hasProgress && !state.hasUploadingText && state.uploadedCount > 0)
    ) {
      return;
    }

    await page.waitForTimeout(1_000);
  }

  throw new Error(`Google Drive picker did not finish uploading ${expectedCount} file(s) before timeout.`);
}

async function setGoogleFormSubmitControlsVisible(page: any, visible: boolean) {
  await page.evaluate((visible: boolean) => {
    const selectors = "button, [role='button'], a, span, div";
    const controls = Array.from(document.querySelectorAll(selectors)).filter((element) => {
      const text = (element.textContent ?? "").trim();
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && /^(Submit|Clear form)$/i.test(text);
    });

    for (const control of controls) {
      const target = control.closest("button, [role='button'], a") ?? control;

      if (visible) {
        const previousVisibility = (target as HTMLElement).dataset.cozyD714ScreenshotVisibility;
        if (previousVisibility === undefined) {
          (target as HTMLElement).style.removeProperty("visibility");
        } else {
          (target as HTMLElement).style.visibility = previousVisibility;
        }

        delete (target as HTMLElement).dataset.cozyD714ScreenshotVisibility;
      } else {
        if ((target as HTMLElement).dataset.cozyD714ScreenshotVisibility === undefined) {
          (target as HTMLElement).dataset.cozyD714ScreenshotVisibility = (
            target as HTMLElement
          ).style.visibility;
        }

        (target as HTMLElement).style.visibility = "hidden";
      }
    }
  }, visible);
}

async function setUnusedGuestRowsVisible(page: any, visible: boolean) {
  await page.evaluate((visible: boolean) => {
    const guestNumberPattern = /^\s*(?:[2-9]|10)(?!\d)/;
    const questions = Array.from(document.querySelectorAll('div[role="listitem"]'));

    for (const question of questions) {
      const element = question as HTMLElement;

      if (visible) {
        const previousDisplay = element.dataset.cozyD714ScreenshotDisplay;
        if (previousDisplay === undefined) continue;

        if (previousDisplay === "") element.style.removeProperty("display");
        else element.style.display = previousDisplay;
        delete element.dataset.cozyD714ScreenshotDisplay;
        continue;
      }

      const textboxes = Array.from(
        question.querySelectorAll('input:not([type="hidden"]), textarea, [role="textbox"]')
      ).filter((candidate, index, all) => all.indexOf(candidate) === index);
      const values = textboxes.map((textbox) => {
        if (textbox instanceof HTMLInputElement || textbox instanceof HTMLTextAreaElement) {
          return textbox.value;
        }
        return textbox.textContent ?? "";
      });
      const shouldHide =
        guestNumberPattern.test(question.textContent ?? "") && values.length === 1 && values[0].trim() === "";

      if (shouldHide) {
        element.dataset.cozyD714ScreenshotDisplay = element.style.display;
        element.style.display = "none";
      }
    }
  }, visible);
}

async function waitForGoogleFormSubmission(page: any) {
  const startedAt = Date.now();
  const timeoutMs = 60_000;

  while (Date.now() - startedAt < timeoutMs) {
    await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);

    const state = await page
      .evaluate(() => {
        const bodyText = document.body?.innerText ?? "";
        const requiredErrors = Array.from(document.querySelectorAll("div, span"))
          .map((element) => element.textContent?.trim() ?? "")
          .filter((text) => /This is a required question|Required|This question is required/i.test(text));

        return {
          href: window.location.href,
          bodyText,
          requiredErrors: Array.from(new Set(requiredErrors)).slice(0, 5)
        };
      })
      .catch(() => ({ href: page.url(), bodyText: "", requiredErrors: [] as string[] }));

    if (/formResponse|\/closedform/i.test(state.href)) {
      return;
    }

    if (
      /Your response has been recorded|Thanks for filling out this form|Here's what was received/i.test(
        state.bodyText
      )
    ) {
      return;
    }

    if (state.requiredErrors.length > 0) {
      throw new Error(
        `Google Form did not submit because a required field is still missing: ${state.requiredErrors.join("; ")}`
      );
    }

    await page.waitForTimeout(1_000);
  }

  throw new Error("Google Form submit did not reach the receipt page within 90 seconds.");
}

async function clickEmailReceiptCheckbox(page: any) {
  if (await clickCheckboxBySurroundingText(page, /Record[\s\S]*as the email/i)) {
    return;
  }

  throw new Error("Could not check the required email receipt checkbox.");
}

async function clickQuestionCheckbox(page: any, questionText: RegExp, name: string) {
  const question = page
    .locator('div[role="listitem"]')
    .filter({
      hasText: questionText
    })
    .first();

  await question.scrollIntoViewIfNeeded({ timeout: 5_000 });

  const checkbox = question.locator('[role="checkbox"]').first();
  if ((await checkbox.count().catch(() => 0)) > 0) {
    if (!(await isChecked(checkbox))) {
      await checkbox.click({ force: true, timeout: 10_000 });
    }
  } else {
    await question
      .getByText(questionText)
      .click({ force: true, timeout: 10_000 })
      .catch(() => undefined);
  }

  await page.waitForTimeout(300);

  if ((await checkbox.count().catch(() => 0)) > 0 && (await isChecked(checkbox))) {
    return;
  }

  await question
    .locator("label, span, div")
    .filter({ hasText: questionText })
    .first()
    .click({ force: true, timeout: 10_000 })
    .catch(() => undefined);
  await page.waitForTimeout(300);

  if ((await checkbox.count().catch(() => 0)) > 0 && (await isChecked(checkbox))) {
    return;
  }

  const clickedByDom = await question
    .evaluate((element: Element) => {
      const checkbox = element.querySelector('[role="checkbox"]') as HTMLElement | null;
      if (!checkbox) return false;

      checkbox.click();
      checkbox.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      checkbox.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
      checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return true;
    })
    .catch(() => false);

  if (clickedByDom) {
    await page.waitForTimeout(300);
  }

  if ((await checkbox.count().catch(() => 0)) > 0 && (await isChecked(checkbox))) {
    return;
  }

  throw new Error(`Could not check the required ${name} checkbox.`);
}

async function clickCheckboxBySurroundingText(page: any, questionText: RegExp) {
  const source = questionText.source;
  const flags = questionText.flags;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const state = await page
      .evaluate(
        ({ source, flags }: { source: string; flags: string }) => {
          const pattern = new RegExp(source, flags);
          const checkboxes = Array.from(
            document.querySelectorAll('[role="checkbox"], input[type="checkbox"]')
          );

          function isVisible(element: Element) {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }

          function isChecked(element: Element) {
            if (element instanceof HTMLInputElement) {
              return element.checked;
            }

            return element.getAttribute("aria-checked") === "true";
          }

          function surroundingText(element: Element) {
            let current: Element | null = element;
            let text = "";

            for (let depth = 0; current && depth < 8; depth += 1) {
              text = current.textContent ?? "";
              if (pattern.test(text)) {
                return { element: current, text };
              }

              current = current.parentElement;
            }

            return null;
          }

          const checkbox = checkboxes.find((candidate) => isVisible(candidate) && surroundingText(candidate));

          if (!checkbox) {
            return "missing";
          }

          checkbox.scrollIntoView({ block: "center", inline: "nearest" });

          if (isChecked(checkbox)) {
            return "checked";
          }

          const target = checkbox as HTMLElement;
          target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true }));
          target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
          target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
          target.click();

          return isChecked(checkbox) ? "checked" : "clicked";
        },
        { source, flags }
      )
      .catch(() => "missing");

    await page.waitForTimeout(400);

    if (state === "checked" || (await isCheckboxCheckedBySurroundingText(page, questionText))) {
      return true;
    }
  }

  return false;
}

async function isCheckboxCheckedBySurroundingText(page: any, questionText: RegExp) {
  const source = questionText.source;
  const flags = questionText.flags;

  return page
    .evaluate(
      ({ source, flags }: { source: string; flags: string }) => {
        const pattern = new RegExp(source, flags);
        const checkboxes = Array.from(document.querySelectorAll('[role="checkbox"], input[type="checkbox"]'));

        function isVisible(element: Element) {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }

        function isChecked(element: Element) {
          if (element instanceof HTMLInputElement) {
            return element.checked;
          }

          return element.getAttribute("aria-checked") === "true";
        }

        return checkboxes.some((checkbox) => {
          if (!isVisible(checkbox) || !isChecked(checkbox)) return false;

          let current: Element | null = checkbox;
          for (let depth = 0; current && depth < 8; depth += 1) {
            if (pattern.test(current.textContent ?? "")) {
              return true;
            }

            current = current.parentElement;
          }

          return false;
        });
      },
      { source, flags }
    )
    .catch(() => false);
}

async function isChecked(checkbox: any) {
  return (await checkbox.getAttribute("aria-checked").catch(() => null)) === "true";
}

async function removeAttachedFiles(page: any, uploadQuestion: any, keepCount: number) {
  // Google Forms can keep file-upload drafts attached to the signed-in Google
  // account. Clear old chips before upload, and trim extras after upload.
  for (let index = 0; index < 10; index += 1) {
    const result = await uploadQuestion
      .evaluate((root: Element, keepCount: number) => {
        function isVisible(element: Element) {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }

        function fileChipCandidates() {
          return Array.from(root.querySelectorAll("div, span")).filter((element) => {
            const text = element.textContent ?? "";
            const rect = element.getBoundingClientRect();
            return /\.(jpg|jpeg|png|pdf)\b/i.test(text) && rect.width > 40 && rect.height > 20;
          });
        }

        const chips = fileChipCandidates();
        if (chips.length <= keepCount) {
          return { removed: false, count: chips.length };
        }

        const lastChip = chips[chips.length - 1];
        const controls = Array.from(
          lastChip.querySelectorAll("button, [role='button'], [aria-label], [data-tooltip]")
        );
        const removable = controls.reverse().find((element) => {
          const label = [
            element.getAttribute("aria-label"),
            element.getAttribute("data-tooltip"),
            element.getAttribute("title"),
            element.textContent
          ].join(" ");

          return (
            isVisible(element) &&
            (/remove|delete|close/i.test(label) || /^[x×✕]$/i.test((element.textContent ?? "").trim()))
          );
        });

        const fallback = Array.from(
          root.querySelectorAll("button, [role='button'], [aria-label], [data-tooltip]")
        )
          .reverse()
          .find((element) => {
            const label = [
              element.getAttribute("aria-label"),
              element.getAttribute("data-tooltip"),
              element.getAttribute("title"),
              element.textContent
            ].join(" ");

            return (
              isVisible(element) &&
              (/remove|delete/i.test(label) || /^[x×✕]$/i.test((element.textContent ?? "").trim()))
            );
          });

        const target = removable ?? fallback;
        if (!target) {
          return { removed: false, count: chips.length };
        }

        (target as HTMLElement).click();
        return { removed: true, count: chips.length };
      }, keepCount)
      .catch(() => ({ removed: false, count: 0 }));

    if (!result.removed) {
      return;
    }

    await page.waitForTimeout(300).catch(() => undefined);
  }
}

async function hasExpectedAttachedFiles(uploadQuestion: any, filenames: string[]) {
  if (filenames.length <= 1) {
    return (
      (await uploadQuestion
        .getByText(/\.(jpg|jpeg|png|pdf)$/i)
        .first()
        .isVisible()
        .catch(() => false)) || (await countAttachedFiles(uploadQuestion, filenames)) >= 1
    );
  }

  return (await countAttachedFiles(uploadQuestion, filenames)) >= filenames.length;
}

async function countAttachedFiles(uploadQuestion: any, filenames: string[]) {
  return uploadQuestion
    .evaluate((root: Element, filenames: string[]) => {
      const clone = root.cloneNode(true) as Element;
      clone
        .querySelectorAll('[role="dialog"], div[aria-modal="true"], iframe')
        .forEach((element) => element.remove());
      const rootText = clone.textContent ?? "";
      const matchedByName = filenames.filter((filename) => {
        const stem = filename.replace(/\.[^.]+$/, "");
        return rootText.includes(filename) || (stem.length >= 8 && rootText.includes(stem.slice(0, 12)));
      }).length;

      if (matchedByName > 0) {
        return matchedByName;
      }

      function isVisible(element: Element) {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }

      const removeControls = Array.from(
        clone.querySelectorAll("button, [role='button'], [aria-label], [data-tooltip]")
      ).filter((element) => {
        const label = [
          element.getAttribute("aria-label"),
          element.getAttribute("data-tooltip"),
          element.getAttribute("title"),
          element.textContent
        ].join(" ");
        const text = (element.textContent ?? "").trim();

        return isVisible(element) && (/remove|delete/i.test(label) || /^[x×✕]$/i.test(text));
      });

      if (removeControls.length > 0) {
        return removeControls.length;
      }

      const chips = Array.from(clone.querySelectorAll("div, span")).filter((element) => {
        const text = element.textContent ?? "";
        const rect = element.getBoundingClientRect();
        return (
          isVisible(element) &&
          rect.width > 40 &&
          rect.height > 16 &&
          (/\.?(jpg|jpeg|png|pdf)\b/i.test(text) ||
            (/Add file/i.test(text) === false && /Remove|delete|close|×|✕/i.test(text)))
        );
      });

      // Google chips contain nested elements, so collapse to roughly one item per
      // filename/action chip by only counting elements that do not contain another
      // visible candidate.
      return chips.filter((candidate) => {
        return !chips.some((other) => other !== candidate && candidate.contains(other));
      }).length;
    }, filenames)
    .catch(() => 0);
}

function uniqueFiles(files: GoogleFormFile[]) {
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = `${file.filename}:${file.contentType}:${file.bytes.byteLength}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function clickVisibleTextButtonMatchingInAnyFrame(page: any, textPattern: RegExp, timeoutMs: number) {
  const startedAt = Date.now();
  const source = textPattern.source;
  const flags = textPattern.flags;

  while (Date.now() - startedAt < timeoutMs) {
    for (const frame of page.frames()) {
      const clicked = await frame
        .evaluate(
          ({ source, flags }: { source: string; flags: string }) => {
            const pattern = new RegExp(source, flags);
            const candidates = Array.from(document.querySelectorAll("button, [role='button'], span, div"));
            const target = candidates.find((element) => {
              const text = element.textContent?.trim() ?? "";
              const rect = element.getBoundingClientRect();
              return pattern.test(text) && rect.width > 0 && rect.height > 0;
            });

            const clickable = target?.closest("button, [role='button']") ?? target;
            if (!clickable) return false;

            (clickable as HTMLElement).click();
            return true;
          },
          { source, flags }
        )
        .catch(() => false);

      if (clicked) {
        return true;
      }
    }

    await page.waitForTimeout(500);
  }

  return false;
}

async function setFilesInAnyFrame(
  page: any,
  payloads: Array<{ name: string; mimeType: string; buffer: Buffer }>,
  timeoutMs: number,
  setInputTimeoutMs: number
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    for (const frame of page.frames()) {
      const input = frame.locator("input[type='file']").first();
      const count = await input.count().catch(() => 0);

      if (count > 0) {
        await input.setInputFiles(payloads, { timeout: setInputTimeoutMs });
        return true;
      }
    }

    await page.waitForTimeout(500);
  }

  return false;
}

async function closeUnexpectedTabs(page: any) {
  const context = page.context?.();
  const pages = context?.pages?.() ?? [];

  for (const candidate of pages) {
    if (candidate === page || candidate.isClosed?.()) {
      continue;
    }

    await candidate.close().catch(() => undefined);
  }

  await page.bringToFront().catch(() => undefined);
}

function uploadTimeoutFor(files: GoogleFormFile[]) {
  const totalBytes = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
  const totalMegabytes = totalBytes / 1024 / 1024;

  // Keep uploads inside a practical window so runs fail fast if Drive stalls.
  // Target: roughly 1-2 minutes even for larger ID sets.
  return Math.min(120_000, Math.max(60_000, 35_000 + files.length * 10_000 + totalMegabytes * 1_000));
}

function toDateInputValue(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

function toGoogleDateText(value: string) {
  const date = new Date(value);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${month}/${day}/${date.getUTCFullYear()}`;
}
