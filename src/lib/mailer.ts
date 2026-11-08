import nodemailer, { type Transporter } from "nodemailer";
import { config } from "./config";
import { LOGO_WHITE_PNG_BASE64 as LOGO_PNG_BASE64 } from "../assets/email/logo-white-data";

export type Delivery = "sent" | "failed" | "no-address" | "not-configured";
export const LOGO_CID = "sathsangath-logo";

let transporter: Transporter | undefined;
export const mailConfigured = () => !!(config.mail.host && config.mail.user && config.mail.pass);

function getTransporter() {
  return (transporter ??= nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure, // false on 587: the connection is upgraded with STARTTLS
    requireTLS: !config.mail.secure,
    auth: { user: config.mail.user, pass: config.mail.pass },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
  }));
}

/** Checks the SMTP login without sending anything. Used by the setup check script. */
export async function verifyMail() { await getTransporter().verify(); }

/**
 * Sends one HTML email with the brand logo embedded (cid image, so it shows even when the client blocks remote images).
 * Never throws: callers get "sent", "no-address" (nothing on file), "not-configured" (no SMTP credentials)
 * or "failed" (logged). The reason is reported as-is so the admin screen can say why nothing went out.
 */
export async function sendMail(opts: { to: string | null | undefined; subject: string; html: string; text: string }): Promise<Delivery> {
  if (!opts.to) return "no-address";
  if (!mailConfigured()) { console.log(`[EMAIL not configured -> ${opts.to}] ${opts.subject}`); return "not-configured"; }
  try {
    await getTransporter().sendMail({
      from: { name: config.mail.fromName, address: config.mail.user },
      to: opts.to, subject: opts.subject, html: opts.html, text: opts.text,
      attachments: [{ filename: "sathsangath-logo.png", content: Buffer.from(LOGO_PNG_BASE64, "base64"), cid: LOGO_CID, contentType: "image/png", contentDisposition: "inline" }],
    });
    return "sent";
  } catch (e) {
    console.error(`[EMAIL failed -> ${opts.to}] ${(e as Error).message}`);
    return "failed";
  }
}
