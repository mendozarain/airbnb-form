import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Roles } from "@thallesp/nestjs-better-auth";
import type { EmailTemplate } from "@cozy-d-714/shared";
import { GoogleSessionService } from "./google-session.service.js";
import { SettingsService } from "./settings.service.js";

@Controller("api/admin/settings")
@Roles(["admin"])
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly google: GoogleSessionService
  ) {}

  @Get("status")
  status() {
    return this.settings.status();
  }

  @Get("email-template")
  async getTemplate() {
    return { template: await this.settings.getEmailTemplate() };
  }

  @Post("email-template")
  async saveTemplate(@Body() body: EmailTemplate) {
    return { template: await this.settings.saveEmailTemplate(body) };
  }

  @Post("google-session/upload")
  @UseInterceptors(FileInterceptor("storageState", { limits: { fileSize: 5 * 1024 * 1024 } }))
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("Storage-state file is required");
    return this.google.saveUpload(JSON.parse(file.buffer.toString("utf8")) as unknown);
  }

  @Post("google-session/check")
  check() {
    return this.google.check();
  }
}
