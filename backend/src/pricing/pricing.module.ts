import { Module } from "@nestjs/common";
import { HostexModule } from "../hostex/hostex.module.js";
import { CalendarService } from "./calendar.service.js";
import { CalendarController, PricingController } from "./pricing.controller.js";
import { PricingService } from "./pricing.service.js";

@Module({
  imports: [HostexModule],
  controllers: [PricingController, CalendarController],
  providers: [PricingService, CalendarService],
  exports: [PricingService, CalendarService]
})
export class PricingModule {}
