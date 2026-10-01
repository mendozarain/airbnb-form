import { jest } from "@jest/globals";
import {
  DEFAULT_EMAIL_TEMPLATE,
  DEFAULT_VISITOR_VIEWING_EMAIL_TEMPLATE,
  EmailService
} from "./email.service.js";
import { applyGreeting, greetingName } from "./email-layout.js";

describe("EmailService", () => {
  const originalEnv = { ...process.env };
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    process.env.AGENTMAIL_API_KEY = "test-api-key";
    process.env.AGENTMAIL_INBOX_ID = "cozy-davao@agentmail.to";
    process.env.EMAIL_REPLY_TO = "replies@example.com";
    fetchMock = jest.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchMock.mockRestore();
    process.env = { ...originalEnv };
  });

  it("sends the entrance pass through AgentMail's HTTPS API", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message_id: "<message@example.com>", thread_id: "thread-1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const service = new EmailService();
    const result = await service.sendEntrancePass(
      "guest@example.com",
      {
        subject: "Entrance pass\r\n",
        html: "<p>Hello &amp; welcome</p>"
      },
      "https://dev.example.com/api/entrance-pass/signed-token"
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ messageId: "<message@example.com>", threadId: "thread-1" });
    const [url, request] = fetchMock.mock.calls[0];
    if (typeof request?.body !== "string") throw new Error("Expected a JSON request body");
    const body = JSON.parse(request.body);

    expect(url).toBe("https://api.agentmail.to/v0/inboxes/cozy-davao%40agentmail.to/messages/send");
    expect(request?.method).toBe("POST");
    expect(request?.headers).toMatchObject({ authorization: "Bearer test-api-key" });
    expect(body).toMatchObject({
      to: ["guest@example.com"],
      reply_to: "replies@example.com",
      subject: "Entrance pass"
    });
    expect(body.attachments).toBeUndefined();
    expect(body.html).toContain("<p>Hello &amp; welcome</p>");
    expect(body.html).toContain('src="https://dev.example.com/api/entrance-pass/signed-token"');
    expect(body.html).toContain("Open entrance pass full size");
    expect(body.text).toContain("Hello & welcome");
    expect(body.text).toContain("Open entrance pass full size");
    expect(body.text).toContain("https://dev.example.com/api/entrance-pass/signed-token");
  });

  it("returns a useful error when AgentMail rejects a message", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: "Message rejected" }), {
        status: 403,
        headers: { "content-type": "application/json" }
      })
    );

    const service = new EmailService();
    await expect(
      service.sendEntrancePass(
        "guest@example.com",
        { subject: "Entrance pass", html: "<p>Hello</p>" },
        "https://dev.example.com/api/entrance-pass/signed-token"
      )
    ).rejects.toThrow("AgentMail API failed (403): Message rejected");
  });

  it("reports whether all AgentMail settings are present", () => {
    const service = new EmailService();
    expect(service.configured()).toBe(true);

    delete process.env.AGENTMAIL_API_KEY;
    expect(service.configured()).toBe(false);
  });

  it("keeps the complete hospitality guide in the redesigned default template", () => {
    expect(DEFAULT_EMAIL_TEMPLATE.html).toContain('role="presentation" align="center" width="600"');
    expect(DEFAULT_EMAIL_TEMPLATE.html).toContain("max-width:600px;margin:0 auto;text-align:left;");
    expect(DEFAULT_EMAIL_TEMPLATE.html).toContain("Your upcoming stay at Building D, Unit 714");
    expect(DEFAULT_EMAIL_TEMPLATE.html).toContain("We’re looking forward to hosting you");
    expect(DEFAULT_EMAIL_TEMPLATE.html).toContain("Floor 7, Unit 714");
    expect(DEFAULT_EMAIL_TEMPLATE.html).not.toContain("Room 714");
    expect(DEFAULT_EMAIL_TEMPLATE.html).toContain("How to check in");
    expect(DEFAULT_EMAIL_TEMPLATE.html).toContain("Finding your keys");
    expect(DEFAULT_EMAIL_TEMPLATE.html).toContain('alt="Mailbox 714 key location"');
    expect(DEFAULT_EMAIL_TEMPLATE.html).toContain('alt="Keys inside mailbox 714"');
    expect(DEFAULT_EMAIL_TEMPLATE.html).toContain("Appliance guide");
    expect(DEFAULT_EMAIL_TEMPLATE.html).toContain("Is there parking?");
    expect(DEFAULT_EMAIL_TEMPLATE.html).toContain("Open location in Google Maps");
    expect(DEFAULT_EMAIL_TEMPLATE.html).not.toMatch(/\battach(?:ed|ment)\b/i);
  });

  it("keeps the visitor and viewing template limited to visit essentials", () => {
    expect(DEFAULT_VISITOR_VIEWING_EMAIL_TEMPLATE.subject).toBe(
      "Your Cozy Davao D-714 entrance pass and visit details"
    );
    expect(DEFAULT_VISITOR_VIEWING_EMAIL_TEMPLATE.html).toContain(
      'role="presentation" align="center" width="600"'
    );
    expect(DEFAULT_VISITOR_VIEWING_EMAIL_TEMPLATE.html).toContain(
      "max-width:600px;margin:0 auto;text-align:left;"
    );
    expect(DEFAULT_VISITOR_VIEWING_EMAIL_TEMPLATE.html).toContain(
      "Your upcoming visit to Building D, Unit 714"
    );
    expect(DEFAULT_VISITOR_VIEWING_EMAIL_TEMPLATE.html).toContain("We’re looking forward to welcoming you");
    expect(DEFAULT_VISITOR_VIEWING_EMAIL_TEMPLATE.html).not.toContain(
      "Your upcoming stay at Building D, Unit 714"
    );
    expect(DEFAULT_VISITOR_VIEWING_EMAIL_TEMPLATE.html).toContain("Find Unit 714");
    expect(DEFAULT_VISITOR_VIEWING_EMAIL_TEMPLATE.html).not.toContain("Room 714");
    expect(DEFAULT_VISITOR_VIEWING_EMAIL_TEMPLATE.html).toContain("<!-- entrance-pass-slot -->");
    expect(DEFAULT_VISITOR_VIEWING_EMAIL_TEMPLATE.html).toContain("Bldg.D_714");
    expect(DEFAULT_VISITOR_VIEWING_EMAIL_TEMPLATE.html).toContain("cloud@731");
    expect(DEFAULT_VISITOR_VIEWING_EMAIL_TEMPLATE.html).toContain("Open location in Google Maps");
    expect(DEFAULT_VISITOR_VIEWING_EMAIL_TEMPLATE.html).toContain("Paid parking");
    expect(DEFAULT_VISITOR_VIEWING_EMAIL_TEMPLATE.html).not.toContain("How to check in");
    expect(DEFAULT_VISITOR_VIEWING_EMAIL_TEMPLATE.html).not.toContain("Appliance guide");
    expect(DEFAULT_VISITOR_VIEWING_EMAIL_TEMPLATE.html).not.toContain("Keys");
    expect(DEFAULT_VISITOR_VIEWING_EMAIL_TEMPLATE.html).not.toContain("Finding your keys");
    expect(DEFAULT_VISITOR_VIEWING_EMAIL_TEMPLATE.html).not.toContain("early check-in");
    expect(DEFAULT_VISITOR_VIEWING_EMAIL_TEMPLATE.html).not.toMatch(/\battach(?:ed|ment)\b/i);
  });

  it("uses the Confetti design with a greeting placeholder and the pass slot", () => {
    for (const template of [DEFAULT_EMAIL_TEMPLATE, DEFAULT_VISITOR_VIEWING_EMAIL_TEMPLATE]) {
      expect(template.html).toContain("#0057e6");
      expect(template.html).toContain("Hello {{greeting_name}}");
      expect(template.html).toContain("<!-- entrance-pass-slot -->");
    }
    expect(DEFAULT_EMAIL_TEMPLATE.html).toContain("Your details");
  });

  it("greets a tenant by first name only", () => {
    const guests = [{ fullName: "Maria Santos" }, { fullName: "Jose Santos" }];
    expect(greetingName(guests, "Tenant")).toBe("Maria");
  });

  it("greets a visitor by first name, adding 'and other guests' for several guests", () => {
    expect(greetingName([{ fullName: "Maria Santos" }], "Viewing")).toBe("Maria");
    expect(greetingName([{ fullName: "Maria Santos" }, { fullName: "Jose Santos" }], "Viewing")).toBe(
      "Maria and other guests"
    );
    expect(greetingName([{ fullName: "Maria" }, { fullName: "   " }], "Viewing")).toBe("Maria");
  });

  it("tidies shouted or lowercase names and handles missing names", () => {
    expect(greetingName([{ fullName: "MARIA SANTOS" }], "Tenant")).toBe("Maria");
    expect(greetingName([{ fullName: "maria santos" }], "Tenant")).toBe("Maria");
    expect(greetingName([{ fullName: "McDonald Ray" }], "Tenant")).toBe("McDonald");
    expect(greetingName([], "Tenant")).toBe("");
  });

  it("escapes the name in the body, keeps the subject plain, and falls back to 'there'", () => {
    const filled = applyGreeting(
      { subject: "Hi {{greeting_name}}", html: "<h1>Hello {{greeting_name}}</h1>" },
      '<b>"Mia"</b>\n'
    );
    expect(filled.html).toBe("<h1>Hello &lt;b&gt;&quot;Mia&quot;&lt;/b&gt;\n</h1>");
    expect(filled.subject).toBe('Hi <b>"Mia"</b>');
    expect(applyGreeting({ subject: "Hi {{greeting_name}}", html: "Hello {{greeting_name}}" }, "").html).toBe(
      "Hello there"
    );
  });

  it("personalises the greeting and pass when sending", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message_id: "<m@example.com>" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    await new EmailService().sendEntrancePass(
      "guest@example.com",
      {
        subject: "Hello {{greeting_name}}",
        html: "<p>Hello {{greeting_name}}</p><!-- entrance-pass-slot -->"
      },
      "https://dev.example.com/pass",
      { guests: [{ fullName: "Maria Santos" }, { fullName: "Jose Santos" }], purpose: "Viewing" }
    );
    const request = fetchMock.mock.calls[0]?.[1];
    if (typeof request?.body !== "string") throw new Error("Expected a JSON request body");
    const body = JSON.parse(request.body);
    expect(body.subject).toBe("Hello Maria and other guests");
    expect(body.html).toContain("<p>Hello Maria and other guests</p>");
    expect(body.html).toContain("Open entrance pass full size");
    expect(body.html.match(/Open entrance pass full size/g)).toHaveLength(1);
  });
});
