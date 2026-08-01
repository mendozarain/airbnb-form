import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Roles, Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { updateSubmissionSchema, type UpdateSubmissionInput } from "@cozy-d-714/shared";
import type { Response } from "express";
import { AutomationService } from "../automation/automation.service.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
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

  @Post("submissions/:id/files")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 100 * 1024 * 1024 } }))
  uploadEditFile(@Param("id") id: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("File is required");
    return this.submissions.uploadEditFile(id, file);
  }

  @Patch("submissions/:id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateSubmissionSchema)) body: UpdateSubmissionInput,
    @Session() session: UserSession
  ) {
    return this.submissions.update(id, body, session.user);
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
