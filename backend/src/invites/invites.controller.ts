import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Param,
  Post
} from "@nestjs/common";
import { AllowAnonymous, Roles, Session, type UserSession } from "@thallesp/nestjs-better-auth";
import {
  assignInviteBookingSchema,
  createBookingInviteSchema,
  createInviteSchema,
  guestSubmissionSchema,
  regenerateInviteSchema,
  updateInviteSchema,
  type CreateBookingInviteInput,
  type CreateInviteInput,
  type GuestSubmission,
  type RegenerateInviteInput,
  type UpdateInviteInput
} from "@cozy-d-714/shared";
import { parseUploadRequest } from "../common/upload.js";
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

  @Post("booking/:bookingId")
  createForBooking(
    @Param("bookingId") bookingId: string,
    @Body(new ZodValidationPipe(createBookingInviteSchema)) body: CreateBookingInviteInput,
    @Session() session: UserSession
  ) {
    return this.invites.createForBooking(bookingId, body, session.user);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateInviteSchema)) body: UpdateInviteInput,
    @Session() session: UserSession
  ) {
    return this.invites.update(id, body, session.user);
  }

  @Post(":id/regenerate")
  regenerate(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(regenerateInviteSchema)) body: RegenerateInviteInput,
    @Session() session: UserSession
  ) {
    return this.invites.regenerate(id, body, session.user);
  }

  @Patch(":id/booking")
  assignBooking(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(assignInviteBookingSchema)) body: { bookingId: string | null },
    @Session() session: UserSession
  ) {
    return this.invites.assignBooking(id, body.bookingId, session.user);
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

  @Post(":token/files/presign")
  presignUpload(@Param("token") token: string, @Body() body: unknown) {
    return this.invites.presignUpload(token, parseUploadRequest(body));
  }

  @Post(":token/submission")
  submit(
    @Param("token") token: string,
    @Body(new ZodValidationPipe(guestSubmissionSchema)) body: GuestSubmission
  ) {
    return this.invites.submit(token, body);
  }
}
