/**
 * Email-safe building blocks for the Confetti design system.
 * Email clients ignore CSS variables and web fonts unevenly, so everything is
 * table based with the light-theme hex values inlined and Georgia/Arial fallbacks.
 */

export const GREETING_PLACEHOLDER = "{{greeting_name}}";

export const COLOR = {
  surface: "#f6f7f9",
  raised: "#ffffff",
  ink: "#0b1a3a",
  muted: "#5d6478",
  hairline: "#e3e6ee",
  primary: "#0057e6",
  primarySoft: "#e8f0ff",
  accent: "#ff6a3d",
  pink: "#f2bfd2",
  mint: "#cfe8b8",
  sky: "#a9daec",
  butter: "#fbdc6e",
  danger: "#c9302c"
} as const;

export const FONT_SANS = "Arial,'Segoe UI',Helvetica,sans-serif";
export const FONT_SERIF = "Georgia,'Times New Roman',serif";

export type Tone = "pink" | "mint" | "sky" | "butter";

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Strips CR/LF so a value is safe in a subject line. */
function singleLine(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/**
 * First name of the first guest, used for "Hello {name}". Visitors and viewings with more
 * than one guest get "Maria and other guests". Returns an empty string when there is no name.
 */
export function greetingName(guests: Array<{ fullName: string }>, purpose?: string) {
  const first = guests.map((guest) => guest.fullName.trim()).find(Boolean);
  if (!first) return "";
  const word = first.split(/\s+/)[0] ?? "";
  const letters = word.replace(/[^\p{L}]/gu, "");
  const shouting =
    letters.length > 1 && (letters === letters.toUpperCase() || letters === letters.toLowerCase());
  const name = shouting ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word;
  const visitor = purpose !== undefined && purpose !== "Tenant";
  return visitor && guests.filter((guest) => guest.fullName.trim()).length > 1
    ? `${name} and other guests`
    : name;
}

/** Fills {{greeting_name}} in a template. The subject stays plain text; the HTML is escaped. */
export function applyGreeting(template: { subject: string; html: string }, name: string) {
  const display = name || "there";
  return {
    subject: singleLine(template.subject.replaceAll(GREETING_PLACEHOLDER, singleLine(display))),
    html: template.html.replaceAll(GREETING_PLACEHOLDER, escapeHtml(display))
  };
}

const TONE: Record<Tone, string> = {
  pink: COLOR.pink,
  mint: COLOR.mint,
  sky: COLOR.sky,
  butter: COLOR.butter
};

export function eyebrow(text: string, color: string = COLOR.primary) {
  return `<p style="margin:0 0 8px;color:${color};font-family:${FONT_SANS};font-size:13px;line-height:16px;font-weight:bold;letter-spacing:1.04px;text-transform:uppercase;">${text}</p>`;
}

export function heading(text: string, size = 32) {
  return `<h2 style="margin:0 0 16px;font-family:${FONT_SERIF};color:${COLOR.ink};font-size:${size}px;line-height:${Math.round(size * 1.18)}px;font-weight:normal;">${text}</h2>`;
}

export function paragraph(html: string, margin = "0 0 16px") {
  return `<p style="margin:${margin};color:${COLOR.muted};font-family:${FONT_SANS};font-size:16px;line-height:24px;">${html}</p>`;
}

/** A coloured text link. Used for secondary actions so each email keeps one primary button. */
export function textLink(href: string, label: string) {
  return `<a href="${href}" target="_blank" style="color:${COLOR.primary};font-family:${FONT_SANS};font-size:15px;font-weight:bold;text-decoration:underline;">${label}</a>`;
}

/** Bulletproof button: a table cell with a link, never an image. */
export function bulletproofButton({ href, label }: { href: string; label: string }) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;"><tr><td align="center" bgcolor="${COLOR.primary}" style="background:${COLOR.primary};border-radius:12px;"><a href="${href}" target="_blank" style="display:inline-block;padding:16px 28px;color:#ffffff;font-family:${FONT_SANS};font-size:13px;line-height:16px;font-weight:bold;letter-spacing:1.04px;text-transform:uppercase;text-decoration:none;border-radius:12px;">${label}</a></td></tr></table>`;
}

