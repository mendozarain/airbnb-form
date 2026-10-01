import { Module } from "@nestjs/common";
import { SettingsModule } from "../settings/settings.module.js";
import { AiReviewService } from "./ai-review.service.js";

@Module({
  imports: [SettingsModule],
  providers: [AiReviewService],
  exports: [AiReviewService]
})
export class AiReviewModule {}
