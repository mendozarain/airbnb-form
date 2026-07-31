import { Injectable } from "@nestjs/common";
import type { EmailTemplate } from "@cozy-d-714/shared";
import { requiredEnv } from "../config/env.js";

const AGENTMAIL_API_URL = "https://api.agentmail.to/v0";

export const DEFAULT_EMAIL_TEMPLATE: EmailTemplate = {
  subject: "Your Cozy Davao D-714 entrance pass and check-in guide",
  html: `<!doctype html>
<html lang="en">
  <head>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>Cozy Davao D-714 check-in guide</title>
  </head>
  <body style="margin:0;padding:0;background:#f4efe7;color:#26332e;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Everything you need for a smooth arrival at Cozy Davao D-714.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f4efe7;">
      <tr>
        <td align="center" valign="top" style="padding:28px 12px 40px;text-align:center;">
          <table role="presentation" align="center" width="680" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:680px;margin:0 auto;text-align:left;">
            <tr>
              <td style="background:#173d32;padding:42px 34px 38px;border-radius:22px 22px 0 0;color:#fff;">
                <p style="margin:0 0 14px;color:#d9c49d;font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;">Matina Enclaves · Davao City</p>
                <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:42px;line-height:1.08;font-weight:normal;">Welcome to Building D Unit 714</h1>
                <p style="margin:18px 0 0;color:#e7efe9;font-size:17px;line-height:1.6;">Your entrance pass is shown below, followed by a thoughtfully gathered guide for an easy arrival and a comfortable stay.</p>
              </td>
            </tr>
            <!-- entrance-pass-slot -->
            <tr>
              <td style="background:#fffdf9;padding:34px;border-left:1px solid #e7dccb;border-right:1px solid #e7dccb;">
                <p style="margin:0 0 8px;color:#9a6f3b;font-size:11px;font-weight:bold;letter-spacing:1.8px;text-transform:uppercase;">Quick details</p>
                <h2 style="margin:0 0 24px;font-family:Georgia,'Times New Roman',serif;color:#173d32;font-size:29px;font-weight:normal;">Keep these close</h2>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;border-spacing:0 10px;">
                  <tr>
                    <td style="width:86px;padding:14px 16px;background:#f7f1e8;border-radius:12px 0 0 12px;color:#8b6238;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">Address</td>
                    <td style="padding:14px 16px;background:#f7f1e8;border-radius:0 12px 12px 0;color:#26332e;font-size:15px;line-height:1.55;">Floor 7, Unit 714, Matina Enclaves Building D, Genesis 88 Arcade, Eco West Drive, Talomo, Davao City 8000</td>
                  </tr>
                  <tr>
                    <td style="width:86px;padding:14px 16px;background:#f7f1e8;border-radius:12px 0 0 12px;color:#8b6238;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">WiFi</td>
                    <td style="padding:14px 16px;background:#f7f1e8;border-radius:0 12px 12px 0;color:#26332e;font-size:15px;line-height:1.55;"><strong>Name:</strong> Bldg.D_714<br /><strong>Password:</strong> cloud@731</td>
                  </tr>
                  <tr>
                    <td style="width:86px;padding:14px 16px;background:#f7f1e8;border-radius:12px 0 0 12px;color:#8b6238;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">Keys</td>
                    <td style="padding:14px 16px;background:#f7f1e8;border-radius:0 12px 12px 0;color:#26332e;font-size:15px;line-height:1.55;">Collect and return them at the lobby designated mailbox: <strong>714</strong>.</td>
                  </tr>
                  <tr>
                    <td style="width:86px;padding:14px 16px;background:#f7f1e8;border-radius:12px 0 0 12px;color:#8b6238;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">Pass</td>
                    <td style="padding:14px 16px;background:#f7f1e8;border-radius:0 12px 12px 0;color:#26332e;font-size:15px;line-height:1.55;">Keep the PMO registration image below ready when entering the premises.</td>
                  </tr>
                </table>
                <p style="margin:22px 0 0;color:#59645f;font-size:15px;line-height:1.7;">You are about 5 minutes from DGT and 5 minutes from SM Ecoland, so food trips, quick errands, and essentials are close by.</p>
                <p style="margin:20px 0 0;">
                  <a href="https://www.google.com/maps/search/?api=1&amp;query=Matina%20Enclaves%20Building%20D%20Genesis%2088%20Arcade%20Eco%20West%20Drive%20Davao%20City" target="_blank" style="display:inline-block;background:#d3b078;color:#173d32;text-decoration:none;padding:13px 19px;border-radius:999px;font-size:14px;font-weight:bold;">Open location in Google Maps</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="background:#edf1ec;padding:34px;border-left:1px solid #dce4dc;border-right:1px solid #dce4dc;">
                <p style="margin:0 0 8px;color:#597066;font-size:11px;font-weight:bold;letter-spacing:1.8px;text-transform:uppercase;">Arrival</p>
                <h2 style="margin:0 0 24px;font-family:Georgia,'Times New Roman',serif;color:#173d32;font-size:29px;font-weight:normal;">How to check in</h2>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td valign="top" style="width:34px;padding:0 12px 18px 0;"><span style="display:inline-block;width:30px;height:30px;border-radius:50%;background:#173d32;color:#fff;text-align:center;line-height:30px;font-size:13px;font-weight:bold;">1</span></td>
                    <td valign="top" style="padding:4px 0 18px;color:#26332e;font-size:15px;line-height:1.65;">Find the keys inside lobby designated mailbox <strong>714</strong>.</td>
                  </tr>
                  <tr>
                    <td valign="top" style="width:34px;padding:0 12px 18px 0;"><span style="display:inline-block;width:30px;height:30px;border-radius:50%;background:#173d32;color:#fff;text-align:center;line-height:30px;font-size:13px;font-weight:bold;">2</span></td>
                    <td valign="top" style="padding:4px 0 18px;color:#26332e;font-size:15px;line-height:1.65;"><strong>Gate:</strong> use the smaller key, twist right, then back to center.</td>
                  </tr>
                  <tr>
                    <td valign="top" style="width:34px;padding:0 12px 18px 0;"><span style="display:inline-block;width:30px;height:30px;border-radius:50%;background:#173d32;color:#fff;text-align:center;line-height:30px;font-size:13px;font-weight:bold;">3</span></td>
                    <td valign="top" style="padding:4px 0 18px;color:#26332e;font-size:15px;line-height:1.65;"><strong>Main door:</strong> use the key with wordings at the back, twist left until you hear 2 clicks, then turn back to center to remove.</td>
                  </tr>
                  <tr>
                    <td valign="top" style="width:34px;padding:0 12px 18px 0;"><span style="display:inline-block;width:30px;height:30px;border-radius:50%;background:#173d32;color:#fff;text-align:center;line-height:30px;font-size:13px;font-weight:bold;">4</span></td>
                    <td valign="top" style="padding:4px 0 18px;color:#26332e;font-size:15px;line-height:1.65;">Upon entering, turn on the big main switch on the left side of the power box.</td>
                  </tr>
                  <tr>
                    <td valign="top" style="width:34px;padding:0 12px 0 0;"><span style="display:inline-block;width:30px;height:30px;border-radius:50%;background:#173d32;color:#fff;text-align:center;line-height:30px;font-size:13px;font-weight:bold;">5</span></td>
                    <td valign="top" style="padding:4px 0 0;color:#26332e;font-size:15px;line-height:1.65;">When checking out, leave the keys inside mailbox <strong>714</strong>.</td>
                  </tr>
                </table>
                <div style="margin:28px 0 0;padding:22px;background:#fffdf9;border:1px solid #dce4dc;border-radius:16px;">
                  <p style="margin:0 0 8px;color:#9a6f3b;font-size:11px;font-weight:bold;letter-spacing:1.8px;text-transform:uppercase;">Finding your keys</p>
                  <h3 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;color:#173d32;font-size:24px;font-weight:normal;">Mailbox 714</h3>
                  <p style="margin:0 0 16px;color:#4f5c56;font-size:15px;line-height:1.65;">Look for designated mailbox <strong>714</strong> in the lobby, then open it to collect the key set shown below.</p>
                  <img src="https://pub-41d35b18e4304b4cb15b733d7bf3b1e3.r2.dev/email/70a592d1-105d-4e92-b94c-871d3a7ce442.jpeg" alt="Mailbox 714 key location" width="612" style="display:block;width:100%;max-width:612px;height:auto;margin:0 auto 14px;border:1px solid #d5dee2;border-radius:12px;" />
                  <img src="https://pub-41d35b18e4304b4cb15b733d7bf3b1e3.r2.dev/email/e6135be8-cd5d-4f31-b7f6-0bda7b71f0fb.jpeg" alt="Keys inside mailbox 714" width="612" style="display:block;width:100%;max-width:612px;height:auto;margin:0 auto;border:1px solid #d5dee2;border-radius:12px;" />
                </div>
              </td>
            </tr>
            <tr>
              <td style="background:#fffdf9;padding:34px;border-left:1px solid #e7dccb;border-right:1px solid #e7dccb;">
                <p style="margin:0 0 8px;color:#9a6f3b;font-size:11px;font-weight:bold;letter-spacing:1.8px;text-transform:uppercase;">Your stay</p>
                <h2 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;color:#173d32;font-size:29px;font-weight:normal;">Inside the unit</h2>
                <p style="margin:0;color:#4f5c56;font-size:15px;line-height:1.75;">Good for up to 6 guests, with 2 bedrooms, a balcony, fully equipped kitchen, and complete furnishings. Enjoy the Smart TV, high-speed WiFi, mini karaoke, toilet and bath, free swimming pool and basketball court access. Free street parking and paid parking on premises may be available.</p>
              </td>
            </tr>
            <tr>
              <td style="background:#f7f1e8;padding:34px;border-left:1px solid #e7dccb;border-right:1px solid #e7dccb;">
                <p style="margin:0 0 8px;color:#9a6f3b;font-size:11px;font-weight:bold;letter-spacing:1.8px;text-transform:uppercase;">Make yourself at home</p>
                <h2 style="margin:0 0 22px;font-family:Georgia,'Times New Roman',serif;color:#173d32;font-size:29px;font-weight:normal;">Appliance guide</h2>
                <div style="margin:0 0 12px;padding:16px 18px;background:#fffdf9;border-left:4px solid #d3b078;border-radius:0 12px 12px 0;color:#4f5c56;font-size:15px;line-height:1.65;"><strong style="color:#173d32;">Induction stove</strong><br />Before use, turn on the only switch that is down upon entering on the power box. Long press the on button, then control heat by dragging the bars. Heat 4-7 is usually enough for regular cooking. Turn off when not in use to help conserve electricity.</div>
                <div style="margin:0 0 12px;padding:16px 18px;background:#fffdf9;border-left:4px solid #d3b078;border-radius:0 12px 12px 0;color:#4f5c56;font-size:15px;line-height:1.65;"><strong style="color:#173d32;">Oven hood</strong><br />Tap 2 times to turn on, then adjust the level accordingly.</div>
                <div style="margin:0 0 12px;padding:16px 18px;background:#fffdf9;border-left:4px solid #d3b078;border-radius:0 12px 12px 0;color:#4f5c56;font-size:15px;line-height:1.65;"><strong style="color:#173d32;">TV</strong><br />Everything is already plugged in. Please do not unplug anything. Press the button on the bottom-right side behind the TV to power on or off.</div>
                <div style="margin:0 0 12px;padding:16px 18px;background:#fffdf9;border-left:4px solid #d3b078;border-radius:0 12px 12px 0;color:#4f5c56;font-size:15px;line-height:1.65;"><strong style="color:#173d32;">Speaker</strong><br />Long press the power icon on the right side of the speaker at the top portion of the circle until you hear a sound. Adjust volume with the left and right buttons.</div>
                <div style="margin:0;padding:16px 18px;background:#fffdf9;border-left:4px solid #d3b078;border-radius:0 12px 12px 0;color:#4f5c56;font-size:15px;line-height:1.65;"><strong style="color:#173d32;">Karaoke</strong><br />Voice and music come out of different speakers. The karaoke unit is inside the TV console. Turn on the switch at the back. Use AirPlay to connect YouTube to the TV. If AirPlay is not supported, use the YouTube app on the TV.</div>
              </td>
            </tr>
            <tr>
              <td style="background:#fffdf9;padding:34px;border:1px solid #e7dccb;border-top:0;border-radius:0 0 22px 22px;">
                <p style="margin:0 0 8px;color:#9a6f3b;font-size:11px;font-weight:bold;letter-spacing:1.8px;text-transform:uppercase;">Good to know</p>
                <h2 style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;color:#173d32;font-size:29px;font-weight:normal;">Frequently asked</h2>
                <p style="margin:0 0 8px;color:#173d32;font-size:16px;font-weight:bold;">Is there parking?</p>
                <p style="margin:0 0 22px;color:#4f5c56;font-size:15px;line-height:1.7;">Yes. Free parking is outside the premises. Paid parking is ₱250 per night; please message the host if you would like to avail parking. If you availed parking, let the guard know the unit and building number: Unit 714, Building D. They will assign your parking spot.</p>
                <p style="margin:0 0 8px;color:#173d32;font-size:16px;font-weight:bold;">Is early check-in possible?</p>
                <p style="margin:0;color:#4f5c56;font-size:15px;line-height:1.7;">Yes, as long as the unit does not currently have a guest staying. Message the host for details.</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:24px 20px 0;color:#7a817d;font-size:12px;line-height:1.6;">Cozy DAVAO Airbnb · Matina Enclaves<br />Unit 714, Building D</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
};

export const DEFAULT_VISITOR_VIEWING_EMAIL_TEMPLATE: EmailTemplate = {
  subject: "Your Cozy Davao D-714 entrance pass and visit details",
  html: `<!doctype html>
<html lang="en">
  <head>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>Cozy Davao D-714 visit details</title>
  </head>
  <body style="margin:0;padding:0;background:#f4efe7;color:#26332e;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your entrance pass and essential visit details for Cozy Davao D-714.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f4efe7;">
      <tr>
        <td align="center" valign="top" style="padding:28px 12px 40px;text-align:center;">
          <table role="presentation" align="center" width="680" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:680px;margin:0 auto;text-align:left;">
            <tr>
              <td style="background:#173d32;padding:42px 34px 38px;border-radius:22px 22px 0 0;color:#fff;">
                <p style="margin:0 0 14px;color:#d9c49d;font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;">Matina Enclaves · Davao City</p>
                <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:42px;line-height:1.08;font-weight:normal;">Your visit to Building D Unit 714</h1>
                <p style="margin:18px 0 0;color:#e7efe9;font-size:17px;line-height:1.6;">Your entrance pass is shown below, followed by the essential details for your visit.</p>
              </td>
            </tr>
            <!-- entrance-pass-slot -->
            <tr>
              <td style="background:#fffdf9;padding:34px;border-left:1px solid #e7dccb;border-right:1px solid #e7dccb;">
                <p style="margin:0 0 8px;color:#9a6f3b;font-size:11px;font-weight:bold;letter-spacing:1.8px;text-transform:uppercase;">Wi-Fi</p>
                <h2 style="margin:0 0 22px;font-family:Georgia,'Times New Roman',serif;color:#173d32;font-size:29px;font-weight:normal;">Stay connected</h2>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;border-spacing:0 10px;">
                  <tr>
                    <td style="width:100px;padding:14px 16px;background:#f7f1e8;border-radius:12px 0 0 12px;color:#8b6238;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">Network</td>
                    <td style="padding:14px 16px;background:#f7f1e8;border-radius:0 12px 12px 0;color:#26332e;font-size:15px;line-height:1.55;"><strong>Bldg.D_714</strong></td>
                  </tr>
                  <tr>
                    <td style="width:100px;padding:14px 16px;background:#f7f1e8;border-radius:12px 0 0 12px;color:#8b6238;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">Password</td>
                    <td style="padding:14px 16px;background:#f7f1e8;border-radius:0 12px 12px 0;color:#26332e;font-size:15px;line-height:1.55;"><strong>cloud@731</strong></td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background:#edf1ec;padding:34px;border-left:1px solid #dce4dc;border-right:1px solid #dce4dc;">
                <p style="margin:0 0 8px;color:#597066;font-size:11px;font-weight:bold;letter-spacing:1.8px;text-transform:uppercase;">Location</p>
                <h2 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;color:#173d32;font-size:29px;font-weight:normal;">Find Unit 714</h2>
                <p style="margin:0;color:#26332e;font-size:15px;line-height:1.7;">Floor 7, Unit 714, Matina Enclaves Building D, Genesis 88 Arcade, Eco West Drive, Talomo, Davao City 8000</p>
                <p style="margin:22px 0 0;">
                  <a href="https://www.google.com/maps/search/?api=1&amp;query=Matina%20Enclaves%20Building%20D%20Genesis%2088%20Arcade%20Eco%20West%20Drive%20Davao%20City" target="_blank" style="display:inline-block;background:#d3b078;color:#173d32;text-decoration:none;padding:13px 19px;border-radius:999px;font-size:14px;font-weight:bold;">Open location in Google Maps</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="background:#fffdf9;padding:34px;border:1px solid #e7dccb;border-top:0;border-radius:0 0 22px 22px;">
                <p style="margin:0 0 8px;color:#9a6f3b;font-size:11px;font-weight:bold;letter-spacing:1.8px;text-transform:uppercase;">Parking</p>
                <h2 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;color:#173d32;font-size:29px;font-weight:normal;">Parking options</h2>
                <p style="margin:0 0 14px;color:#4f5c56;font-size:15px;line-height:1.7;"><strong style="color:#173d32;">Free parking</strong> is available outside the premises.</p>
                <p style="margin:0;color:#4f5c56;font-size:15px;line-height:1.7;"><strong style="color:#173d32;">Paid parking</strong> is ₱250 per night. Message the host if you would like to avail parking. If arranged, tell the guard <strong>Unit 714, Building D</strong> so they can assign your parking spot.</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:24px 20px 0;color:#7a817d;font-size:12px;line-height:1.6;">Cozy DAVAO Airbnb · Matina Enclaves<br />Unit 714, Building D</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
};

