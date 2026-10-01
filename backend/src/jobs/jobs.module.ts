import { Global, Module } from "@nestjs/common";
import { BackgroundJobsService } from "./background-jobs.service.js";
import { JobDispatcher } from "./job.dispatcher.js";
import { JobRunner } from "./job.runner.js";
import { JobsController } from "./jobs.controller.js";

@Global()
@Module({
  controllers: [JobsController],
  providers: [JobDispatcher, BackgroundJobsService, JobRunner],
  exports: [JobDispatcher, BackgroundJobsService, JobRunner]
})
export class JobsModule {}
