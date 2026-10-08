// The HTML layout for Fluta's emails: one card with a heading, a few short
// paragraphs, one button, and small print. Inline styles and tables only, so
// it renders the same in Gmail, Outlook, and phone mail apps. Every value is
// escaped: store and inviter names are typed by owners.

export interface EmailLayout {
  // Shown in the inbox list next to the subject.
  preview: string;
  heading: string;
  paragraphs: string[];
  button: { label: string; url: string };
  smallPrint: string[];
  footer: string;
}

const COLORS = {
  page: "#eef2f0",
  card: "#ffffff",
  border: "#e2e8e5",
  text: "#10201b",
  muted: "#5b6b66",
  brand: "#173c32",
  brandText: "#ffffff",
};
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderEmailHtml({ preview, heading, paragraphs, button, smallPrint, footer }: EmailLayout): string {
  const url = escapeHtml(button.url);
  const paragraph = (text: string) =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${COLORS.text};">${escapeHtml(text)}</p>`;
  const small = (text: string) =>
    `<p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:${COLORS.muted};">${escapeHtml(text)}</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.page};">
<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.page};font-family:${FONT};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
<tr><td style="padding:0 4px 16px;font-size:20px;font-weight:700;letter-spacing:-0.02em;color:${COLORS.brand};">fluta</td></tr>
<tr><td style="background:${COLORS.card};border:1px solid ${COLORS.border};border-radius:12px;padding:32px 28px;">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:700;color:${COLORS.text};">${escapeHtml(heading)}</h1>
${paragraphs.map(paragraph).join("\n")}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr>
<td style="border-radius:8px;background:${COLORS.brand};">
<a href="${url}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:600;color:${COLORS.brandText};text-decoration:none;border-radius:8px;">${escapeHtml(button.label)}</a>
</td></tr></table>
${smallPrint.map(small).join("\n")}
<p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:${COLORS.muted};">If the button doesn't work, copy this link into your browser:<br><a href="${url}" style="color:${COLORS.brand};word-break:break-all;">${url}</a></p>
</td></tr>
<tr><td style="padding:16px 4px 0;font-size:12px;line-height:1.5;color:${COLORS.muted};">${escapeHtml(footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
