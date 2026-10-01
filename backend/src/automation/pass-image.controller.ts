import { Controller, Get, NotFoundException, Param, Res } from "@nestjs/common";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { Response } from "express";
import { StorageService } from "../storage/storage.service.js";
import { PassImageService } from "./pass-image.service.js";

@Controller("api/entrance-pass")
export class PassImageController {
  constructor(
    private readonly links: PassImageService,
    private readonly storage: StorageService
  ) {}

  @Get(":token")
  @AllowAnonymous()
  async image(@Param("token") token: string, @Res() response: Response) {
    let storageKey: string;
    try {
      storageKey = this.links.verifyToken(token);
    } catch {
      throw new NotFoundException("Entrance pass not found");
    }

    if (!(await this.storage.head(storageKey))) throw new NotFoundException("Entrance pass not found");

    // Lambda responses are capped at 6 MB, so S3 serves the image through a short-lived signed URL.
    const url = await this.storage.presignGet(storageKey, {
      filename: "matina-enclaves-entrance-pass.png",
      contentType: "image/png",
      expiresInSeconds: 300
    });
    response.setHeader("Cache-Control", "private, no-store");
    response.redirect(302, url);
  }
}
