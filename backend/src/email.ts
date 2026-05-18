import { connect } from "cloudflare:sockets";
import type { Env } from "./env";

type Attachment = {
  filename: string;
  contentType: string;
  bytes: ArrayBuffer;
};

export type EmailTemplate = {
  subject: string;
  html: string;
};

export const DEFAULT_EMAIL_TEMPLATE: EmailTemplate = {
  subject: "Your Cozy Davao D-714 entrance pass and check-in guide",
  html: `<!doctype html>
<html>
  <body style="margin:0;background:#edf7f5;font-family:Arial,Helvetica,sans-serif;color:#172026;">
    <div style="max-width:720px;margin:0 auto;padding:24px 14px;">
      <div style="background:#0f766e;color:#ffffff;border-radius:12px 12px 0 0;padding:28px 24px;">
        <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;"> </p>
        <h1 style="margin:0;font-size:30px;line-height:1.15;">Cozy DAVAO Airbnb | Matina Enclaves (Near DGT&amp;SM)</h1>
        <p style="margin:14px 0 0;font-size:16px;">Room 714, Building D. Your PMO entrance pass is attached to this email.</p>
      </div>

      <div style="background:#ffffff;border:1px solid #d5dee2;border-top:0;border-radius:0 0 12px 12px;padding:24px;">
        <h2 style="margin:0 0 10px;font-size:22px;">Quick details</h2>
        <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:18px;">
          <tr><td style="padding:8px;border-bottom:1px solid #edf2f3;color:#5e6b73;">Address</td><td style="padding:8px;border-bottom:1px solid #edf2f3;font-weight:700;">Floor 7, Room 714, Matina Enclaves Building D, Genesis 88 Arcade, Eco West Drive, Talomo, Davao City 8000</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #edf2f3;color:#5e6b73;">WiFi</td><td style="padding:8px;border-bottom:1px solid #edf2f3;font-weight:700;">Name: Bldg.D_714 | Password: cloud@731</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #edf2f3;color:#5e6b73;">Keys</td><td style="padding:8px;border-bottom:1px solid #edf2f3;font-weight:700;">Lobby designated mailbox: 714</td></tr>
        </table>

        <div style="margin-top:24px;margin-bottom:24px;padding:14px;border-radius:10px;background:#f0fdfa;border:1px solid #bcd7d2;color:#0d5f59;">
          <strong>Entrance pass attached:</strong> Please keep the attached PMO registration screenshot ready when entering the premises.
        </div>

        <p style="margin:0 0 16px;">You are about 5 minutes from DGT and 5 minutes from SM Ecoland, so food trips, quick errands, and essentials are close by.</p>

        <p style="margin:0 0 20px;">
          <a href="https://www.google.com/maps/search/?api=1&query=Matina%20Enclaves%20Building%20D%20Genesis%2088%20Arcade%20Eco%20West%20Drive%20Davao%20City" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;border-radius:8px;padding:12px 16px;font-weight:700;">Open location in Google Maps</a>
        </p>

        <h2 style="font-size:20px;margin:22px 0 10px;">How to check in</h2>
        <ol style="padding-left:20px;margin-top:0;line-height:1.7;">
          <li>Find the keys inside the lobby designated mailbox: <strong>714</strong>.</li>
          <li>Gate: use the smaller key, twist right, then back to center.</li>
          <li>Main door: use the key with wordings at the back, twist left until you hear 2 clicks, then turn back to center to remove.</li>
          <li>Upon entering, turn on the big main switch on the left side of the power box.</li>
          <li>When checking out, leave the keys inside mailbox 714.</li>
        </ol>

        <div style="display:grid;gap:12px;margin:18px 0;">
          <img src="https://pub-41d35b18e4304b4cb15b733d7bf3b1e3.r2.dev/email/70a592d1-105d-4e92-b94c-871d3a7ce442.jpeg" alt="Mailbox and key location guide" style="width:100%;max-width:640px;border-radius:10px;border:1px solid #d5dee2;display:block;">
          <img src="https://pub-41d35b18e4304b4cb15b733d7bf3b1e3.r2.dev/email/e6135be8-cd5d-4f31-b7f6-0bda7b71f0fb.jpeg" alt="Key pickup guide" style="width:100%;max-width:640px;border-radius:10px;border:1px solid #d5dee2;display:block;">
        </div>

        <h2 style="font-size:20px;margin:22px 0 10px;">Inside the unit</h2>
        <ul style="padding-left:20px;margin-top:0;line-height:1.7;">
          <li>Good for up to 6 guests, 2 bedrooms, balcony, fully equipped kitchen, fully furnished.</li>
          <li>Smart TV, high-speed WiFi, mini karaoke, toilet and bath.</li>
          <li>Free access to swimming pool and basketball court.</li>
          <li>Free street parking and paid parking on premises may be available.</li>
        </ul>

        <h2 style="font-size:20px;margin:22px 0 10px;">Appliance guide</h2>
        <p><strong>Induction stove:</strong> Before use, turn on the only switch that is down upon entering on the power box. Long press the on button, then control heat by dragging the bars. Heat 4-7 is usually enough for regular cooking. Turn off when not in use to help conserve electricity.</p>
        <p><strong>Oven hood:</strong> Tap 2 times to turn on, then adjust the level accordingly.</p>
        <p><strong>TV:</strong> Everything is already plugged in. Please do not unplug anything. Press the button on the bottom-right side behind the TV to power on/off.</p>
        <p><strong>Speaker:</strong> Long press the power icon on the right side of the speaker at the top portion of the circle until you hear a sound. Adjust volume with the left/right buttons.</p>
        <p><strong>Karaoke:</strong> Voice and music come out of different speakers. The karaoke unit is inside the TV console. Turn on the switch at the back. Use AirPlay to connect YouTube to the TV. If AirPlay is not supported, use the YouTube app on the TV.</p>

        <h2 style="font-size:20px;margin:22px 0 10px;">FAQ</h2>
        <p><strong>Is there parking?</strong><br>Yes. Free parking is outside the premises. Paid parking is 250 per night; please message the host if you would like to avail parking.</p>
        <p><strong>If you availed parking:</strong><br>Please let the guard know the unit and building number: Room 714, Building D. They will assign your parking spot.</p>
        <p><strong>Is early check-in possible?</strong><br>Yes, as long as the unit does not currently have a guest staying. Message the host for details.</p>

        <div style="margin-top:24px;padding:14px;border-radius:10px;background:#f0fdfa;border:1px solid #bcd7d2;color:#0d5f59;">
          <strong>Entrance pass attached:</strong> Please keep the attached PMO registration screenshot ready when entering the premises.
        </div>
      </div>
    </div>
  </body>
</html>`
};

