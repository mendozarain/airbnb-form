import { Global, Module } from "@nestjs/common";
import { prisma } from "./prisma.client.js";
import { PrismaService } from "./prisma.service.js";

@Global()
@Module({
  providers: [{ provide: PrismaService, useValue: prisma }],
  exports: [PrismaService]
})
export class PrismaModule {}
