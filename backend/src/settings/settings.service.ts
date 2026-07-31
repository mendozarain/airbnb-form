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
    return {
      ...(await this.google.status()),
      email: { configured: this.email.configured(), mode: "agentmail_api" as const }
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