@Injectable()
export class EmailService {
  configured() {
    return Boolean(process.env.AGENTMAIL_API_KEY?.trim() && process.env.AGENTMAIL_INBOX_ID?.trim());
  }

  async sendEntrancePass(to: string, template: EmailTemplate, imageUrl: string) {
    const inboxId = requiredEnv("AGENTMAIL_INBOX_ID");
    const replyTo = process.env.EMAIL_REPLY_TO?.trim();
    const html = addEntrancePassImage(template.html, imageUrl);
    const body = {
      to: [to],
      subject: template.subject.replace(/[\r\n]+/g, " ").trim(),
      html,
      text: `${htmlToText(html)}\n\nOpen entrance pass full size: ${imageUrl}`,
      ...(replyTo ? { reply_to: replyTo } : {})
    };

    let response: Response;
    try {
      response = await fetch(`${AGENTMAIL_API_URL}/inboxes/${encodeURIComponent(inboxId)}/messages/send`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${requiredEnv("AGENTMAIL_API_KEY")}`
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000)
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new Error("AgentMail API timed out");
      }
      throw error;
    }

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = getAgentMailError(payload);
      throw new Error(`AgentMail API failed (${response.status})${detail ? `: ${detail}` : ""}`);
    }

    if (!payload || typeof payload !== "object" || !("message_id" in payload)) {
      throw new Error("AgentMail API returned an invalid response");
    }
    const result = payload as { message_id?: unknown; thread_id?: unknown };
    if (typeof result.message_id !== "string") {
      throw new Error("AgentMail API returned an invalid response");
    }
    return {
      messageId: result.message_id,
      threadId: typeof result.thread_id === "string" ? result.thread_id : undefined
    };
  }
}

export function addEntrancePassImage(templateHtml: string, imageUrl: string) {
  const safeUrl = escapeHtmlAttribute(imageUrl);
  const passCard = `
  <div style="background:#fffdf9;border:1px solid #e7dccb;padding:28px 14px 30px;border-radius:22px;text-align:center;">
    <p style="margin:0 0 8px;color:#9a6f3b;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1.8px;text-transform:uppercase;">Ready at the gate</p>
    <h2 style="margin:0 0 8px;font-family:Georgia,'Times New Roman',serif;color:#173d32;font-size:29px;font-weight:normal;">Your entrance pass</h2>
    <p style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;color:#59645f;font-size:15px;line-height:1.6;">Tap the image to open the sharp full-size version.</p>
    <a href="${safeUrl}" target="_blank" style="display:block;text-decoration:none;">
      <img src="${safeUrl}" alt="Matina Enclaves entrance pass" width="430" style="display:block;width:100%;max-width:430px;height:auto;margin:0 auto;border:1px solid #e7dccb;border-radius:14px;" />
    </a>
    <p style="margin:20px 0 0;">
      <a href="${safeUrl}" target="_blank" style="display:inline-block;background:#173d32;color:#fff;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;line-height:1.2;text-decoration:none;padding:14px 22px;border-radius:999px;">Open entrance pass full size</a>
    </p>
  </div>`;

  if (templateHtml.includes("<!-- entrance-pass-slot -->")) {
    return templateHtml.replace(
      "<!-- entrance-pass-slot -->",
      `<tr><td style="padding:16px 0;">${passCard}</td></tr>`
    );
  }

  const passBlock = `<div style="max-width:680px;margin:0 auto;padding:0 12px 32px;">${passCard}</div>`;

  if (/<\/body\s*>/i.test(templateHtml)) {
    return templateHtml.replace(/<\/body\s*>/i, `${passBlock}\n</body>`);
  }
  return `${templateHtml}\n${passBlock}`;
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&#39;");
}

function getAgentMailError(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const value = payload as { message?: unknown; detail?: unknown };
  const detail = value.message ?? value.detail;
  if (typeof detail === "string") return detail.slice(0, 500);
  return detail ? JSON.stringify(detail).slice(0, 500) : "";
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
