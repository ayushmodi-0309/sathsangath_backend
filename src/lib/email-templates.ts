import { config } from "./config";
import { LOGO_CID } from "./mailer";

/**
 * Branded email layout (Brand Identity & Guidelines): Pearl Cream background, white card, Midnight Slate
 * headings and footer, Burnt Orange (prime colour) for the accent bar, buttons and step markers, Champagne Sand details box, Deep Charcoal text.
 * Table layout + inline styles because that is what Gmail, Outlook and phone mail apps render reliably.
 * Georgia stands in for Cormorant Garamond and Arial for Open Sans (web fonts are not supported in most email apps).
 */
const C = { page: "#F4EFE8", pearl: "#FFFFFF", card: "#F5EFE7", midnight: "#26364A", deep: "#1A2636", burnt: "#B85C4A", burntDeep: "#A84E3D", sand: "#E7C8A6", charcoal: "#211F20", muted: "#5B6470", line: "#E3D8CA", sandTint: "#FFFFFF" };
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "'Open Sans', Arial, Helvetica, sans-serif";

export const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const webBase = () => { try { return new URL(config.webLoginUrl).origin; } catch { return "https://www.sathsangath.in"; } };
const firstName = (full: string) => full.trim().split(/\s+/)[0] || "there";

type Row = [label: string, value: string, mono?: boolean];
export type Email = { subject: string; html: string; text: string };

/** Link that opens the Sathsangath app when it is installed and the website otherwise (see the frontend /open page). */
export const openUrl = (path: string) => `${webBase()}/open?to=${encodeURIComponent(path)}`;

function layout(o: { subject: string; preheader: string; title: string; greeting: string; paragraphs: string[]; box?: { heading?: string; rows?: Row[]; quote?: string }; cta?: { label: string; url: string; webUrl?: string }; steps?: string[]; note?: string; app?: boolean; textLines: string[] }): Email {
  const p = (t: string) => `<p style="margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:26px;color:${C.charcoal};">${t}</p>`;
  const rows = o.box?.rows?.length ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#FBF6EF" style="margin:8px 0 26px;background:#FBF6EF;border:1px solid ${C.sand};border-radius:14px;">
      <tr><td style="padding:20px 24px;">
        ${o.box.heading ? `<div style="font-family:${SANS};font-size:12px;letter-spacing:1.8px;text-transform:uppercase;font-weight:700;color:${C.burntDeep};padding-bottom:12px;">${esc(o.box.heading)}</div>` : ""}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${o.box.rows.map(([l, v, mono], k, all) => `<tr>
            <td style="padding:11px 0;${k < all.length - 1 ? `border-bottom:1px solid ${C.line};` : ""}font-family:${SANS};font-size:13px;color:${C.muted};width:40%;vertical-align:middle;">${esc(l)}</td>
            <td align="right" style="padding:11px 0;${k < all.length - 1 ? `border-bottom:1px solid ${C.line};` : ""}font-family:${mono ? "'Courier New', Consolas, monospace" : SANS};font-size:${mono ? 17 : 15}px;font-weight:700;color:${C.midnight};letter-spacing:${mono ? "0.6px" : "0"};word-break:break-all;vertical-align:middle;">${esc(v)}</td></tr>`).join("")}
        </table>
      </td></tr>
    </table>` : "";
  const quote = o.box?.quote ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr>
      <td bgcolor="#FBF6EF" style="border-left:4px solid ${C.burnt};background:#FBF6EF;padding:16px 20px;font-family:${SANS};font-size:15px;line-height:24px;color:${C.charcoal};border-radius:0 12px 12px 0;">${esc(o.box.quote)}</td></tr></table>` : "";
  const steps = o.steps?.length ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 24px;">
      ${o.steps.map((s, i) => `<tr>
        <td width="40" valign="top" style="padding:8px 0;"><div style="width:28px;height:28px;border-radius:14px;background:${C.burnt};color:#FFFFFF;font-family:${SANS};font-size:13px;font-weight:700;line-height:28px;text-align:center;">${i + 1}</div></td>
        <td valign="top" style="padding:8px 0 8px 4px;font-family:${SANS};font-size:15px;line-height:24px;color:${C.charcoal};">${s}</td></tr>`).join("")}
    </table>` : "";
  const cta = o.cta ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 12px;"><tr>
      <td align="center" bgcolor="${C.burnt}" style="border-radius:12px;">
        <a href="${esc(o.cta.url)}" target="_blank" style="display:block;padding:16px 24px;font-family:${SANS};font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:12px;">${esc(o.cta.label)}</a>
      </td></tr></table>
    <p style="margin:0 0 26px;text-align:center;font-family:${SANS};font-size:12px;line-height:20px;color:${C.muted};">Opens the Sathsangath app if you have it, otherwise the website.${o.cta.webUrl ? ` <a href="${esc(o.cta.webUrl)}" target="_blank" style="color:${C.burntDeep};text-decoration:underline;">Open the website instead</a>` : ""}</p>` : "";
  const note = o.note ? `<p style="margin:0 0 8px;padding-top:4px;font-family:${SANS};font-size:13px;line-height:21px;color:${C.muted};">${o.note}</p>` : "";
  const app = o.app && config.brand.playStore ? `
    <tr><td style="padding:0 38px 30px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.line};"><tr>
        <td style="padding-top:20px;font-family:${SANS};font-size:14px;line-height:22px;color:${C.charcoal};"><strong style="color:${C.midnight};">Prefer your phone?</strong><br>Get the Sathsangath app to see matches on the go.</td>
        <td align="right" valign="bottom" style="padding-top:20px;"><a href="${esc(config.brand.playStore)}" target="_blank" style="display:inline-block;padding:10px 18px;border:1px solid ${C.midnight};border-radius:10px;font-family:${SANS};font-size:13px;font-weight:700;color:${C.midnight};text-decoration:none;white-space:nowrap;">Get it on Google Play</a></td>
      </tr></table>
    </td></tr>` : "";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(o.subject)}</title></head>
