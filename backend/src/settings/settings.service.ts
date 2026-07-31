import { BadRequestException, Injectable } from "@nestjs/common";
import type { EmailTemplate } from "@cozy-d-714/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import { DEFAULT_EMAIL_TEMPLATE, EmailService } from "../automation/email.service.js";
import { GoogleSessionService } from "./google-session.service.js";

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

  async getEmailTemplate() {
    const setting = await this.prisma.appSetting.findUnique({ where: { key: "email_template" } });
    const value = setting?.value as Partial<EmailTemplate> | undefined;
    return {
      subject: value?.subject?.trim() || DEFAULT_EMAIL_TEMPLATE.subject,
      html: value?.html?.trim() || DEFAULT_EMAIL_TEMPLATE.html
    };
  }

  async saveEmailTemplate(template: EmailTemplate | null | undefined) {
    if (!template || typeof template.subject !== "string" || typeof template.html !== "string") {
      throw new BadRequestException("Subject and HTML are required");
    }
    const subject = template.subject.trim();
    const html = template.html.trim();
    if (!subject || !html) throw new BadRequestException("Subject and HTML are required");
    if (subject.length > 180) throw new BadRequestException("Subject must be 180 characters or fewer");
    if (html.length > 60000) throw new BadRequestException("HTML body is too large");

    const value = { subject, html };
    await this.prisma.appSetting.upsert({
      where: { key: "email_template" },
      create: { key: "email_template", value },
      update: { value }
    });
    return value;
  }
}
