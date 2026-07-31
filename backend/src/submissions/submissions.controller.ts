import { Controller, Delete, Get, Param, Post, Query, Res } from "@nestjs/common";
import { Roles, Session, type UserSession } from "@thallesp/nestjs-better-auth";
import type { Response } from "express";
import { AutomationService } from "../automation/automation.service.js";
import { StorageService } from "../storage/storage.service.js";
import { SubmissionsService } from "./submissions.service.js";

@Controller("api/admin")
@Roles(["admin"])
export class SubmissionsController {
  constructor(
    private readonly submissions: SubmissionsService,
    private readonly storage: StorageService,
    private readonly automation: AutomationService
  ) {}

  @Get("me")
  me(@Session() session: UserSession) {
    return { admin: session.user };
  }

  @Get("submissions")
  list(@Query("status") status?: string) {
    return this.submissions.list(status);
  }

  @Get("submissions/:id")
  get(@Param("id") id: string) {
    return this.submissions.get(id);
  }

  @Post("submissions/:id/confirm")
  confirm(@Param("id") id: string) {
    return this.submissions.confirm(id);
  }

  @Post("submissions/:id/retry-email")
  retryEmail(@Param("id") id: string) {
    return this.automation.retryEmail(id);
  }

  @Post("submissions/:id/reject")
  reject(@Param("id") id: string) {
    return this.submissions.reject(id);
  }

  @Post("submissions/:id/reset-submitting")
  reset(@Param("id") id: string) {
    return this.submissions.reset(id);
  }

  @Delete("submissions/:id")
  remove(@Param("id") id: string) {
    return this.submissions.remove(id);
  }

  @Get("files/:id")
  async file(@Param("id") id: string, @Res() response: Response) {
    const { file, object } = await this.submissions.file(id);
    response.setHeader("Content-Type", file.contentType);
    response.setHeader("Content-Disposition", `inline; filename="${file.filename.replace(/["\r\n]/g, "")}"`);
    response.setHeader("Cache-Control", "private, no-store");
    this.storage.nodeStream(object).pipe(response);
  }
}
