import { config } from "./config";
import { LOGO_CID } from "./mailer";

/**
 * Branded email layout (Brand Identity & Guidelines): Pearl Cream background, white card, Midnight Slate
 * headings and footer, Burnt Orange (prime colour) for the accent bar, buttons and step markers, Champagne Sand details box, Deep Charcoal text.
 * Table layout + inline styles because that is what Gmail, Outlook and phone mail apps render reliably.
 * Georgia stands in for Cormorant Garamond and Arial for Open Sans (web fonts are not supported in most email apps).
 */
const C = { pearl: "#FFFFFF", card: "#F5EFE7", midnight: "#26364A", deep: "#1A2636", burnt: "#B85C4A", burntDeep: "#A84E3D", sand: "#E7C8A6", charcoal: "#211F20", muted: "#5B6470", line: "#E3D8CA", sandTint: "#FFFFFF" };
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "'Open Sans', Arial, Helvetica, sans-serif";

export const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const webBase = () => { try { return new URL(config.webLoginUrl).origin; } catch { return "http://localhost:3100"; } };
const firstName = (full: string) => full.trim().split(/\s+/)[0] || "there";

type Row = [label: string, value: string, mono?: boolean];
export type Email = { subject: string; html: string; text: string };

function layout(o: { subject: string; preheader: string; title: string; greeting: string; paragraphs: string[]; box?: { heading?: string; rows?: Row[]; quote?: string }; cta?: { label: string; url: string }; steps?: string[]; note?: string; textLines: string[] }): Email {
  const p = (t: string) => `<p style="margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:26px;color:${C.charcoal};">${t}</p>`;
  const rows = o.box?.rows?.length ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;background:${C.sandTint};border:1px solid ${C.sand};border-radius:12px;">
      <tr><td style="padding:18px 22px;">
        ${o.box.heading ? `<div style="font-family:${SANS};font-size:12px;letter-spacing:1.6px;text-transform:uppercase;font-weight:700;color:${C.burntDeep};margin-bottom:10px;">${esc(o.box.heading)}</div>` : ""}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${o.box.rows.map(([l, v, mono]) => `<tr>
            <td style="padding:6px 0;font-family:${SANS};font-size:14px;color:${C.muted};width:42%;vertical-align:top;">${esc(l)}</td>
            <td style="padding:6px 0;font-family:${mono ? "'Courier New', Consolas, monospace" : SANS};font-size:${mono ? 17 : 15}px;font-weight:700;color:${C.midnight};letter-spacing:${mono ? "0.5px" : "0"};word-break:break-all;">${esc(v)}</td></tr>`).join("")}
        </table>
      </td></tr>
    </table>` : "";
  const quote = o.box?.quote ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr>
      <td style="border-left:4px solid ${C.burnt};background:${C.sandTint};padding:14px 18px;font-family:${SANS};font-size:15px;line-height:24px;color:${C.charcoal};border-radius:0 10px 10px 0;">${esc(o.box.quote)}</td></tr></table>` : "";
  const steps = o.steps?.length ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 24px;">
      ${o.steps.map((s, i) => `<tr>
        <td width="36" valign="top" style="padding:6px 0;"><div style="width:26px;height:26px;border-radius:13px;background:${C.burnt};color:#FFFFFF;font-family:${SANS};font-size:13px;font-weight:700;line-height:26px;text-align:center;">${i + 1}</div></td>
        <td valign="top" style="padding:6px 0 6px 4px;font-family:${SANS};font-size:15px;line-height:24px;color:${C.charcoal};">${s}</td></tr>`).join("")}
    </table>` : "";
  const cta = o.cta ? `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 26px;"><tr>
      <td align="center" bgcolor="${C.burnt}" style="border-radius:999px;">
        <a href="${esc(o.cta.url)}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:${SANS};font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px;">${esc(o.cta.label)}</a>
      </td></tr></table>` : "";
  const note = o.note ? `<p style="margin:0 0 8px;font-family:${SANS};font-size:13px;line-height:21px;color:${C.muted};">${o.note}</p>` : "";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(o.subject)}</title></head>
<body style="margin:0;padding:0;background:${C.pearl};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.pearl};">${esc(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.pearl};"><tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;">
    <tr><td align="center" style="padding:6px 0 22px;">
      <a href="${esc(webBase())}" target="_blank"><img src="cid:${LOGO_CID}" alt="Sathsangath" width="150" style="display:block;border:0;outline:none;width:150px;height:auto;"></a>
    </td></tr>
    <tr><td style="background:${C.card};border-radius:20px;border:1px solid ${C.line};overflow:hidden;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td height="6" style="background:${C.burnt};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:36px 38px 14px;">
          <h1 style="margin:0 0 18px;font-family:${SERIF};font-size:32px;line-height:38px;font-weight:600;color:${C.midnight};">${esc(o.title)}</h1>
          <p style="margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:26px;color:${C.charcoal};">${esc(o.greeting)}</p>
          ${o.paragraphs.map(p).join("")}
          ${rows}${quote}${steps}${cta}${note}
        </td></tr>
        <tr><td style="padding:0 38px 34px;">
          <p style="margin:0;font-family:${SANS};font-size:15px;line-height:24px;color:${C.charcoal};">With warm regards,<br><strong style="color:${C.midnight};">Team Sathsangath</strong></p>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:22px 6px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.midnight};border-radius:16px;"><tr><td align="center" style="padding:24px 22px;">
        <div style="font-family:${SERIF};font-size:20px;font-style:italic;color:${C.sand};margin-bottom:10px;">${esc(config.brand.tagline)}</div>
        <div style="font-family:${SANS};font-size:13px;line-height:22px;color:${C.pearl};">
          <a href="tel:${esc(config.brand.supportPhone.replace(/\s/g, ""))}" style="color:${C.pearl};text-decoration:none;">${esc(config.brand.supportPhone)}</a>
          &nbsp;&middot;&nbsp; <a href="mailto:${esc(config.brand.supportEmail)}" style="color:${C.pearl};text-decoration:none;">${esc(config.brand.supportEmail)}</a>
          &nbsp;&middot;&nbsp; <a href="${esc(config.brand.whatsapp)}" style="color:${C.sand};text-decoration:none;font-weight:700;">WhatsApp us</a>
        </div>
        <div style="font-family:${SANS};font-size:11px;line-height:18px;color:#B7C0CC;margin-top:14px;">Your name and contact details are never shown to other members.<br>You are receiving this email because of your Sathsangath bio data.</div>
      </td></tr></table>
      <div style="text-align:center;font-family:${SANS};font-size:11px;color:${C.muted};padding:14px 0 4px;">&copy; ${new Date().getFullYear()} Sathsangath Matrimonial Services</div>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  const text = [o.greeting, "", ...o.paragraphs.map((x) => x.replace(/<[^>]+>/g, "")), "",
    ...(o.box?.rows ?? []).map(([l, v]) => `${l}: ${v}`), ...(o.box?.quote ? [`"${o.box.quote}"`] : []),
    ...(o.steps ?? []).map((s, i) => `${i + 1}. ${s.replace(/<[^>]+>/g, "")}`), ...(o.cta ? ["", `${o.cta.label}: ${o.cta.url}`] : []),
    ...(o.note ? ["", o.note.replace(/<[^>]+>/g, "")] : []), "", "With warm regards,", "Team Sathsangath", "",
    config.brand.tagline, `${config.brand.supportPhone} | ${config.brand.supportEmail} | ${config.brand.whatsapp}`, ...o.textLines].join("\n");
  return { subject: o.subject, html, text };
}

type M = { fullName: string; profileCode: string; phone: string; email?: string | null };

export function credentialsEmail(m: M, password: string): Email {
  return layout({
    subject: "Your Sathsangath login is ready", preheader: "Your bio data is approved. Here are your login details.",
    title: "Your bio data is approved", greeting: `Namaste ${firstName(m.fullName)},`, textLines: [],
    paragraphs: ["Thank you for trusting Sathsangath. Our team has reviewed your bio data and approved it. You can now log in to see the matches we have chosen for you."],
    box: { heading: "Your login details", rows: [["Member ID", m.profileCode, true], ["Or mobile number", m.phone, true], ["Temporary password", password, true]] },
    cta: { label: "Log in to Sathsangath", url: config.webLoginUrl },
    note: "For your safety you will be asked to choose a new password the first time you log in. Please do not share this password with anyone. Our team will never ask you for it.",
  });
}

export function approvedEmail(m: M): Email {
  return layout({
    subject: "Your Sathsangath bio data is approved", preheader: "You can now like profiles and request introductions.",
    title: "Your bio data is approved", greeting: `Namaste ${firstName(m.fullName)},`, textLines: [],
    paragraphs: ["Our team has reviewed and approved your bio data. Log in with the email you signed up with to see your matches, like profiles and request introductions."],
    box: { heading: "Your reference", rows: [["Member ID", m.profileCode, true]] },
    cta: { label: "Log in to Sathsangath", url: config.webLoginUrl },
  });
}

export function correctionEmail(m: M, note: string): Email {
  return layout({
    subject: "A small update is needed on your Sathsangath bio data", preheader: "Our team needs one small correction before we can go ahead.",
    title: "A small update is needed", greeting: `Namaste ${firstName(m.fullName)},`, textLines: [],
    paragraphs: ["Thank you for sharing your bio data. Before we can approve it, our team needs a small correction:"],
    box: { quote: note },
    cta: { label: "Message us on WhatsApp", url: config.brand.whatsapp },
    note: `You can also call us on ${esc(config.brand.supportPhone)} or reply to this email, and we will update it for you.`,
  });
}

export function rejectionEmail(m: M): Email {
  return layout({
    subject: "An update on your Sathsangath bio data", preheader: "We are unable to take your bio data forward at this time.",
    title: "An update on your bio data", greeting: `Namaste ${firstName(m.fullName)},`, textLines: [],
    paragraphs: ["Thank you for your interest in Sathsangath and for the time you took to share your details.", "After careful review, we are unable to take your bio data forward at this time. We are sorry we could not help on this occasion, and we wish you and your family all the very best."],
    cta: { label: "Talk to our team", url: config.brand.whatsapp },
    note: "If you would like to understand more or share an updated bio data, please get in touch. We are always happy to speak.",
  });
}

export function receivedEmail(m: M): Email {
  return layout({
    subject: "We have received your bio data", preheader: "Thank you. Our team will review it within 2 to 3 working days.",
    title: "We have received your bio data", greeting: `Namaste ${firstName(m.fullName)},`, textLines: [],
    paragraphs: ["Thank you for sharing your family's details with Sathsangath. Your bio data has reached our team safely."],
    box: { heading: "Your reference", rows: [["Reference number", m.profileCode, true]] },
    steps: ["Our team <strong>reviews your bio data</strong> personally, usually within 2 to 3 working days.", "Once approved, you receive your <strong>private login</strong> by email and SMS.", "You see the matches chosen for you, and we <strong>arrange every introduction</strong> with care."],
    note: "Please keep your reference number handy if you contact us.",
  });
}

export function mutualEmail(m: M, other: { profileCode: string; fullName: string; id: string }): Email {
  return layout({
    subject: "It's a match! You both liked each other", preheader: `${firstName(other.fullName)} (${other.profileCode}) liked your profile as well.`,
    title: "It's a mutual match", greeting: `Namaste ${firstName(m.fullName)},`, textLines: [],
    paragraphs: [`Wonderful news. <strong>${esc(firstName(other.fullName))} (${esc(other.profileCode)})</strong> has liked your profile as well. You can now view each other's profile properly.`, "If you would like to take this forward, open the profile and ask us for an introduction. Our team will speak to both families and arrange everything."],
    cta: { label: "View their profile", url: `${webBase()}/member/profile/${other.id}` },
    note: "Phone numbers and email addresses stay private. Only our team shares contact details, when both families are ready.",
  });
}

