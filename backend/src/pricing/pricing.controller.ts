import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query } from "@nestjs/common";
import { Roles, Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { pricingConfigSchema } from "@cozy-d-714/shared";
import { CalendarService } from "./calendar.service.js";
import { PricingService } from "./pricing.service.js";

@Controller("api/admin/pricing")
@Roles(["admin"])
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get("settings")
  settings() {
    return this.pricing.settings();
  }

  @Put("settings")
  updateSettings(@Body() body: { version: unknown; config: unknown }, @Session() session: UserSession) {
    const version = Number(body.version);
    if (!Number.isInteger(version)) throw new BadRequestException("Pricing settings version is required");
    return this.pricing.updateSettings(pricingConfigSchema.parse(body.config), version, session.user);
  }

  @Post("automation")
  automation(@Body() body: { enabled?: unknown }, @Session() session: UserSession) {
    return this.pricing.setAutomation(body.enabled === true, session.user);
  }

  @Post("preview")
  preview(@Session() session: UserSession) {
    return this.pricing.preview(session.user);
  }

  @Post("runs/:id/apply")
  apply(@Param("id") id: string, @Session() session: UserSession) {
    return this.pricing.apply(id, session.user);
  }

  @Post("runs/:id/submissions/:submissionId/retry")
  retryListing(
    @Param("id") id: string,
    @Param("submissionId") submissionId: string,
    @Body() body: { confirm?: unknown },
    @Session() session: UserSession
  ) {
    if (body.confirm !== true) throw new BadRequestException("Pricing retry confirmation is required");
    return this.pricing.retryListing(id, submissionId, session.user);
  }

  @Get("runs")
  runs() {
    return this.pricing.runs();
  }

  @Get("runs/:id")
  run(@Param("id") id: string) {
    return this.pricing.getRun(id);
  }
}

@Controller("api/admin/calendar")
@Roles(["admin"])
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  get(@Query("start") start: string, @Query("end") end: string) {
    return this.calendar.get(start, end);
  }

  @Post("sync")
  sync(@Body() body: { start?: unknown; end?: unknown }) {
    if (typeof body.start !== "string" || typeof body.end !== "string") {
      throw new BadRequestException("Calendar dates are required");
    }
    return this.calendar.sync(body.start, body.end);
  }
}
