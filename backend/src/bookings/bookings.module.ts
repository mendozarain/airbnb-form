import { Module } from "@nestjs/common";
import { HostexModule } from "../hostex/hostex.module.js";
import { InvitesModule } from "../invites/invites.module.js";
import { BookingsController } from "./bookings.controller.js";
import { BookingsService } from "./bookings.service.js";

@Module({
  imports: [HostexModule, InvitesModule],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService]
})
export class BookingsModule {}
