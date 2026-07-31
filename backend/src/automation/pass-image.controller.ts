import { Controller, Get, NotFoundException, Param, Res, StreamableFile } from "@nestjs/common";
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
  async image(@Param("token") token: string, @Res({ passthrough: true }) response: Response) {
    let storageKey: string;
    try {
      storageKey = this.links.verifyToken(token);
    } catch {
      throw new NotFoundException("Entrance pass not found");
    }

    const object = await this.storage.get(storageKey);
    if (!object) throw new NotFoundException("Entrance pass not found");

    response.setHeader("Cache-Control", "private, max-age=3600");
    response.setHeader("X-Content-Type-Options", "nosniff");

    return new StreamableFile(this.storage.nodeStream(object), {
      type: "image/png",
      disposition: 'inline; filename="matina-enclaves-entrance-pass.png"'
    });
  }
}
