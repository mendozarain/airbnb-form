import { Module } from "@nestjs/common";
import { AutomationModule } from "../automation/automation.module.js";
import { SubmissionsController } from "./submissions.controller.js";
import { SubmissionsService } from "./submissions.service.js";

@Module({
  imports: [AutomationModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService],
  exports: [SubmissionsService]
})
export class SubmissionsModule {}