<body style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.page};">${esc(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.page}" style="background:${C.page};"><tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;">
    <tr><td align="center" style="padding:4px 0 20px;">
      <a href="${esc(webBase())}" target="_blank"><img src="cid:${LOGO_CID}" alt="Sathsangath" width="150" style="display:block;border:0;outline:none;width:150px;height:auto;border-radius:14px;"></a>
    </td></tr>
    <tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border-radius:18px;border:1px solid ${C.line};overflow:hidden;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td height="5" style="background:${C.burnt};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:34px 38px 10px;">
          <h1 style="margin:0 0 20px;font-family:${SERIF};font-size:30px;line-height:36px;font-weight:600;color:${C.midnight};">${esc(o.title)}</h1>
          <p style="margin:0 0 14px;font-family:${SANS};font-size:16px;line-height:26px;font-weight:600;color:${C.midnight};">${esc(o.greeting)}</p>
          ${o.paragraphs.map(p).join("")}
          ${rows}${quote}${steps}${cta}${note}
        </td></tr>
        <tr><td style="padding:6px 38px 28px;">
          <p style="margin:0;font-family:${SANS};font-size:15px;line-height:24px;color:${C.charcoal};">With warm regards,<br><strong style="color:${C.midnight};">Team Sathsangath</strong></p>
        </td></tr>
        ${app}
      </table>
    </td></tr>
    <tr><td style="padding:20px 0 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.midnight}" style="background:${C.midnight};border-radius:16px;"><tr><td align="center" style="padding:24px 22px;">
        <div style="font-family:${SERIF};font-size:19px;font-style:italic;color:${C.sand};margin-bottom:12px;">${esc(config.brand.tagline)}</div>
        <div style="font-family:${SANS};font-size:13px;line-height:24px;color:#FFFFFF;">
          <a href="tel:${esc(config.brand.supportPhone.replace(/\s/g, ""))}" style="color:#FFFFFF;text-decoration:none;">${esc(config.brand.supportPhone)}</a>
          &nbsp;&middot;&nbsp; <a href="mailto:${esc(config.brand.supportEmail)}" style="color:#FFFFFF;text-decoration:none;">${esc(config.brand.supportEmail)}</a>
          &nbsp;&middot;&nbsp; <a href="${esc(config.brand.whatsapp)}" style="color:${C.sand};text-decoration:none;font-weight:700;">WhatsApp us</a>
        </div>
        <div style="font-family:${SANS};font-size:11px;line-height:18px;color:#B7C0CC;margin-top:14px;">Your contact details are shared only after both members show interest and our team approves.<br>You are receiving this email because of your Sathsangath bio data.</div>
      </td></tr></table>
      <div style="text-align:center;font-family:${SANS};font-size:11px;color:${C.muted};padding:14px 0 4px;">&copy; ${new Date().getFullYear()} Sathsangath Matrimonial Services &middot; <a href="${esc(webBase())}" style="color:${C.muted};">www.sathsangath.in</a></div>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  const text = [o.greeting, "", ...o.paragraphs.map((x) => x.replace(/<[^>]+>/g, "")), "",
    ...(o.box?.rows ?? []).map(([l, v]) => `${l}: ${v}`), ...(o.box?.quote ? [`"${o.box.quote}"`] : []),
    ...(o.steps ?? []).map((s, i) => `${i + 1}. ${s.replace(/<[^>]+>/g, "")}`), ...(o.cta ? ["", `${o.cta.label}: ${o.cta.webUrl ?? o.cta.url}`] : []),
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
    cta: { label: "Log in to Sathsangath", url: openUrl("/login"), webUrl: config.webLoginUrl }, app: true,
    note: "For your safety you will be asked to choose a new password the first time you log in. Please do not share this password with anyone. Our team will never ask you for it.",
  });
}