/** A sprinkle of confetti made of inline spans (SVG is stripped by Gmail). */
export function confettiRow() {
  const dot = (color: string, size: number, lift: number) =>
    `<span style="display:inline-block;width:${size}px;height:${size}px;border-radius:50%;background:${color};margin:0 9px;position:relative;top:${lift}px;"></span>`;
  const dash = (color: string, rotate: number, lift: number) =>
    `<span style="display:inline-block;width:14px;height:4px;border-radius:2px;background:${color};margin:0 9px;position:relative;top:${lift}px;transform:rotate(${rotate}deg);"></span>`;
  return `<div style="font-size:0;line-height:0;text-align:center;padding:0 0 22px;" aria-hidden="true">${[
    dash(COLOR.accent, 30, 4),
    dot(COLOR.butter, 7, -6),
    dash(COLOR.primary, -35, 6),
    dot(COLOR.pink, 6, 0),
    dash(COLOR.mint, 20, -4),
    dot(COLOR.accent, 6, 8),
    dash(COLOR.butter, -25, 0),
    dot(COLOR.primary, 7, -5),
    dash(COLOR.pink, 40, 5),
    dot(COLOR.mint, 6, -2),
    dash(COLOR.accent, -20, 7)
  ].join("")}</div>`;
}

export function brandRow(name = "Cozy Davao D-714") {
  return `<tr><td style="padding:0 8px 20px;font-family:${FONT_SANS};font-size:18px;line-height:24px;font-weight:bold;color:${COLOR.ink};"><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${COLOR.primary};vertical-align:-1px;margin-right:8px;"></span>${name}</td></tr>`;
}

/** A full-width row inside the white panel. */
export function row(innerHtml: string, padding = "32px 32px 8px") {
  return `<tr><td style="padding:${padding};">${innerHtml}</td></tr>`;
}

export function divider() {
  return `<tr><td style="padding:24px 32px 0;"><div style="height:1px;line-height:1px;font-size:1px;background:${COLOR.hairline};">&nbsp;</div></td></tr>`;
}

export type GridItem = {
  label: string;
  value: string;
  tone: Tone;
  wide?: boolean;
  /** Render the value as a big number (stat card). */
  stat?: boolean;
};

function gridCell(item: GridItem, width: string, colspan = 1) {
  const value = item.stat
    ? `<p style="margin:0;font-family:${FONT_SANS};font-size:36px;line-height:40px;font-weight:bold;color:${COLOR.ink};">${item.value}</p>`
    : `<p style="margin:0;font-family:${FONT_SANS};font-size:15px;line-height:22px;color:${COLOR.ink};">${item.value}</p>`;
  return `<td valign="top" colspan="${colspan}" width="${width}" style="width:${width};background:${TONE[item.tone]};border-radius:24px;padding:20px;">${eyebrow(item.label, COLOR.ink).replace("margin:0 0 8px", "margin:0 0 6px")}${value}</td>`;
}

/** Flat pastel cards. Consecutive non-wide items pair up into two columns. */
export function pastelGrid(items: GridItem[]) {
  // A zero-height sizing row fixes the 49% / 2% / 49% columns for every row below.
  const rows: string[] = [
    `<tr><td width="49%" style="width:49%;height:0;font-size:0;line-height:0;"></td><td width="2%" style="width:2%;height:0;font-size:0;line-height:0;"></td><td width="49%" style="width:49%;height:0;font-size:0;line-height:0;"></td></tr>`
  ];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const next = items[i + 1];
    if (item.wide || !next || next.wide) {
      rows.push(`<tr>${gridCell(item, "100%", 3)}</tr>`);
    } else {
      rows.push(
        `<tr>${gridCell(item, "49%")}<td width="2%" style="width:2%;font-size:0;line-height:0;">&nbsp;</td>${gridCell(next, "49%")}</tr>`
      );
      i += 1;
    }
    if (i < items.length - 1)
      rows.push(
        `<tr><td colspan="3" height="12" style="height:12px;font-size:0;line-height:0;">&nbsp;</td></tr>`
      );
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;table-layout:fixed;">${rows.join("")}</table>`;
}

