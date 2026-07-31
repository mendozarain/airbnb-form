import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.enableShutdownHooks();
  const server = app.getHttpAdapter().getInstance() as { set(name: string, value: number): void };
  server.set("trust proxy", 1);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, "0.0.0.0");
  console.log(`API listening on http://localhost:${port}`);
}

void bootstrap();
