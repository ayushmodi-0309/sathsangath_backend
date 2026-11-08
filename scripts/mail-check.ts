/**
 * Email setup check.
 *   npm run mail:check                 -> verifies the SMTP login and writes previews to ./email-previews
 *   npm run mail:check -- you@x.com    -> also sends one real test email (the "your login" template) to that address
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { mailConfigured, sendMail, verifyMail, LOGO_CID } from "../src/lib/mailer";
import { smsConfigured } from "../src/lib/sms";
import { correctionEmail, credentialsEmail, mutualEmail, receivedEmail, rejectionEmail } from "../src/lib/email-templates";
import { LOGO_WHITE_PNG_BASE64 as LOGO_PNG_BASE64 } from "../src/assets/email/logo-white-data";

(async () => {
  const demo = { fullName: "Aarav Mehta", profileCode: "SS-1001", phone: "9000000001", email: "aarav@example.com" };
  const previews = {
    "1-credentials": credentialsEmail(demo, "Kp7mQx2nWz@1"),
    "2-received": receivedEmail(demo),
    "3-correction": correctionEmail(demo, "Please add a clearer photo and your father's occupation."),
    "4-rejection": rejectionEmail(demo),
    "5-mutual-match": mutualEmail(demo, { id: "abc123", profileCode: "SS-1002", fullName: "Riya Shah" }),
  };
  const dir = path.resolve("email-previews"); fs.mkdirSync(dir, { recursive: true });
  const dataUri = `data:image/png;base64,${LOGO_PNG_BASE64}`;
  for (const [name, e] of Object.entries(previews)) fs.writeFileSync(path.join(dir, `${name}.html`), e.html.replace(`cid:${LOGO_CID}`, dataUri)); // preview only: cid -> inline data
  console.log(`Wrote ${Object.keys(previews).length} previews to ${dir}`);

  console.log(`Email configured: ${mailConfigured()}   SMS (Twilio) configured: ${smsConfigured()}`);
  if (!mailConfigured()) { console.log("Set SMTP_HOST, SMTP_USER and SMTP_PASS in .env"); return; }
  await verifyMail();
  console.log("SMTP login OK (smtp host accepted the username and app password)");

  const to = process.argv[2];
  if (to) {
    const e = previews["1-credentials"];
    const r = await sendMail({ to, subject: `[Test] ${e.subject}`, html: e.html, text: e.text });
    console.log(`Test email to ${to}: ${r}`);
  } else console.log("No address given, so no test email was sent. Add one to send: npm run mail:check -- you@example.com");
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
