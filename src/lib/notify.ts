import { sendMail, type Delivery } from "./mailer";
import { sendSms } from "./sms";
import { approvedEmail, correctionEmail, credentialsEmail, mutualEmail, receivedEmail, rejectionEmail, suggestionEmail, sms, type Email } from "./email-templates";

/**
 * High-level notifications. Each one sends an email (branded template) and an SMS to the member,
 * never throws, and reports what happened so the admin screen can say so honestly.
 */
export type NotifyResult = { email: Delivery; sms: Delivery };
type M = { fullName: string; profileCode: string; phone: string; email?: string | null };

async function both(m: M, mail: Email, text: string): Promise<NotifyResult> {
  const [email, smsResult] = await Promise.all([
    sendMail({ to: m.email, subject: mail.subject, html: mail.html, text: mail.text }),
    sendSms(m.phone, text),
  ]);
  return { email, sms: smsResult };
}

export const sendCredentials = (m: M, password: string) => both(m, credentialsEmail(m, password), sms.credentials(m, password));
export const sendApproved = (m: M) => both(m, approvedEmail(m), sms.approved(m));
export const sendCorrection = (m: M, note: string) => both(m, correctionEmail(m, note), sms.correction(note));
export const sendRejection = (m: M) => both(m, rejectionEmail(m), sms.rejection());
export const sendSubmissionReceived = (m: M) => both(m, receivedEmail(m), sms.received(m));
export const sendMutualMatch = (m: M, other: { id: string; profileCode: string; fullName: string }) => both(m, mutualEmail(m, other), sms.mutual(other));

export const sendSuggestion = (m: M, other: { id: string; profileCode: string }, note?: string | null) => both(m, suggestionEmail(m, other, note), sms.suggestion(other));
