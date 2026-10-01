import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res
} from "@nestjs/common";
import { Roles, Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { updateSubmissionSchema, type UpdateSubmissionInput } from "@cozy-d-714/shared";
import type { Response } from "express";
import { EntrancePassChatService } from "../automation/entrance-pass-chat.service.js";
import { AutomationService } from "../automation/automation.service.js";
import { AiReviewService } from "../ai-review/ai-review.service.js";
import { parseUploadRequest } from "../common/upload.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { SubmissionsService } from "./submissions.service.js";

@Controller("api/admin")
@Roles(["admin"])
export class SubmissionsController {
  constructor(
    private readonly submissions: SubmissionsService,
    private readonly automation: AutomationService,
    private readonly aiReview: AiReviewService,
    private readonly chat: EntrancePassChatService
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

  @Post("submissions/:id/ai-review/approve")
  approveAiReview(@Param("id") id: string, @Session() session: UserSession) {
    return this.aiReview.approveAndQueue(id, session.user);
  }

  @Post("submissions/:id/ai-review/retry")
  retryAiReview(@Param("id") id: string, @Session() session: UserSession) {
    return this.aiReview.retry(id, session.user);
  }

  @Post("submissions/:id/ai-review/notify")
  retryAiReviewNotification(@Param("id") id: string, @Session() session: UserSession) {
    return this.aiReview.retryNotification(id, session.user);
  }

  @Post("submissions/:id/retry-email")
  retryEmail(@Param("id") id: string) {
    return this.automation.retryEmail(id);
  }

  @Post("submissions/:id/chat-deliveries/:deliveryId/retry")
  retryChat(@Param("id") id: string, @Param("deliveryId") deliveryId: string) {
    return this.chat.retry(id, deliveryId);
  }

  @Post("submissions/:id/chat-deliveries/:deliveryId/reconcile")
  reconcileChat(@Param("id") id: string, @Param("deliveryId") deliveryId: string) {
    return this.chat.reconcile(id, deliveryId);
  }

  @Post("submissions/:id/files/presign")
  presignEditUpload(@Param("id") id: string, @Body() body: unknown) {
    return this.submissions.presignEditUpload(id, parseUploadRequest(body));
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
    response.setHeader("Cache-Control", "private, no-store");
    response.redirect(302, await this.submissions.fileUrl(id));
  }
}
