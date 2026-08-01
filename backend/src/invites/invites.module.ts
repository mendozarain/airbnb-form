import { Module } from "@nestjs/common";
import { AdminInvitesController, PublicInvitesController } from "./invites.controller.js";
import { InvitesService } from "./invites.service.js";

@Module({
  controllers: [AdminInvitesController, PublicInvitesController],
  providers: [InvitesService],
  exports: [InvitesService]
})
export class InvitesModule {}
