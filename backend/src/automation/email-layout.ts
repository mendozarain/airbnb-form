/**
 * Email-safe building blocks for the Signal design system.
 * Email clients ignore CSS variables and web fonts unevenly, so everything is
 * table based with the light-theme hex values inlined and Helvetica/Arial fallbacks.
 * Structure: product name, status pill, headline, one paragraph, stats, one black pill button, footer.
 */

export const GREETING_PLACEHOLDER = "{{greeting_name}}";

export const COLOR = {
  surface: "#ecebe7",
  raised: "#ffffff",
  sunken: "#f3f2ef",
  ink: "#111111",
  muted: "#66655f",
  hairline: "#e2e1dc",
  primary: "#111111",
  onPrimary: "#ffffff",
  onAccent: "#111111",
  yellow: "#fccb0f",
  yellowSoft: "#fff3c4",
  orange: "#f7a21b",
  green: "#1fb156",
  mint: "#3ddc97",
  danger: "#b42318"
} as const;

export const FONT_SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";
export const FONT_MONO = "Menlo,Consolas,'SFMono-Regular',monospace";

/** Icons and illustrations are PNGs served by the frontend (see scripts/generate-email-icons.mjs). */
export const EMAIL_ASSET_BASE = "https://main.dlgf4rsqcswz5.amplifyapp.com/email";

export type EmailIcon =
  | "map-pin"
  | "wifi"
  | "key"
  | "ticket"
  | "door-open"
  | "users"
  | "bed"
  | "stove"
  | "hood"
  | "tv"
  | "speaker"
  | "mic"
  | "car"
  | "clock"
  | "mailbox"
  | "pool"
  | "power"
  | "help"
  | "badge-check";

/** A round outline icon. Emails cannot use SVG, so this is a PNG with alt text. */
export function iconDisc(name: EmailIcon, alt: string, size = 48, onSunken = false) {
  return `<img src="${EMAIL_ASSET_BASE}/icons/${name}${onSunken ? "-on-sunken" : ""}.png" alt="${alt}" width="${size}" height="${size}" style="display:block;width:${size}px;height:${size}px;border:0;border-radius:50%;" />`;
}

/** Icon on the left, content on the right. */
export function withIcon(icon: string, size: number, content: string, gap = 14) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="top" width="${size + gap}" style="width:${size + gap}px;padding:0 ${gap}px 0 0;">${icon}</td><td valign="top">${content}</td></tr></table>`;
}

/** The hero line drawing: Building D, the Unit 714 door and a key. */
export function heroIllustration() {
  return `<img src="${EMAIL_ASSET_BASE}/hero.png" alt="Illustration of Building D with a key and a location pin" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:24px;" />`;
}

export type PillTone = "pending" | "attention" | "done" | "sent" | "neutral";

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

const PILL: Record<PillTone, string> = {
  pending: COLOR.yellow,
  attention: COLOR.orange,
  done: COLOR.green,
  sent: COLOR.mint,
  neutral: COLOR.sunken
};

/** Status pill: colour says the state, the word always says it too. */
export function statusPill(text: string, tone: PillTone = "done") {
  return `<span style="display:inline-block;padding:7px 14px;border-radius:999px;background:${PILL[tone]};color:${COLOR.onAccent};font-family:${FONT_SANS};font-size:15px;line-height:20px;font-weight:500;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${COLOR.onAccent};margin-right:8px;vertical-align:1px;"></span>${text}</span>`;
}

/** A small muted label above a heading. */
export function eyebrow(text: string, color: string = COLOR.muted) {
  return `<p style="margin:0 0 6px;color:${color};font-family:${FONT_SANS};font-size:14px;line-height:20px;font-weight:500;">${text}</p>`;
}

export function heading(text: string, size = 26) {
  return `<h2 style="margin:0 0 16px;font-family:${FONT_SANS};color:${COLOR.ink};font-size:${size}px;line-height:${Math.round(size * 1.24)}px;font-weight:600;letter-spacing:-0.02em;">${text}</h2>`;
}

export function paragraph(html: string, margin = "0 0 16px") {
  return `<p style="margin:${margin};color:${COLOR.muted};font-family:${FONT_SANS};font-size:16px;line-height:24px;">${html}</p>`;
}

/** A text link. Used for secondary actions so each email keeps one primary button. */
export function textLink(href: string, label: string) {
  return `<a href="${href}" target="_blank" style="color:${COLOR.ink};font-family:${FONT_SANS};font-size:16px;font-weight:500;text-decoration:underline;">${label}</a>`;
}

/** Bulletproof button: a black pill table cell with a link, never an image. */
export function bulletproofButton({ href, label }: { href: string; label: string }) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;"><tr><td align="center" bgcolor="${COLOR.primary}" style="background:${COLOR.primary};border-radius:999px;"><a href="${href}" target="_blank" style="display:inline-block;padding:16px 32px;color:${COLOR.onPrimary};font-family:${FONT_SANS};font-size:18px;line-height:24px;font-weight:500;text-decoration:none;border-radius:999px;">${label}</a></td></tr></table>`;
}

export function brandRow(name = "Cozy Davao D-714", reference = "Unit 714 · Building D") {
  return `<tr><td style="padding:0 8px 20px;font-family:${FONT_SANS};font-size:18px;line-height:24px;font-weight:600;color:${COLOR.ink};">${name}<span style="font-family:${FONT_MONO};font-size:14px;line-height:20px;font-weight:normal;color:${COLOR.muted};margin-left:10px;">${reference}</span></td></tr>`;
}

