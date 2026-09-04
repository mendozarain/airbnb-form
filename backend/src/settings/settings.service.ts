import { BadRequestException, Injectable } from "@nestjs/common";
import type { EmailTemplate, EmailTemplateKind, EmailTemplateSet, Purpose } from "@cozy-d-714/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  DEFAULT_EMAIL_TEMPLATE,
  DEFAULT_VISITOR_VIEWING_EMAIL_TEMPLATE,
  EmailService
} from "../automation/email.service.js";
import { GoogleSessionService } from "./google-session.service.js";

const TEMPLATE_KEYS: Record<EmailTemplateKind, string> = {
  tenant: "email_template_tenant",
  visitorViewing: "email_template_visitor_viewing"
};
const LEGACY_TENANT_TEMPLATE_KEY = "email_template";
const AUTO_QUEUE_KEY = "auto_queue";
const AI_ID_CHECK_KEY = "ai_id_check_enabled";
const AI_REVIEW_EMAIL_KEY = "ai_review_email";
export const AI_REVIEW_MODEL = "google/gemini-2.5-flash-lite";
export const DEFAULT_AI_REVIEW_EMAIL = "mendozarhainne@gmail.com";

export function emailTemplateKindForPurpose(purpose: Purpose): EmailTemplateKind {
  return purpose === "Tenant" ? "tenant" : "visitorViewing";
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly google: GoogleSessionService,
    private readonly email: EmailService
  ) {}

  async status() {
    const [autoQueue, aiIdCheckEnabled, reviewEmail, google] = await Promise.all([
      this.isAutoQueueEnabled(),
      this.isAiIdCheckEnabled(),
      this.getAiReviewEmail(),
      this.google.status()
    ]);
    return {
      autoQueue,
      aiIdCheck: {
        enabled: aiIdCheckEnabled,
        configured: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
        model: AI_REVIEW_MODEL,
        reviewEmail
      },
      ...google,
      email: { configured: this.email.configured(), mode: "agentmail_api" as const }
    };
  }

  async isAutoQueueEnabled() {
    const setting = await this.prisma.appSetting.findUnique({ where: { key: AUTO_QUEUE_KEY } });
    return setting?.value !== false;
  }

  async setAutoQueue(enabled: boolean) {
    await this.prisma.appSetting.upsert({
      where: { key: AUTO_QUEUE_KEY },
      create: { key: AUTO_QUEUE_KEY, value: enabled },
      update: { value: enabled }
    });
    return { autoQueue: enabled };
  }

  async isAiIdCheckEnabled() {
    const setting = await this.prisma.appSetting.findUnique({ where: { key: AI_ID_CHECK_KEY } });
    return setting?.value !== false;
  }

  async getAiReviewEmail() {
    const setting = await this.prisma.appSetting.findUnique({ where: { key: AI_REVIEW_EMAIL_KEY } });
    return typeof setting?.value === "string" && setting.value.trim()
      ? setting.value.trim()
      : DEFAULT_AI_REVIEW_EMAIL;
  }

  async setAiIdCheck(enabled: boolean, rawReviewEmail: string) {
    const reviewEmail = rawReviewEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reviewEmail)) {
      throw new BadRequestException("A valid AI review email is required");
    }
    await this.prisma.$transaction([
      this.prisma.appSetting.upsert({
        where: { key: AI_ID_CHECK_KEY },
        create: { key: AI_ID_CHECK_KEY, value: enabled },
        update: { value: enabled }
      }),
      this.prisma.appSetting.upsert({
        where: { key: AI_REVIEW_EMAIL_KEY },
        create: { key: AI_REVIEW_EMAIL_KEY, value: reviewEmail },
        update: { value: reviewEmail }
      })
    ]);
    return {
      enabled,
      configured: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
      model: AI_REVIEW_MODEL,
      reviewEmail
    };
  }

  async getEmailTemplates(): Promise<EmailTemplateSet> {
    const [tenant, legacyTenant, visitorViewing] = await Promise.all([
      this.prisma.appSetting.findUnique({ where: { key: TEMPLATE_KEYS.tenant } }),
      this.prisma.appSetting.findUnique({ where: { key: LEGACY_TENANT_TEMPLATE_KEY } }),
      this.prisma.appSetting.findUnique({ where: { key: TEMPLATE_KEYS.visitorViewing } })
    ]);

    return {
      tenant: normaliseTemplate(tenant?.value ?? legacyTenant?.value, DEFAULT_EMAIL_TEMPLATE),
      visitorViewing: normaliseTemplate(visitorViewing?.value, DEFAULT_VISITOR_VIEWING_EMAIL_TEMPLATE)
    };
  }

  async getEmailTemplate(purpose: Purpose = "Tenant") {
    const templates = await this.getEmailTemplates();
    return templates[emailTemplateKindForPurpose(purpose)];
  }

  async saveEmailTemplateForKind(kind: EmailTemplateKind, template: EmailTemplate | null | undefined) {
    const value = validateTemplate(template);
    await this.prisma.appSetting.upsert({
      where: { key: TEMPLATE_KEYS[kind] },
      create: { key: TEMPLATE_KEYS[kind], value },
      update: { value }
    });
    return value;
  }

  async saveEmailTemplate(template: EmailTemplate | null | undefined) {
    return this.saveEmailTemplateForKind("tenant", template);
  }
}

function normaliseTemplate(value: unknown, fallback: EmailTemplate): EmailTemplate {
  const template = value as Partial<EmailTemplate> | null | undefined;
  return {
    subject: template?.subject?.trim() || fallback.subject,
    html: template?.html?.trim() || fallback.html
  };
}

function validateTemplate(template: EmailTemplate | null | undefined): EmailTemplate {
  if (!template || typeof template.subject !== "string" || typeof template.html !== "string") {
    throw new BadRequestException("Subject and HTML are required");
  }
  const subject = template.subject.trim();
  const html = template.html.trim();
  if (!subject || !html) throw new BadRequestException("Subject and HTML are required");
  if (subject.length > 180) {
    throw new BadRequestException("Subject must be 180 characters or fewer");
  }
  if (html.length > 60000) throw new BadRequestException("HTML body is too large");
  return { subject, html };
}
