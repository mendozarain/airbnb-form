import { Module } from "@nestjs/common";
import { EmailService } from "../automation/email.service.js";
import { GoogleSessionService } from "./google-session.service.js";
import { BrowserUseClient } from "./browser-use.client.js";
import { GoogleSessionRecoveryService } from "./google-session-recovery.service.js";
import { SettingsController } from "./settings.controller.js";
import { SettingsService } from "./settings.service.js";

@Module({
  controllers: [SettingsController],
  providers: [
    SettingsService,
    GoogleSessionService,
    GoogleSessionRecoveryService,
    BrowserUseClient,
    EmailService
  ],
  exports: [SettingsService, GoogleSessionService, GoogleSessionRecoveryService, EmailService]
})
export class SettingsModule {}
