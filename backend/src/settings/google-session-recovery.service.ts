import { ConflictException, Injectable, Optional } from "@nestjs/common";
import { SubmissionStatus } from "../generated/prisma/enums.js";
import { JobDispatcher } from "../jobs/job.dispatcher.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { EmailService } from "../automation/email.service.js";
import { BrowserUseClient, expectedGoogleAccount, sanitizeBrowserUseError } from "./browser-use.client.js";
import { GoogleSessionService } from "./google-session.service.js";

const ENABLED_KEY = "google_auto_recovery_enabled";
const STATE_KEY = "google_recovery_state";
const LEASE_MS = 4 * 60_000;
const AI_REVIEW_EMAIL_KEY = "ai_review_email";
const DEFAULT_AI_REVIEW_EMAIL = "mendozarhainne@gmail.com";

export type GoogleRecoveryState = {
  configured: boolean;
  enabled: boolean;
  state: "idle" | "recovering" | "manual_required";
  expectedAccount: string;
  incidentId?: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  leaseUntil?: string;
  alertDelivery: {
    attempts: number;
    sentAt?: string;
    error?: string;
  };
};

type StoredRecovery = Omit<GoogleRecoveryState, "configured" | "enabled" | "expectedAccount"> & {
  attemptId?: string;
};

type RecoveryClaim = StoredRecovery & {
  incidentId: string;
  attemptId: string;
};

