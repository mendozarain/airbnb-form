import { Controller, Get, Param } from "@nestjs/common";
import { Roles } from "@thallesp/nestjs-better-auth";
import { BackgroundJobsService } from "./background-jobs.service.js";

@Controller("api/admin/jobs")
@Roles(["admin"])
export class JobsController {
  constructor(private readonly jobs: BackgroundJobsService) {}

  @Get(":id")
  get(@Param("id") id: string) {
    return this.jobs.get(id);
  }
}
