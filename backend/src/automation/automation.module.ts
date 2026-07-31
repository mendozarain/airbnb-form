import { Module } from "@nestjs/common";
import { SettingsModule } from "../settings/settings.module.js";
import { AutomationService } from "./automation.service.js";
import { GoogleFormRunner } from "./google-form.runner.js";

@Module({
  imports: [SettingsModule],
  providers: [AutomationService, GoogleFormRunner],
  exports: [AutomationService]
})
export class AutomationModule {}
