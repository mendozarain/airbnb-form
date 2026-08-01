import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

export type AuditActor = { id?: string | null; email?: string | null };

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(
    actor: AuditActor | undefined,
    action: string,
    entityType: string,
    entityId: string,
    details?: Record<string, unknown>
  ) {
    return this.prisma.adminAuditEvent.create({
      data: {
        actorUserId: actor?.id ?? null,
        actorEmail: actor?.email ?? null,
        action,
        entityType,
        entityId,
        details: (details ?? undefined) as never
      }
    });
  }
}
