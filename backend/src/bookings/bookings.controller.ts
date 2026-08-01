import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { Roles, Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { createBookingInviteSchema, type CreateBookingInviteInput } from "@cozy-d-714/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { HostexService } from "../hostex/hostex.service.js";
import { InvitesService } from "../invites/invites.service.js";
import { BookingsService } from "./bookings.service.js";

@Controller("api/admin/bookings")
@Roles(["admin"])
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly invites: InvitesService,
    private readonly hostex: HostexService
  ) {}

  @Get()
  list(
    @Query("start") start?: string,
    @Query("end") end?: string,
    @Query("status") status?: string,
    @Query("query") query?: string
  ) {
    return this.bookings.list({ start, end, status, query });
  }

  @Get("uncategorized/list")
  uncategorized() {
    return this.bookings.uncategorized();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.bookings.get(id);
  }

  @Post("sync")
  sync() {
    return this.hostex.syncNow();
  }

  @Post(":id/invites")
  createInvite(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createBookingInviteSchema)) body: CreateBookingInviteInput,
    @Session() session: UserSession
  ) {
    return this.invites.createForBooking(id, body, session.user);
  }

  @Post("invites/:inviteId/send")
  send(
    @Param("inviteId") inviteId: string,
    @Body() body: { allowUnknownDuplicate?: unknown },
    @Session() session: UserSession
  ) {
    return this.bookings.sendInvite(inviteId, body.allowUnknownDuplicate === true, session.user);
  }

  @Post("invites/:inviteId/reconcile")
  reconcile(@Param("inviteId") inviteId: string, @Session() session: UserSession) {
    return this.bookings.reconcileInvite(inviteId, session.user);
  }
}
