import "reflect-metadata";
import type { Context, Callback } from "aws-lambda";
import { configure as serverlessExpress } from "@codegenie/serverless-express";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import express from "express";
import { loadSecrets } from "./config/secrets.js";

type ApiHandler = ReturnType<typeof serverlessExpress>;

let cached: Promise<ApiHandler> | undefined;

async function bootstrap(): Promise<ApiHandler> {
  await loadSecrets();
  // Imported after secrets are loaded: auth and storage read their configuration at import time.
  const { AppModule } = await import("./app.module.js");
  const server = express();
  server.set("trust proxy", 1);
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), { bodyParser: false });
  await app.init();
  return serverlessExpress({ app: server });
}

// API Gateway HTTP API (payload v2) entrypoint.
export const handler = async (event: unknown, context: Context, callback: Callback) => {
  cached ??= bootstrap().catch((error) => {
    cached = undefined;
    throw error;
  });
  return (await cached)(event, context, callback);
};
