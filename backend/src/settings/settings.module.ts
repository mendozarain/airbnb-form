import { Module } from "@nestjs/common";
import { EmailService } from "../automation/email.service.js";
import { GoogleSessionService } from "./google-session.service.js";
import { SettingsController } from "./settings.controller.js";
import { SettingsService } from "./settings.service.js";

@Module({
  controllers: [SettingsController],
  providers: [SettingsService, GoogleSessionService, EmailService],
  exports: [SettingsService, GoogleSessionService, EmailService]
})
export class SettingsModule {}
