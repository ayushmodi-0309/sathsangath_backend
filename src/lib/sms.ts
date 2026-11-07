import { config } from "./config";
import type { Delivery } from "./mailer";

/** Stored numbers are 10-digit Indian numbers or +<country code>... (see lib/phone.ts); providers need +E.164. */
export function toE164(phone: string) {
  const t = phone.trim();
  if (t.startsWith("+")) return `+${t.replace(/\D/g, "")}`;
  const d = t.replace(/\D/g, "");
  return d.length === 10 ? `+91${d}` : `+${d}`;
}

export const smsConfigured = () =>
  config.sms.provider === "twilio" && !!(config.sms.twilioSid && config.sms.twilioToken && (config.sms.twilioFrom || config.sms.twilioService));

/**
 * Sends one SMS. Provider "twilio" sends for real once the TWILIO_* values are set; otherwise (console mode)
 * the message is only printed in the server log so development works without an account.
 * Never throws: returns "sent", "not-configured" (console mode) or "failed".
 */
export async function sendSms(phone: string, text: string): Promise<Delivery> {
  const to = toE164(phone);
  if (!smsConfigured()) {
    console.log(`[SMS console mode -> ${to}] ${text}`);
    return "not-configured";
  }
  try {
    const body = new URLSearchParams({ To: to, Body: text });
    if (config.sms.twilioService) body.set("MessagingServiceSid", config.sms.twilioService); else body.set("From", config.sms.twilioFrom);
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.sms.twilioSid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${config.sms.twilioSid}:${config.sms.twilioToken}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body, signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) { console.error(`[SMS failed -> ${to}] ${res.status} ${(await res.text()).slice(0, 300)}`); return "failed"; }
    return "sent";
  } catch (e) {
    console.error(`[SMS failed -> ${to}] ${(e as Error).message}`);
    return "failed";
  }
}
