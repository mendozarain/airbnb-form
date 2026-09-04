import { Module } from "@nestjs/common";
import { AutomationModule } from "../automation/automation.module.js";
import { AiReviewModule } from "../ai-review/ai-review.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { SubmissionsController } from "./submissions.controller.js";
import { SubmissionsService } from "./submissions.service.js";

@Module({
  imports: [AutomationModule, AiReviewModule, SettingsModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService],
  exports: [SubmissionsService]
})
export class SubmissionsModule {}
