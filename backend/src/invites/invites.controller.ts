import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AllowAnonymous, Roles } from "@thallesp/nestjs-better-auth";
import {
  createInviteSchema,
  guestSubmissionSchema,
  type CreateInviteInput,
  type GuestSubmission
} from "@cozy-d-714/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { InvitesService } from "./invites.service.js";

@Controller("api/admin/invites")
@Roles(["admin"])
export class AdminInvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Post()
  create(@Body(new ZodValidationPipe(createInviteSchema)) body: CreateInviteInput) {
    return this.invites.create(body);
  }

  @Get()
  list() {
    return this.invites.list();
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.invites.remove(id);
  }
}

@Controller("api/invites")
@AllowAnonymous()
export class PublicInvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Get(":token")
  get(@Param("token") token: string) {
    return this.invites.getPublic(token);
  }

  @Post(":token/files")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 100 * 1024 * 1024 } }))
  upload(@Param("token") token: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("File is required");
    return this.invites.upload(token, file);
  }

  @Post(":token/submission")
  submit(
    @Param("token") token: string,
    @Body(new ZodValidationPipe(guestSubmissionSchema)) body: GuestSubmission
  ) {
    return this.invites.submit(token, body);
  }
}
