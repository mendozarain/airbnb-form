import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { AuthModule } from "@thallesp/nestjs-better-auth";
import { auth } from "./auth/auth.js";
import { AuditModule } from "./audit/audit.module.js";
import { AutomationModule } from "./automation/automation.module.js";
import { BookingsModule } from "./bookings/bookings.module.js";
import { HealthModule } from "./health/health.module.js";
import { HostexModule } from "./hostex/hostex.module.js";
import { InvitesModule } from "./invites/invites.module.js";
import { JobsModule } from "./jobs/jobs.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { PricingModule } from "./pricing/pricing.module.js";
import { StorageModule } from "./storage/storage.module.js";
import { SubmissionsModule } from "./submissions/submissions.module.js";
import { SettingsModule } from "./settings/settings.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: [".env.local", ".env"] }),
    // In-process crons are for local development only. On AWS, EventBridge Scheduler and SQS wake the worker
    // (see jobs/), so the database and the API can scale to zero.
    ...(process.env.RUN_INPROCESS_CRONS === "true" ? [ScheduleModule.forRoot()] : []),
    PrismaModule,
    JobsModule,
    AuditModule,
    StorageModule,
    AuthModule.forRoot({
      auth,
      bodyParser: {
        json: { limit: "2mb" },
        urlencoded: { limit: "2mb", extended: true }
      }
    }),
    HealthModule,
    HostexModule,
    BookingsModule,
    PricingModule,
    InvitesModule,
    SubmissionsModule,
    SettingsModule,
    AutomationModule
  ]
})
export class AppModule {}
