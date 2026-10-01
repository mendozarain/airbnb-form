import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuditModule } from "./audit/audit.module.js";
import { AutomationModule } from "./automation/automation.module.js";
import { BookingsModule } from "./bookings/bookings.module.js";
import { HostexModule } from "./hostex/hostex.module.js";
import { InvitesModule } from "./invites/invites.module.js";
import { JobsModule } from "./jobs/jobs.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { PricingModule } from "./pricing/pricing.module.js";
import { SettingsModule } from "./settings/settings.module.js";
import { StorageModule } from "./storage/storage.module.js";
import { SubmissionsModule } from "./submissions/submissions.module.js";

// The same feature modules as AppModule without HTTP-only wiring (Better Auth middleware, health), so the
// worker boots every service a job needs without importing the auth instance or an HTTP server.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: [".env.local", ".env"] }),
    PrismaModule,
    JobsModule,
    AuditModule,
    StorageModule,
    HostexModule,
    BookingsModule,
    PricingModule,
    InvitesModule,
    SubmissionsModule,
    SettingsModule,
    AutomationModule
  ]
})
export class WorkerModule {}
