import { Injectable } from "@nestjs/common";
import type { EmailTemplate } from "@cozy-d-714/shared";
import { requiredEnv } from "../config/env.js";
import {
  COLOR,
  FONT_SANS,
  GREETING_PLACEHOLDER,
  applyGreeting,
  bulletproofButton,
  divider,
  eyebrow,
  emailShell,
  greetingName,
  heading,
  heroRows,
  noteCard,
  numberedSteps,
  paragraph,
  row,
  statGrid,
  textLink
} from "./email-layout.js";

const AGENTMAIL_API_URL = "https://api.agentmail.to/v0";

const MAPS_URL =
  "https://www.google.com/maps/search/?api=1&amp;query=Matina%20Enclaves%20Building%20D%20Genesis%2088%20Arcade%20Eco%20West%20Drive%20Davao%20City";
const ADDRESS =
  "Floor 7, Unit 714, Matina Enclaves Building D, Genesis 88 Arcade, Eco West Drive, Talomo, Davao City 8000";
const KEY_PHOTOS = [
  {
    src: "https://pub-41d35b18e4304b4cb15b733d7bf3b1e3.r2.dev/email/70a592d1-105d-4e92-b94c-871d3a7ce442.jpeg",
    alt: "Mailbox 714 key location"
  },
  {
    src: "https://pub-41d35b18e4304b4cb15b733d7bf3b1e3.r2.dev/email/e6135be8-cd5d-4f31-b7f6-0bda7b71f0fb.jpeg",
    alt: "Keys inside mailbox 714"
  }
];
const GREETING = `Hello ${GREETING_PLACEHOLDER}`;
const SLOT = "<!-- entrance-pass-slot -->";

const section = (eyebrowText: string, title: string, content: string) =>
  row(`${eyebrow(eyebrowText)}${heading(title)}${content}`);

const mapsLink = () =>
  `<p style="margin:16px 0 0;">${textLink(MAPS_URL, "Open location in Google Maps")}</p>`;

const keyPhotos = () =>
  KEY_PHOTOS.map(
    (photo, index) =>
      `<img src="${photo.src}" alt="${photo.alt}" width="536" style="display:block;width:100%;max-width:536px;height:auto;margin:${index === 0 ? "16px 0 12px" : "0"};border-radius:24px;" />`
  ).join("");

const parkingSection = () =>
  section(
    "Parking",
    "Parking options",
    `${paragraph(`<strong style="color:${COLOR.ink};">Free parking</strong> is available outside the premises.`, "0 0 12px")}${paragraph(`<strong style="color:${COLOR.ink};">Paid parking</strong> is ₱250 per night. Message the host if you would like to avail parking. If arranged, tell the guard <strong style="color:${COLOR.ink};">Unit 714, Building D</strong> so they can assign your parking spot.`, "0")}`
  );

export const DEFAULT_EMAIL_TEMPLATE: EmailTemplate = {
  subject: "Your Cozy Davao D-714 entrance pass and check-in guide",
  html: emailShell({
    title: "Cozy Davao D-714 check-in guide",
    preheader: "Everything you need for a smooth arrival at Cozy Davao D-714.",
    panelRows: [
      heroRows({
        greeting: GREETING,
        headline: "Your upcoming stay at Building D, Unit 714",
        lead: "We’re looking forward to hosting you. Your entrance pass and complete arrival guide are below."
      }),
      SLOT,
      section(
        "Quick details",
        "Your details",
        `${statGrid([
          { label: "Address", value: ADDRESS, wide: true },
          {
            label: "WiFi",
            value: `<strong>Name:</strong> Bldg.D_714<br /><strong>Password:</strong> cloud@731`
          },
          {
            label: "Keys",
            value: "Collect and return them at the lobby designated mailbox: <strong>714</strong>."
          },
          {
            label: "Pass",
            value: "Keep the PMO registration image above ready when entering the premises.",
            wide: true
          }
        ])}${paragraph("You are about 5 minutes from DGT and 5 minutes from SM Ecoland, so food trips, quick errands, and essentials are close by.", "20px 0 0")}${mapsLink()}`
      ),
      divider(),
      section(
        "Arrival",
        "How to check in",
        `${numberedSteps([
          "Find the keys inside lobby designated mailbox <strong>714</strong>.",
          "<strong>Gate:</strong> use the smaller key, twist right, then back to center.",
          "<strong>Main door:</strong> use the key with wordings at the back, twist left until you hear 2 clicks, then turn back to center to remove.",
          "Upon entering, turn on the big main switch on the left side of the power box.",
          "When checking out, leave the keys inside mailbox <strong>714</strong>."
        ])}<div style="margin:28px 0 0;padding:22px;background:${COLOR.sunken};border-radius:24px;">${eyebrow("Finding your keys")}<h3 style="margin:0 0 10px;font-family:${FONT_SANS};color:${COLOR.ink};font-size:22px;line-height:28px;font-weight:600;letter-spacing:-0.01em;">Mailbox 714</h3>${paragraph("Look for designated mailbox <strong>714</strong> in the lobby, then open it to collect the key set shown below.", "0")}${keyPhotos()}</div>`
      ),
      divider(),
      section(
        "Your stay",
        "Inside the unit",
        `${statGrid([
          { label: "Guests", value: "6", stat: true },
          { label: "Bedrooms", value: "2", stat: true }
        ])}${paragraph("Good for up to 6 guests, with 2 bedrooms, a balcony, fully equipped kitchen, and complete furnishings. Enjoy the Smart TV, high-speed WiFi, mini karaoke, toilet and bath, free swimming pool and basketball court access. Free street parking and paid parking on premises may be available.", "20px 0 0")}`
      ),
      divider(),
      section(
        "Make yourself at home",
        "Appliance guide",
        [
          noteCard(
            "Induction stove",
            "Before use, turn on the only switch that is down upon entering on the power box. Long press the on button, then control heat by dragging the bars. Heat 4-7 is usually enough for regular cooking. Turn off when not in use to help conserve electricity."
          ),
          noteCard("Oven hood", "Tap 2 times to turn on, then adjust the level accordingly."),
          noteCard(
            "TV",
            "Everything is already plugged in. Please do not unplug anything. Press the button on the bottom-right side behind the TV to power on or off."
          ),
          noteCard(
            "Speaker",
            "Long press the power icon on the right side of the speaker at the top portion of the circle until you hear a sound. Adjust volume with the left and right buttons."
          ),
          noteCard(
            "Karaoke",
            "Voice and music come out of different speakers. The karaoke unit is inside the TV console. Turn on the switch at the back. Use AirPlay to connect YouTube to the TV. If AirPlay is not supported, use the YouTube app on the TV.",
            true
          )
        ].join("")
      ),
      divider(),
      section(
        "Good to know",
        "Frequently asked",
        `<p style="margin:0 0 6px;color:${COLOR.ink};font-family:${FONT_SANS};font-size:17px;line-height:24px;font-weight:500;">Is there parking?</p>${paragraph("Yes. Free parking is outside the premises. Paid parking is ₱250 per night; please message the host if you would like to avail parking. If you availed parking, let the guard know the unit and building number: Unit 714, Building D. They will assign your parking spot.", "0 0 20px")}<p style="margin:0 0 6px;color:${COLOR.ink};font-family:${FONT_SANS};font-size:17px;line-height:24px;font-weight:500;">Is early check-in possible?</p>${paragraph("Yes, as long as the unit does not currently have a guest staying. Message the host for details.", "0")}`
      )
    ].join("\n")
  })
};