@Injectable()
export class GoogleSessionRecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly browserUse: BrowserUseClient,
    private readonly google: GoogleSessionService,
    private readonly email: EmailService,
    @Optional() private readonly jobs?: JobDispatcher
  ) {}

  async status(): Promise<GoogleRecoveryState> {
    const [enabled, record] = await Promise.all([
      this.isEnabled(),
      this.prisma.appSetting.findUnique({ where: { key: STATE_KEY } })
    ]);
    const state = parseRecovery(record?.value);
    return {
      configured: this.browserUse.configured(),
      enabled,
      expectedAccount: expectedGoogleAccount(),
      state: state.state,
      incidentId: state.incidentId,
      lastAttemptAt: state.lastAttemptAt,
      lastSuccessAt: state.lastSuccessAt,
      lastError: state.lastError,
      leaseUntil: state.leaseUntil,
      alertDelivery: state.alertDelivery
    };
  }

  async isEnabled() {
    const setting = await this.prisma.appSetting.findUnique({ where: { key: ENABLED_KEY } });
    return setting?.value === true;
  }

  async setEnabled(enabled: boolean) {
    await this.prisma.appSetting.upsert({
      where: { key: ENABLED_KEY },
      create: { key: ENABLED_KEY, value: enabled },
      update: { value: enabled }
    });
    return this.status();
  }

  async queueMayRun() {
    const record = await this.prisma.appSetting.findUnique({ where: { key: STATE_KEY } });
    const state = parseRecovery(record?.value);
    return (
      state.state === "idle" ||
      (state.state === "recovering" &&
        (!state.leaseUntil || new Date(state.leaseUntil).getTime() <= Date.now()))
    );
  }

  async maintain() {
    const record = await this.prisma.appSetting.findUnique({ where: { key: STATE_KEY } });
    const state = parseRecovery(record?.value);
    if (
      state.state === "manual_required" &&
      state.incidentId &&
      !state.alertDelivery.sentAt &&
      state.alertDelivery.attempts < 3
    ) {
      await this.sendManualAlert(state);
    }
  }

  async recoverIfNeeded(reason: string, force = false) {
    const current = await this.google.loadStorageStateWithVersion();
    if (current) {
      const check = await this.google.verifyStorageState(current.state).catch(() => null);
      if (!check) return { recovered: false, state: await this.status() };
      if (check?.health.valid && check.refreshed) {
        await this.google.refreshActiveState(check.refreshed, current);
        await this.markResolved("Existing Google session passed an independent check.");
        return { recovered: true, state: await this.status() };
      }
    }

    if (!force && !(await this.isEnabled())) {
      const disabledClaim = await this.claimIncident(false);
      if (disabledClaim) {
        await this.requireManual(
          "Automatic Google recovery is disabled.",
          disabledClaim.incidentId,
          reason,
          disabledClaim.attemptId
        );
      }
      return { recovered: false, state: await this.status() };
    }
    if (!this.browserUse.configured()) {
      const incompleteClaim = await this.claimIncident(force);
      if (incompleteClaim) {
        await this.requireManual(
          "Automatic Google recovery configuration is incomplete.",
          incompleteClaim.incidentId,
          reason,
          incompleteClaim.attemptId
        );
      }
      return { recovered: false, state: await this.status() };
    }

    const claim = await this.claimIncident(force);
    if (!claim) return { recovered: false, state: await this.status() };
    const expected = await this.google.loadStorageStateWithVersion();

    try {
      const recovered = await this.browserUse.recoverGoogleSession(() => this.renewLease(claim.attemptId));
      if (recovered.accountEmail !== expectedGoogleAccount()) {
        throw new Error(`Recovered session used the wrong Google account`);
      }
      const independent = await this.google.verifyStorageState(recovered.storageState);
      if (!independent.health.valid || !independent.refreshed) {
        throw new Error(independent.health.message);
      }
      const promoted = await this.google.saveRecoveredState(independent.refreshed, expected);
      if (!promoted) {
        const newerSession = await this.google.check();
        if (!newerSession.valid) {
          throw new Error("A newer manual session replaced this recovery attempt but did not verify.");
        }
        await this.markResolved("A newer manually verified Google session was kept.");
        return { recovered: true, staleResultDiscarded: true, state: await this.status() };
      }
      await this.google.markHealthy(
        `Google session was recovered automatically as ${expectedGoogleAccount()}.`
      );
      await this.markResolved("Automatic Google recovery succeeded.");
      return { recovered: true, state: await this.status() };
    } catch (error) {
      await this.requireManual(sanitizeBrowserUseError(error), claim.incidentId, reason, claim.attemptId);
      return { recovered: false, state: await this.status() };
    }
  }

  async retry() {
    const state = await this.status();
    if (state.state === "recovering" && state.leaseUntil && new Date(state.leaseUntil) > new Date()) {
      throw new ConflictException("Google recovery is already running");
    }
    return this.recoverIfNeeded("An administrator requested another recovery attempt.", true);
  }

  async markResolved(message = "Google session was verified manually.") {
    const now = new Date().toISOString();
    await this.prisma.appSetting.upsert({
      where: { key: STATE_KEY },
      create: {
        key: STATE_KEY,
        value: asJson(idleState(now))
      },
      update: {
        value: asJson({ ...idleState(now), resolution: message })
      }
    });
    // Submissions held while the session was expired can run again.
    await this.jobs?.enqueue("automation.queue");
  }

  private async claimIncident(force: boolean): Promise<RecoveryClaim | null> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const record = await this.prisma.appSetting.findUnique({ where: { key: STATE_KEY } });
      const current = parseRecovery(record?.value);
      const leaseActive =
        current.state === "recovering" &&
        Boolean(current.leaseUntil) &&
        new Date(current.leaseUntil as string).getTime() > Date.now();
      if (leaseActive || (current.state === "manual_required" && !force)) return null;

      const now = new Date();
      const claimed: RecoveryClaim = {
        state: "recovering",
        incidentId: force ? crypto.randomUUID() : (current.incidentId ?? crypto.randomUUID()),
        attemptId: crypto.randomUUID(),
        lastAttemptAt: now.toISOString(),
        lastSuccessAt: current.lastSuccessAt,
        leaseUntil: new Date(now.getTime() + LEASE_MS).toISOString(),
        alertDelivery: { attempts: 0 }
      };
      if (record) {
        const updated = await this.prisma.appSetting.updateMany({
          where: { key: STATE_KEY, updatedAt: record.updatedAt },
          data: { value: asJson(claimed) }
        });
        if (updated.count) return claimed;
      } else {
        try {
          await this.prisma.appSetting.create({ data: { key: STATE_KEY, value: asJson(claimed) } });
          return claimed;
        } catch {
          // Another worker created the lease. Re-read and honor it.
        }
      }
    }
    return null;
  }

  private async renewLease(attemptId: string) {
    const record = await this.prisma.appSetting.findUnique({ where: { key: STATE_KEY } });
    const current = parseRecovery(record?.value);
    if (!record || current.attemptId !== attemptId || current.state !== "recovering") {
      throw new Error("Google recovery was superseded by another session check");
    }
    const updated = await this.prisma.appSetting.updateMany({
      where: { key: STATE_KEY, updatedAt: record.updatedAt },
      data: {
        value: asJson({
          ...current,
          leaseUntil: new Date(Date.now() + LEASE_MS).toISOString()
        })
      }
    });
    if (!updated.count) throw new Error("Google recovery lease changed");
  }

  private async requireManual(
    error: string,
    incidentId: string = crypto.randomUUID(),
    context?: string,
    expectedAttemptId?: string
  ) {
    const safeError = sanitizeBrowserUseError(error);
    const record = await this.prisma.appSetting.findUnique({ where: { key: STATE_KEY } });
    const current = parseRecovery(record?.value);
    if (expectedAttemptId && current.attemptId !== expectedAttemptId) return;
    const sameIncident = current.incidentId === incidentId;
    const next: StoredRecovery = {
      state: "manual_required",
      incidentId,
      lastAttemptAt: current.lastAttemptAt ?? new Date().toISOString(),
      lastSuccessAt: current.lastSuccessAt,
      lastError: safeError,
      alertDelivery: sameIncident ? current.alertDelivery : { attempts: 0 }
    };
    if (expectedAttemptId && record) {
      const updated = await this.prisma.appSetting.updateMany({
        where: { key: STATE_KEY, updatedAt: record.updatedAt },
        data: { value: asJson(next) }
      });
      if (!updated.count) return;
    } else {
      await this.prisma.appSetting.upsert({
        where: { key: STATE_KEY },
        create: { key: STATE_KEY, value: asJson(next) },
        update: { value: asJson(next) }
      });
    }
    if (!next.alertDelivery.sentAt) await this.sendManualAlert(next, context);
  }

  private async sendManualAlert(state: StoredRecovery, context?: string) {
    const [recipientSetting, waiting] = await Promise.all([
      this.prisma.appSetting.findUnique({ where: { key: AI_REVIEW_EMAIL_KEY } }),
      this.prisma.submission.count({ where: { status: SubmissionStatus.QUEUED } })
    ]);
    const recipient =
      typeof recipientSetting?.value === "string" && recipientSetting.value.trim()
        ? recipientSetting.value.trim()
        : DEFAULT_AI_REVIEW_EMAIL;
    const settingsUrl = `${process.env.PUBLIC_APP_URL?.replace(/\/$/, "") ?? ""}/admin/settings`;
    let lastError: string | undefined;

    for (let attempt = state.alertDelivery.attempts + 1; attempt <= 3; attempt += 1) {
      try {
        await this.email.sendMessage({
          to: recipient,
          subject: "Action required: reconnect Google for registration queue",
          html: manualRecoveryEmail({
            error: state.lastError ?? "Automatic recovery could not complete",
            waiting,
            settingsUrl,
            context: context ? sanitizeBrowserUseError(new Error(context)) : undefined
          })
        });
        await this.updateAlert(state.incidentId as string, {
          attempts: attempt,
          sentAt: new Date().toISOString()
        });
        return;
      } catch (error) {
        lastError = sanitizeBrowserUseError(error);
        await this.updateAlert(state.incidentId as string, { attempts: attempt, error: lastError });
        if (attempt < 3) await delay(attempt * 1_000);
      }
    }
    if (lastError) {
      await this.updateAlert(state.incidentId as string, { attempts: 3, error: lastError });
    }
  }

  private async updateAlert(incidentId: string, alertDelivery: StoredRecovery["alertDelivery"]) {
    const record = await this.prisma.appSetting.findUnique({ where: { key: STATE_KEY } });
    const current = parseRecovery(record?.value);
    if (!record || current.incidentId !== incidentId) return;
    await this.prisma.appSetting.updateMany({
      where: { key: STATE_KEY, updatedAt: record.updatedAt },
      data: { value: asJson({ ...current, alertDelivery }) }
    });
  }
}

