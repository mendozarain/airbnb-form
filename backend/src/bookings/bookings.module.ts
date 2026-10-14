import { Module } from "@nestjs/common";
import { HostexModule } from "../hostex/hostex.module.js";
import { InvitesModule } from "../invites/invites.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { BookingsController } from "./bookings.controller.js";
import { BookingsService } from "./bookings.service.js";

@Module({
  imports: [HostexModule, InvitesModule, SettingsModule],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService]
})
export class BookingsModule {}
