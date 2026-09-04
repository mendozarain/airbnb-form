import { Module } from "@nestjs/common";
import { SettingsModule } from "../settings/settings.module.js";
import { AdminInvitesController, PublicInvitesController } from "./invites.controller.js";
import { InvitesService } from "./invites.service.js";

@Module({
  imports: [SettingsModule],
  controllers: [AdminInvitesController, PublicInvitesController],
  providers: [InvitesService],
  exports: [InvitesService]
})
export class InvitesModule {}