function parseRecovery(value: unknown): StoredRecovery {
  const source = value && typeof value === "object" ? (value as Partial<StoredRecovery>) : {};
  const state = ["idle", "recovering", "manual_required"].includes(source.state ?? "")
    ? (source.state as StoredRecovery["state"])
    : "idle";
  return {
    state,
    incidentId: source.incidentId,
    attemptId: source.attemptId,
    lastAttemptAt: source.lastAttemptAt,
    lastSuccessAt: source.lastSuccessAt,
    lastError: source.lastError,
    leaseUntil: source.leaseUntil,
    alertDelivery: source.alertDelivery ?? { attempts: 0 }
  };
}

function idleState(now: string): StoredRecovery {
  return {
    state: "idle",
    lastSuccessAt: now,
    alertDelivery: { attempts: 0 }
  };
}

function manualRecoveryEmail(input: {
  error: string;
  waiting: number;
  settingsUrl: string;
  context?: string;
}) {
  return `<h1>Google session needs manual attention</h1>
<p>Automatic recovery stopped safely. ${input.waiting} registration(s) are waiting and will not be submitted until Google is reconnected.</p>
<p><strong>Reason:</strong> ${escapeHtml(input.error)}</p>
${input.context ? `<p><strong>Queue context:</strong> ${escapeHtml(input.context)}</p>` : ""}
<ol>
  <li>On your Mac, fully quit Google Chrome.</li>
  <li>Run the existing <code>npm run capture:google --workspace backend</code> command with the plain PMO form URL.</li>
  <li>Open <a href="${escapeHtml(input.settingsUrl)}">Settings</a>, upload the JSON file, then click Check session.</li>
</ol>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function asJson(value: unknown): never {
  return JSON.parse(JSON.stringify(value)) as never;
}
