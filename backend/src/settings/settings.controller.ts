import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Roles } from "@thallesp/nestjs-better-auth";
import { EMAIL_TEMPLATE_KINDS } from "@cozy-d-714/shared";
import type { EmailTemplate, EmailTemplateKind } from "@cozy-d-714/shared";
import { BackgroundJobsService } from "../jobs/background-jobs.service.js";
import { GoogleSessionService } from "./google-session.service.js";
import { GoogleSessionRecoveryService } from "./google-session-recovery.service.js";
import { SettingsService } from "./settings.service.js";

@Controller("api/admin/settings")
@Roles(["admin"])
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly google: GoogleSessionService,
    private readonly googleRecovery: GoogleSessionRecoveryService,
    private readonly jobs: BackgroundJobsService
  ) {}

  @Get("status")
  status() {
    return this.settings.status();
  }

  @Post("auto-queue")
  setAutoQueue(@Body() body: { enabled?: unknown }) {
    if (typeof body.enabled !== "boolean") {
      throw new BadRequestException("Auto queue setting must be true or false");
    }
    return this.settings.setAutoQueue(body.enabled);
  }

  @Post("ai-id-check")
  setAiIdCheck(@Body() body: { enabled?: unknown; reviewEmail?: unknown }) {
    if (typeof body.enabled !== "boolean" || typeof body.reviewEmail !== "string") {
      throw new BadRequestException("AI ID check setting and review email are required");
    }
    return this.settings.setAiIdCheck(body.enabled, body.reviewEmail);
  }

  @Get("email-template")
  async getTemplate() {
    return { template: await this.settings.getEmailTemplate() };
  }

  @Get("email-templates")
  async getTemplates() {
    return { templates: await this.settings.getEmailTemplates() };
  }

  @Post("email-template")
  async saveTemplate(@Body() body: EmailTemplate) {
    return { template: await this.settings.saveEmailTemplate(body) };
  }

  @Post("email-templates/:kind")
  async saveTemplateForKind(@Param("kind") rawKind: string, @Body() body: EmailTemplate) {
    const kind = parseEmailTemplateKind(rawKind);
    return { template: await this.settings.saveEmailTemplateForKind(kind, body) };
  }

  @Post("google-session/upload")
  @UseInterceptors(FileInterceptor("storageState", { limits: { fileSize: 5 * 1024 * 1024 } }))
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("Storage-state file is required");
    return this.google.saveUpload(JSON.parse(file.buffer.toString("utf8")) as unknown);
  }

  // Launches Chromium, which can outlast an API request: run it in the background and poll /api/admin/jobs/:id.
  @Post("google-session/check")
  check() {
    return this.jobs.start("admin.googleCheck");
  }

  @Post("google-session/auto-recovery")
  setGoogleAutoRecovery(@Body() body: { enabled?: unknown }) {
    if (typeof body.enabled !== "boolean") {
      throw new BadRequestException("Automatic recovery setting must be true or false");
    }
    return this.googleRecovery.setEnabled(body.enabled);
  }

  @Post("google-session/recover")
  recoverGoogleSession() {
    return this.jobs.start("admin.googleRecover");
  }
}

function parseEmailTemplateKind(value: string): EmailTemplateKind {
  if (EMAIL_TEMPLATE_KINDS.includes(value as EmailTemplateKind)) {
    return value as EmailTemplateKind;
  }
  throw new BadRequestException("Unknown email template kind");
}
