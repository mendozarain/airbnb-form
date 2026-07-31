import { Test } from "@nestjs/testing";
import { jest } from "@jest/globals";
import request from "supertest";
import { HealthController } from "../src/health/health.controller.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

describe("health endpoint", () => {
  it("returns ok when PostgreSQL responds", async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn<() => Promise<Array<{ ok: number }>>>().mockResolvedValue([{ ok: 1 }])
          }
        }
      ]
    }).compile();
    const app = module.createNestApplication();
    await app.init();
    await request(app.getHttpServer()).get("/api/health").expect(200).expect({ ok: true });
    await app.close();
  });
});