/** A full-width row inside the white panel. */
export function row(innerHtml: string, padding = "32px 32px 8px") {
  return `<tr><td style="padding:${padding};">${innerHtml}</td></tr>`;
}

export function divider() {
  return `<tr><td style="padding:24px 32px 0;"><div style="height:1px;line-height:1px;font-size:1px;background:${COLOR.hairline};">&nbsp;</div></td></tr>`;
}

export type GridItem = {
  icon?: EmailIcon;
  label: string;
  value: string;
  wide?: boolean;
  /** Render the value as a big number. */
  stat?: boolean;
};

function gridCell(item: GridItem, colspan: number, border: string) {
  const value = item.stat
    ? `<p style="margin:2px 0 0;font-family:${FONT_SANS};font-size:32px;line-height:38px;font-weight:600;letter-spacing:-0.02em;color:${COLOR.ink};">${item.value}</p>`
    : `<p style="margin:2px 0 0;font-family:${FONT_SANS};font-size:16px;line-height:24px;font-weight:500;color:${COLOR.ink};">${item.value}</p>`;
  const text = `<p style="margin:0;font-family:${FONT_SANS};font-size:14px;line-height:20px;color:${COLOR.muted};">${item.label}</p>${value}`;
  return `<td valign="top" colspan="${colspan}" style="padding:14px 18px;${border}">${item.icon ? withIcon(iconDisc(item.icon, "", 36), 36, text, 12) : text}</td>`;
}

/** Signal stat grid: one bordered panel of label/value cells. Consecutive non-wide items pair up. */
export function statGrid(items: GridItem[]) {
  const rows: string[] = [];
  const line = `1px solid ${COLOR.hairline}`;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const next = items[i + 1];
    const top = rows.length ? `border-top:${line};` : "";
    if (item.wide || !next || next.wide) {
      rows.push(`<tr>${gridCell(item, 2, top)}</tr>`);
    } else {
      rows.push(`<tr>${gridCell(item, 1, top)}${gridCell(next, 1, `${top}border-left:${line};`)}</tr>`);
      i += 1;
    }
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:${line};border-radius:20px;border-collapse:separate;table-layout:fixed;">${rows.join("")}</table>`;
}

export function numberedSteps(items: string[]) {
  const last = items.length - 1;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items
    .map(
      (html, index) =>
        `<tr><td valign="top" style="width:44px;padding:0 12px ${index === last ? 0 : 18}px 0;"><span style="display:inline-block;width:32px;height:32px;border-radius:50%;background:${COLOR.primary};color:${COLOR.onPrimary};text-align:center;line-height:32px;font-family:${FONT_MONO};font-size:14px;">${index + 1}</span></td><td valign="top" style="padding:4px 0 ${index === last ? 0 : 18}px;color:${COLOR.ink};font-family:${FONT_SANS};font-size:16px;line-height:24px;">${html}</td></tr>`
    )
    .join("")}</table>`;
}

/** A sunken row: medium title over muted text. */
export function noteCard(title: string, body: string, last = false, icon?: EmailIcon) {
  const text = `<strong style="color:${COLOR.ink};font-size:17px;font-weight:500;">${title}</strong><br />${body}`;
  return `<div style="margin:0 0 ${last ? 0 : 12}px;padding:16px 20px;background:${COLOR.sunken};border-radius:24px;color:${COLOR.muted};font-family:${FONT_SANS};font-size:15px;line-height:23px;">${icon ? withIcon(iconDisc(icon, "", 44, true), 44, text, 14) : text}</div>`;
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
              <td style="padding:24px 8px 0;color:${COLOR.muted};font-family:${FONT_SANS};font-size:14px;line-height:20px;">${footerHtml}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** The hero: status pill, a display greeting, a headline and one short paragraph. */
export function heroRows({
  greeting,
  headline,
  lead,
  status = "Registration confirmed",
  illustration = true
}: {
  greeting: string;
  headline: string;
  lead: string;
  status?: string;
  illustration?: boolean;
}) {
  return row(
    `${statusPill(status, "done")}<h1 style="margin:20px 0 0;font-family:${FONT_SANS};color:${COLOR.ink};font-size:40px;line-height:44px;font-weight:600;letter-spacing:-0.03em;">${greeting}</h1><p style="margin:10px 0 0;font-family:${FONT_SANS};color:${COLOR.ink};font-size:22px;line-height:28px;font-weight:500;letter-spacing:-0.01em;">${headline}</p><p style="margin:14px 0 0;color:${COLOR.muted};font-family:${FONT_SANS};font-size:16px;line-height:24px;">${lead}</p>${illustration ? `<div style="margin:24px 0 0;">${heroIllustration()}</div>` : ""}`,
    "32px 32px 16px"
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
      `${statusPill("Needs attention", "attention")}<h1 style="margin:18px 0 12px;font-family:${FONT_SANS};color:${COLOR.ink};font-size:32px;line-height:36px;font-weight:600;letter-spacing:-0.02em;">${title}</h1>${paragraph(intro, "0")}`,
      "32px 32px 8px"
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
        `<th align="left" style="padding:10px 12px;word-break:break-word;background:${COLOR.sunken};color:${COLOR.muted};font-family:${FONT_SANS};font-size:14px;line-height:20px;font-weight:500;">${h}</th>`
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
