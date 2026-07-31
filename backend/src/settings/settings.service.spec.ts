import { BadRequestException } from "@nestjs/common";
import { jest } from "@jest/globals";
import {
  DEFAULT_EMAIL_TEMPLATE,
  DEFAULT_VISITOR_VIEWING_EMAIL_TEMPLATE
} from "../automation/email.service.js";
import { emailTemplateKindForPurpose, SettingsService } from "./settings.service.js";

describe("SettingsService email templates", () => {
  it("maps Tenant separately and shares Visitor of Tenant with Viewing", () => {
    expect(emailTemplateKindForPurpose("Tenant")).toBe("tenant");
    expect(emailTemplateKindForPurpose("Visitor of Tenant")).toBe("visitorViewing");
    expect(emailTemplateKindForPurpose("Viewing")).toBe("visitorViewing");
  });

  it("uses explicit templates, then the legacy Tenant fallback, then defaults", async () => {
    const legacy = { subject: "Legacy tenant", html: "<p>Complete guide</p>" };
    const visitor = { subject: "Visit", html: "<p>Visit essentials</p>" };
    const service = createService({
      email_template: legacy,
      email_template_visitor_viewing: visitor
    });

    await expect(service.getEmailTemplates()).resolves.toEqual({
      tenant: legacy,
      visitorViewing: visitor
    });
    await expect(service.getEmailTemplate("Viewing")).resolves.toEqual(visitor);

    const defaults = createService({});
    await expect(defaults.getEmailTemplates()).resolves.toEqual({
      tenant: DEFAULT_EMAIL_TEMPLATE,
      visitorViewing: DEFAULT_VISITOR_VIEWING_EMAIL_TEMPLATE
    });
  });

  it("saves each template independently and keeps the singular alias Tenant-compatible", async () => {
    const { service, upsert } = createServiceWithMocks({});
    const tenant = { subject: "Tenant", html: "<p>Tenant guide</p>" };
    const visitor = { subject: "Visitor", html: "<p>Visitor essentials</p>" };

    await service.saveEmailTemplateForKind("visitorViewing", visitor);
    await service.saveEmailTemplate(tenant);

    expect(upsert).toHaveBeenNthCalledWith(1, {
      where: { key: "email_template_visitor_viewing" },
      create: { key: "email_template_visitor_viewing", value: visitor },
      update: { value: visitor }
    });
    expect(upsert).toHaveBeenNthCalledWith(2, {
      where: { key: "email_template_tenant" },
      create: { key: "email_template_tenant", value: tenant },
      update: { value: tenant }
    });
  });

  it("rejects an empty template", async () => {
    const service = createService({});
    await expect(
      service.saveEmailTemplateForKind("tenant", { subject: "", html: "<p>Guide</p>" })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

function createService(values: Record<string, unknown>) {
  return createServiceWithMocks(values).service;
}

function createServiceWithMocks(values: Record<string, unknown>) {
  const findUnique = jest.fn(({ where }: { where: { key: string } }) => {
    const value = values[where.key];
    return Promise.resolve(value === undefined ? null : { key: where.key, value });
  });
  const upsert = jest.fn(() => Promise.resolve({}));
  const prisma = { appSetting: { findUnique, upsert } };
  const service = new SettingsService(prisma as never, {} as never, {} as never);
  return { service, findUnique, upsert };
}