/** Self-serve password reset: a one-time link, valid for a short while. */
export function resetPasswordEmail(m: M, url: string, minutes: number): Email {
  return layout({
    subject: "Reset your Sathsangath password", preheader: "A link to choose a new password for your Sathsangath login.",
    title: "Reset your password", greeting: `Namaste ${firstName(m.fullName)},`, textLines: [],
    paragraphs: [`We received a request to reset the password for your Sathsangath login (Member ID ${esc(m.profileCode)}). Choose a new password with the button below. The link works once and expires in ${minutes} minutes.`],
    cta: { label: "Choose a new password", url },
    note: "If you did not ask for this, you can ignore this email - your current password still works. Our team will never ask you for your password.",
  });
}

export function approvedEmail(m: M): Email {
  return layout({
    subject: "Your Sathsangath bio data is approved", preheader: "You can now like profiles and request introductions.",
    title: "Your bio data is approved", greeting: `Namaste ${firstName(m.fullName)},`, textLines: [],
    paragraphs: ["Our team has reviewed and approved your bio data. Log in with the email you signed up with to see your matches, like profiles and request introductions."],
    box: { heading: "Your reference", rows: [["Member ID", m.profileCode, true]] },
    cta: { label: "Log in to Sathsangath", url: openUrl("/login"), webUrl: config.webLoginUrl }, app: true,
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
    subject: "It's a match! You both liked each other", preheader: `${other.profileCode} liked your profile as well.`,
    title: "It's a mutual match", greeting: `Namaste ${firstName(m.fullName)},`, textLines: [],
    paragraphs: [`Wonderful news. <strong>${esc(other.profileCode)}</strong> has liked your profile as well. You can now view each other's profile properly.`, "If you would like to take this forward, open the profile and ask us for an introduction. Our team will speak to both families and arrange everything."],
    cta: { label: "View their profile", url: openUrl(`/member/profile/${other.id}`), webUrl: `${webBase()}/member/profile/${other.id}` },
    note: "Phone numbers and email addresses stay private. Only our team shares contact details, when both families are ready.",
  });
}

export function suggestionEmail(m: M, other: { id: string; profileCode: string }, note?: string | null): Email {
  return layout({
    subject: "Sathsangath has suggested a profile for you", preheader: `Our team has hand-picked ${other.profileCode} for you.`,
    title: "A profile suggested for you", greeting: `Namaste ${firstName(m.fullName)},`, textLines: [],
    paragraphs: [`Our team has personally looked at your preferences and hand-picked a profile we feel could be a good match: <strong>${esc(other.profileCode)}</strong>.`, "Have a look, and if you like it, tap the heart. We will then arrange the introduction with both families."],
    ...(note ? { box: { quote: note } } : {}),
    cta: { label: "View the suggested profile", url: openUrl(`/member/profile/${other.id}`), webUrl: `${webBase()}/member/profile/${other.id}` },
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
  reset: (url: string, minutes: number) => `Sathsangath: reset your password with this link (valid ${minutes} minutes): ${url} - if you did not ask for it, ignore this message.`,
  mutual: (other: { profileCode: string }) => `Sathsangath: it's a match! ${other.profileCode} liked your profile too. Log in to view their profile: ${config.webLoginUrl}`,
};
