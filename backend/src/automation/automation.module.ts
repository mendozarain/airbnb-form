import { HostexModule } from "../hostex/hostex.module.js";
import { EntrancePassChatService } from "./entrance-pass-chat.service.js";
import { Module } from "@nestjs/common";
import { SettingsModule } from "../settings/settings.module.js";
import { AutomationService } from "./automation.service.js";
import { GoogleFormRunner } from "./google-form.runner.js";
import { PassImageController } from "./pass-image.controller.js";
import { PassImageService } from "./pass-image.service.js";

@Module({
  imports: [SettingsModule, HostexModule],
  controllers: [PassImageController],
  providers: [EntrancePassChatService, AutomationService, GoogleFormRunner, PassImageService],
  exports: [AutomationService, EntrancePassChatService]
})
export class AutomationModule {}