export const DEFAULT_VISITOR_VIEWING_EMAIL_TEMPLATE: EmailTemplate = {
  subject: "Your Cozy Davao D-714 entrance pass and visit details",
  html: emailShell({
    title: "Cozy Davao D-714 visit details",
    preheader: "Your entrance pass and essential visit details for Cozy Davao D-714.",
    panelRows: [
      heroRows({
        greeting: GREETING,
        headline: "Your upcoming visit to Building D, Unit 714",
        lead: "We’re looking forward to welcoming you. Your entrance pass and essential visit details are below."
      }),
      SLOT,
      section(
        "Your visit details",
        "Stay connected",
        statGrid([
          { label: "Network", value: "<strong>Bldg.D_714</strong>" },
          { label: "Password", value: "<strong>cloud@731</strong>" }
        ])
      ),
      divider(),
      section("Location", "Find Unit 714", `${paragraph(ADDRESS, "0")}${mapsLink()}`),
      divider(),
      parkingSection()
    ].join("\n")
  })
};

@Injectable()
export class EmailService {
  configured() {
    return Boolean(process.env.AGENTMAIL_API_KEY?.trim() && process.env.AGENTMAIL_INBOX_ID?.trim());
  }

  async sendEntrancePass(
    to: string,
    template: EmailTemplate,
    imageUrl: string,
    recipient?: { guests: Array<{ fullName: string }>; purpose?: string }
  ) {
    const personalised = applyGreeting(template, greetingName(recipient?.guests ?? [], recipient?.purpose));
    const html = addEntrancePassImage(personalised.html, imageUrl);
    return this.sendMessage({
      to,
      subject: personalised.subject,
      html,
      text: `${htmlToText(html)}\n\nOpen entrance pass full size: ${imageUrl}`
    });
  }

  async sendMessage(input: { to: string; subject: string; html: string; text?: string }) {
    const inboxId = requiredEnv("AGENTMAIL_INBOX_ID");
    const replyTo = process.env.EMAIL_REPLY_TO?.trim();
    const body = {
      to: [input.to],
      subject: input.subject.replace(/[\r\n]+/g, " ").trim(),
      html: input.html,
      text: input.text ?? htmlToText(input.html),
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
  <div style="background:${COLOR.sunken};padding:28px 20px 30px;border-radius:24px;text-align:center;">
    <p style="margin:0 0 6px;color:${COLOR.muted};font-family:${FONT_SANS};font-size:14px;line-height:20px;font-weight:500;">Ready at the gate</p>
    <h2 style="margin:0 0 8px;font-family:${FONT_SANS};color:${COLOR.ink};font-size:26px;line-height:32px;font-weight:600;letter-spacing:-0.02em;">Your entrance pass</h2>
    <p style="margin:0 0 18px;font-family:${FONT_SANS};color:${COLOR.muted};font-size:16px;line-height:24px;">Tap the image to open the sharp full-size version.</p>
    <a href="${safeUrl}" target="_blank" style="display:block;text-decoration:none;">
      <img src="${safeUrl}" alt="Matina Enclaves entrance pass" width="430" style="display:block;width:100%;max-width:430px;height:auto;margin:0 auto;border-radius:24px;" />
    </a>
    <div style="margin:22px 0 0;">${bulletproofButton({ href: safeUrl, label: "Open entrance pass full size" })}</div>
  </div>`;

  if (templateHtml.includes("<!-- entrance-pass-slot -->")) {
    return templateHtml.replace(
      "<!-- entrance-pass-slot -->",
      `<tr><td style="padding:24px 32px 8px;">${passCard}</td></tr>`
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
