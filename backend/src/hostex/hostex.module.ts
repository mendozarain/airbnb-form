import { Module } from "@nestjs/common";
import { HostexAdminController, HostexWebhookController } from "./hostex.controller.js";
import { HostexClient } from "./hostex.client.js";
import { HostexService } from "./hostex.service.js";

@Module({
  controllers: [HostexWebhookController, HostexAdminController],
  providers: [HostexClient, HostexService],
  exports: [HostexService, HostexClient]
})
export class HostexModule {}
