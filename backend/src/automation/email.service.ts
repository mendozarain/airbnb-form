import { Injectable } from "@nestjs/common";
import type { EmailTemplate } from "@cozy-d-714/shared";
import { requiredEnv } from "../config/env.js";

const AGENTMAIL_API_URL = "https://api.agentmail.to/v0";

type Attachment = {
  filename: string;
  contentType: string;
  bytes: Buffer;
};

export const DEFAULT_EMAIL_TEMPLATE: EmailTemplate = {
  subject: "Your Cozy Davao D-714 entrance pass and check-in guide",
  html: `<!doctype html>
<html>
  <body style="margin:0;background:#f4f7f6;font-family:Arial,Helvetica,sans-serif;color:#172026;">
    <div style="max-width:680px;margin:0 auto;padding:24px 14px;">
      <div style="background:#0f766e;color:#fff;padding:24px;border-radius:8px 8px 0 0;">
        <h1 style="margin:0;font-size:28px;">Cozy Davao D-714</h1>
        <p style="margin:12px 0 0;">Your PMO entrance pass is attached.</p>
      </div>
      <div style="background:#fff;border:1px solid #d5dee2;border-top:0;padding:24px;border-radius:0 0 8px 8px;">
        <h2 style="margin-top:0;">Check-in details</h2>
        <p><strong>Address:</strong> Floor 7, Room 714, Matina Enclaves Building D, Genesis 88 Arcade, Eco West Drive, Davao City.</p>
        <p><strong>WiFi:</strong> Bldg.D_714</p>
        <p><strong>Keys:</strong> Collect and return them at lobby mailbox 714.</p>
        <p>Please keep the attached entrance pass ready when entering the premises.</p>
      </div>
    </div>
  </body>
</html>`
};

@Injectable()
export class EmailService {
  configured() {
    return Boolean(process.env.AGENTMAIL_API_KEY?.trim() && process.env.AGENTMAIL_INBOX_ID?.trim());
  }

  async sendEntrancePass(to: string, attachment: Attachment, template: EmailTemplate, imageUrl: string) {
    const inboxId = requiredEnv("AGENTMAIL_INBOX_ID");
    const replyTo = process.env.EMAIL_REPLY_TO?.trim();
    const html = addEntrancePassImage(template.html, imageUrl);
    const body = {
      to: [to],
      subject: template.subject.replace(/[\r\n]+/g, " ").trim(),
      html,
      text: `${htmlToText(html)}\n\nOpen entrance pass full size: ${imageUrl}`,
      attachments: [
        {
          filename: attachment.filename,
          content_type: attachment.contentType,
          content: attachment.bytes.toString("base64")
        }
      ],
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
  const passBlock = `
<div style="max-width:680px;margin:0 auto;padding:0 14px 24px;">
  <div style="background:#fff;border:1px solid #d5dee2;padding:18px 12px 22px;border-radius:8px;text-align:center;">
    <h2 style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;color:#172026;font-size:22px;">Your entrance pass</h2>
    <p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;color:#4b5563;font-size:15px;line-height:1.5;">Tap the image to open the sharp full-size version. The PNG is also attached.</p>
    <a href="${safeUrl}" target="_blank" style="display:block;text-decoration:none;">
      <img src="${safeUrl}" alt="Matina Enclaves entrance pass" width="430" style="display:block;width:100%;max-width:430px;height:auto;margin:0 auto;border:0;" />
    </a>
    <p style="margin:18px 0 0;">
      <a href="${safeUrl}" target="_blank" style="display:inline-block;background:#0f766e;color:#fff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;line-height:1.2;text-decoration:none;padding:13px 20px;border-radius:6px;">Open entrance pass full size</a>
    </p>
  </div>
</div>`;

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
