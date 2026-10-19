import * as admin from 'firebase-admin';

let _messaging: admin.messaging.Messaging | null = null;

function getMessaging(): admin.messaging.Messaging | null {
  if (_messaging) return _messaging;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const serviceAccount = JSON.parse(raw);
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    _messaging = admin.messaging();
    return _messaging;
  } catch (e) {
    console.error('[FCM] Firebase Admin init failed:', e);
    return null;
  }
}

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

export async function sendPush(
  token: string | null | undefined,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  if (!token) return;
  const msg = getMessaging();
  if (!msg) return;
  try {
    await msg.send({
      token,
      notification: { title, body },
      data,
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
    });
  } catch (e: any) {
    if (INVALID_TOKEN_CODES.has(e?.errorInfo?.code)) return;
    console.error('[FCM] sendPush error:', e?.errorInfo?.code ?? e);
  }
}
