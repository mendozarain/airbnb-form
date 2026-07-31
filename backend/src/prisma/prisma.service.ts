import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "../generated/prisma/client.js";
import { requiredEnv } from "../config/env.js";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const adapter = new PrismaPg({ connectionString: requiredEnv("DATABASE_URL") });
    super({ adapter });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