export async function sendEntrancePassEmail(env: Env, to: string, attachment: Attachment, template: EmailTemplate = DEFAULT_EMAIL_TEMPLATE) {
  if (!env.GMAIL_SMTP_USER || !env.GMAIL_SMTP_APP_PASSWORD) {
    throw new Error("Gmail SMTP is not configured.");
  }

  const smtp = new SmtpClient();
  await smtp.connect();

  try {
    await smtp.command("EHLO cozy-d-714.local", 250);
    await smtp.command(`AUTH PLAIN ${base64Encode(`\0${env.GMAIL_SMTP_USER}\0${env.GMAIL_SMTP_APP_PASSWORD.replace(/\s/g, "")}`)}`, 235);
    await smtp.command(`MAIL FROM:<${env.GMAIL_SMTP_USER}>`, 250);
    await smtp.command(`RCPT TO:<${to}>`, 250);
    await smtp.command("DATA", 354);
    await smtp.writeData(buildEntrancePassMessage(env.GMAIL_SMTP_USER, to, attachment, template));
    await smtp.expect(250);
    await smtp.command("QUIT", 221);
  } finally {
    await smtp.close();
  }
}

function buildEntrancePassMessage(from: string, to: string, attachment: Attachment, template: EmailTemplate) {
  const boundary = `cozy-d-714-${crypto.randomUUID()}`;
  const alternativeBoundary = `cozy-d-714-alt-${crypto.randomUUID()}`;
  const body = htmlToText(template.html);

  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${sanitizeHeader(template.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    "",
    `--${alternativeBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    body,
    "",
    `--${alternativeBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    template.html,
    "",
    `--${alternativeBoundary}--`,
    "",
    `--${boundary}`,
    `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${attachment.filename}"`,
    "",
    wrapBase64(base64FromArrayBuffer(attachment.bytes)),
    "",
    `--${boundary}--`,
    ""
  ].join("\r\n");
}

class SmtpClient {
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private writer?: WritableStreamDefaultWriter<Uint8Array>;
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();
  private buffer = "";
  private socket?: ReturnType<typeof connect>;

  async connect() {
    this.socket = connect({ hostname: "smtp.gmail.com", port: 465 }, { secureTransport: "on", allowHalfOpen: false });
    await this.socket.opened;
    this.reader = this.socket.readable.getReader();
    this.writer = this.socket.writable.getWriter();
    await this.expect(220);
  }

  async command(command: string, expectedCode: number) {
    await this.write(`${command}\r\n`);
    return this.expect(expectedCode);
  }

  async writeData(message: string) {
    await this.write(`${dotStuff(message)}\r\n.\r\n`);
  }

  async expect(expectedCode: number) {
    const response = await this.readResponse();
    if (response.code !== expectedCode) {
      throw new Error(`SMTP expected ${expectedCode}, got ${response.code}: ${response.text}`);
    }
    return response.text;
  }

  async close() {
    this.reader?.releaseLock();
    this.writer?.releaseLock();
    await this.socket?.close().catch(() => undefined);
  }

  private async write(data: string) {
    if (!this.writer) throw new Error("SMTP writer is not ready.");
    await this.writer.write(this.encoder.encode(data));
  }

  private async readResponse(): Promise<{ code: number; text: string }> {
    while (true) {
      const parsed = this.tryParseResponse();
      if (parsed) return parsed;

      if (!this.reader) throw new Error("SMTP reader is not ready.");
      const chunk = await this.reader.read();
      if (chunk.done) throw new Error("SMTP connection closed unexpectedly.");
      this.buffer += this.decoder.decode(chunk.value, { stream: true });
    }
  }

  private tryParseResponse() {
    const lines = this.buffer.split(/\r?\n/);
    if (!this.buffer.match(/\r?\n$/)) lines.pop();

    if (lines.length === 0) return null;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^\d{3} /.test(line)) {
        this.buffer = this.buffer.slice(lines.slice(0, index + 1).join("\r\n").length + 2);
        return {
          code: Number(line.slice(0, 3)),
          text: lines.slice(0, index + 1).join("\n")
        };
      }
    }

    return null;
  }
}

function dotStuff(message: string) {
  return message.replace(/^\./gm, "..");
}

function wrapBase64(value: string) {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? value;
}

function base64Encode(value: string) {
  return btoa(value);
}

function sanitizeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim() || DEFAULT_EMAIL_TEMPLATE.subject;
}

function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|h3|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function base64FromArrayBuffer(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }

  return btoa(binary);
}