export function numberedSteps(items: string[]) {
  const last = items.length - 1;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items
    .map(
      (html, index) =>
        `<tr><td valign="top" style="width:44px;padding:0 12px ${index === last ? 0 : 18}px 0;"><span style="display:inline-block;width:32px;height:32px;border-radius:50%;background:${COLOR.primary};color:#ffffff;text-align:center;line-height:32px;font-family:${FONT_SANS};font-size:14px;font-weight:bold;">${index + 1}</span></td><td valign="top" style="padding:4px 0 ${index === last ? 0 : 18}px;color:${COLOR.ink};font-family:${FONT_SANS};font-size:16px;line-height:24px;">${html}</td></tr>`
    )
    .join("")}</table>`;
}

/** A bordered note: bold title over muted text. */
export function noteCard(title: string, body: string, last = false) {
  return `<div style="margin:0 0 ${last ? 0 : 12}px;padding:16px 18px;border:1px solid ${COLOR.hairline};border-radius:16px;color:${COLOR.muted};font-family:${FONT_SANS};font-size:15px;line-height:23px;"><strong style="color:${COLOR.ink};">${title}</strong><br />${body}</div>`;
}

/** The whole email document: surface background, 600px column, rounded white panel. */
export function emailShell({
  title,
  preheader,
  panelRows,
  footer
}: {
  title: string;
  preheader: string;
  panelRows: string;
  footer?: string;
}) {
  const footerHtml = footer ?? `Cozy DAVAO Airbnb · Matina Enclaves<br />Unit 714, Building D`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:${COLOR.surface};color:${COLOR.ink};font-family:${FONT_SANS};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${COLOR.surface};">
      <tr>
        <td align="center" valign="top" style="padding:28px 12px 40px;">
          <table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;margin:0 auto;text-align:left;">
            ${brandRow()}
            <tr>
              <td>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${COLOR.raised};border-radius:32px;border-collapse:separate;overflow:hidden;">
                  ${panelRows}
                  <tr><td style="height:32px;font-size:0;line-height:0;">&nbsp;</td></tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:24px 20px 0;color:${COLOR.muted};font-family:${FONT_SANS};font-size:14px;line-height:20px;">${footerHtml}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** The hero: confetti, a big serif greeting and a smaller serif line. */
export function heroRows({ greeting, headline, lead }: { greeting: string; headline: string; lead: string }) {
  return row(
    `${confettiRow()}<h1 style="margin:0;text-align:center;font-family:${FONT_SERIF};color:${COLOR.ink};font-size:40px;line-height:44px;font-weight:normal;letter-spacing:-0.4px;">${greeting}</h1><p style="margin:8px 0 0;text-align:center;font-family:${FONT_SERIF};color:${COLOR.ink};font-size:26px;line-height:32px;">${headline}</p><p style="margin:16px auto 0;max-width:440px;text-align:center;color:${COLOR.muted};font-family:${FONT_SANS};font-size:16px;line-height:24px;">${lead}</p>`,
    "40px 32px 16px"
  );
}

/** Alert emails for admins (AI ID check, Google reconnect). Callers escape any dynamic values. */
export function renderAlertEmail({
  title,
  intro,
  bodyHtml,
  cta,
  footer
}: {
  title: string;
  intro: string;
  bodyHtml: string;
  cta?: { href: string; label: string };
  footer?: string;
}) {
  const rows = [
    row(
      `${eyebrow("Admin alert")}<h1 style="margin:0 0 12px;font-family:${FONT_SERIF};color:${COLOR.ink};font-size:32px;line-height:38px;font-weight:normal;">${title}</h1>${paragraph(intro, "0")}`,
      "36px 32px 8px"
    ),
    row(bodyHtml, "16px 32px 8px"),
    cta ? row(bulletproofButton(cta), "16px 32px 8px") : ""
  ].join("");
  return emailShell({
    title,
    preheader: intro,
    panelRows: rows,
    footer: footer ?? "Cozy Davao D-714 · Admin notification"
  });
}

/** A simple data table used by alert emails. */
export function dataTable(headers: string[], rows: string[][]) {
  const th = headers
    .map(
      (h) =>
        `<th align="left" style="padding:10px 12px;word-break:break-word;background:${COLOR.primarySoft};color:${COLOR.ink};font-family:${FONT_SANS};font-size:13px;line-height:16px;font-weight:bold;">${h}</th>`
    )
    .join("");
  const body = rows
    .map(
      (cells) =>
        `<tr>${cells
          .map(
            (c) =>
              `<td valign="top" style="padding:10px 12px;word-break:break-word;overflow-wrap:anywhere;border-top:1px solid ${COLOR.hairline};color:${COLOR.ink};font-family:${FONT_SANS};font-size:14px;line-height:20px;">${c}</td>`
          )
          .join("")}</tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid ${COLOR.hairline};border-radius:16px;border-collapse:separate;table-layout:fixed;overflow:hidden;"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
}