export function suggestionEmail(m: M, other: { id: string; profileCode: string }, note?: string | null): Email {
  return layout({
    subject: "Sathsangath has suggested a profile for you", preheader: `Our team has hand-picked ${other.profileCode} for you.`,
    title: "A profile suggested for you", greeting: `Namaste ${firstName(m.fullName)},`, textLines: [],
    paragraphs: [`Our team has personally looked at your preferences and hand-picked a profile we feel could be a good match: <strong>${esc(other.profileCode)}</strong>.`, "Have a look, and if you like it, tap the heart. We will then arrange the introduction with both families."],
    ...(note ? { box: { quote: note } } : {}),
    cta: { label: "View the suggested profile", url: `${webBase()}/member/profile/${other.id}` },
    note: "This is a suggestion from our team. Nothing is shared with the other family until you both agree.",
  });
}

/** Short SMS versions (kept under ~160 characters where possible). */
export const sms = {
  credentials: (m: M, password: string) => `Sathsangath: your bio data is approved. Login ${config.webLoginUrl} | ID ${m.profileCode} | Temp password ${password}. Change it on first login.`,
  correction: (note: string) => `Sathsangath: we need a small correction in your bio data: ${note.slice(0, 90)}. Please WhatsApp us ${config.brand.supportPhone}.`,
  rejection: () => `Sathsangath: we are unable to take your bio data forward at this time. Please WhatsApp us on ${config.brand.supportPhone} for details.`,
  approved: (m: M) => `Sathsangath: your bio data is approved (ID ${m.profileCode}). Log in with your email at ${config.webLoginUrl} to like profiles.`,
  received: (m: M) => `Sathsangath: we have received your bio data (ref ${m.profileCode}). Our team will review it in 2-3 working days.`,
  suggestion: (other: { profileCode: string }) => `Sathsangath: our team has suggested a profile for you (${other.profileCode}). Log in to view it: ${config.webLoginUrl}`,
  mutual: (other: { profileCode: string }) => `Sathsangath: it's a match! ${other.profileCode} liked your profile too. Log in to view their profile: ${config.webLoginUrl}`,
};
