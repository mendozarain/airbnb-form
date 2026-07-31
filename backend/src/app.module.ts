import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { AuthModule } from "@thallesp/nestjs-better-auth";
import { auth } from "./auth/auth.js";
import { AutomationModule } from "./automation/automation.module.js";
import { HealthModule } from "./health/health.module.js";
import { InvitesModule } from "./invites/invites.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { StorageModule } from "./storage/storage.module.js";
import { SubmissionsModule } from "./submissions/submissions.module.js";
import { SettingsModule } from "./settings/settings.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: [".env.local", ".env"] }),
    ScheduleModule.forRoot(),
    PrismaModule,
    StorageModule,
    AuthModule.forRoot({
      auth,
      bodyParser: {
        json: { limit: "2mb" },
        urlencoded: { limit: "2mb", extended: true }
      }
    }),
    HealthModule,
    InvitesModule,
    SubmissionsModule,
    SettingsModule,
    AutomationModule
  ]
})
export class AppModule {}
