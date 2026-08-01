import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { AllowAnonymous, Roles } from "@thallesp/nestjs-better-auth";
import { HostexService } from "./hostex.service.js";

@Controller("api/webhooks/hostex")
@AllowAnonymous()
export class HostexWebhookController {
  constructor(private readonly hostex: HostexService) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Headers("hostex-webhook-secret-token") providedSecret: string | undefined,
    @Query("setup") setupToken: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    const authentication = await this.hostex.authenticateWebhook(providedSecret, setupToken);
    if (authentication === "unconfigured")
      throw new ServiceUnavailableException("Hostex webhook is not configured");
    if (authentication === "invalid") throw new UnauthorizedException("Invalid webhook secret");
    return this.hostex.enqueueWebhook(body);
  }
}

@Controller("api/admin/hostex")
@Roles(["admin"])
export class HostexAdminController {
  constructor(private readonly hostex: HostexService) {}

  @Get("status")
  status() {
    return this.hostex.status();
  }

  @Post("sync")
  sync() {
    return this.hostex.syncNow();
  }

  @Post("invites/:id/send")
  send(@Param("id") id: string, @Body() body: { allowUnknownDuplicate?: unknown }) {
    return this.hostex.sendNow(id, body.allowUnknownDuplicate === true);
  }

  @Post("invites/:id/reconcile")
  reconcile(@Param("id") id: string) {
    return this.hostex.reconcileInvite(id);
  }
}
