import { Module } from "@nestjs/common";
import { SettingsModule } from "../settings/settings.module.js";
import { AutomationService } from "./automation.service.js";
import { GoogleFormRunner } from "./google-form.runner.js";
import { PassImageController } from "./pass-image.controller.js";
import { PassImageService } from "./pass-image.service.js";

@Module({
  imports: [SettingsModule],
  controllers: [PassImageController],
  providers: [AutomationService, GoogleFormRunner, PassImageService],
  exports: [AutomationService]
})
export class AutomationModule {}
