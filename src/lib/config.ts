import "dotenv/config";
export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret",
  jwtExpires: process.env.JWT_EXPIRES_IN ?? "7d",
  // Always allow the deployed website; CORS_ORIGINS adds more (local dev, custom domains, previews).
  corsOrigins: ["https://sathsangath-frontend.vercel.app", ...(process.env.CORS_ORIGINS ?? "").split(",")]
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean),
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID ?? "sathsangath-9014",
  webhookSecret: process.env.INTAKE_WEBHOOK_SECRET ?? "",
  webLoginUrl: process.env.WEB_LOGIN_URL ?? "https://sathsangath-frontend.vercel.app/login",
  /** Registration needs an ID proof upload (Aadhaar, or green card / visa / passport for non-Indians). Set REQUIRE_ID_PROOF=false to make it optional. */
  requireIdProof: process.env.REQUIRE_ID_PROOF !== "false",
  mail: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true", // true only for port 465
    user: process.env.SMTP_USER ?? "",
    pass: (process.env.SMTP_PASS ?? "").replace(/\s+/g, ""), // Gmail shows app passwords in groups of four
    fromName: process.env.MAIL_FROM_NAME ?? "Sathsangath",
  },
  sms: {
    provider: (process.env.SMS_PROVIDER ?? "console").toLowerCase(), // "twilio" | "console"
    twilioSid: process.env.TWILIO_ACCOUNT_SID ?? "",
    twilioToken: process.env.TWILIO_AUTH_TOKEN ?? "",
    twilioFrom: process.env.TWILIO_FROM ?? "",
    twilioService: process.env.TWILIO_MESSAGING_SERVICE_SID ?? "",
  },
  brand: {
    name: "Sathsangath",
    tagline: "Connecting People. Respecting Values.",
    supportEmail: process.env.SUPPORT_EMAIL ?? "support@sathsangath.in",
    supportPhone: process.env.SUPPORT_PHONE ?? "+91 70160 40925",
    whatsapp: process.env.SUPPORT_WHATSAPP ?? "https://wa.me/917016040925",
  },
  storage: {
    provider: "r2", // "r2" | "s3" - change here when moving to AWS S3 (GCS needs a new driver)
    bucket: "sathsangath",
    region: "auto", // R2 uses "auto"; for AWS S3 use e.g. "ap-south-1"
    // Provider-neutral names win; the CLOUDFLARE_* names are accepted for R2.
    accessKeyId: process.env.STORAGE_ACCESS_KEY ?? process.env.CLOUDFLARE_ACCESS_KEY ?? "",
    secretAccessKey: process.env.STORAGE_SECRET_KEY ?? process.env.CLOUDFLARE_SECRET_KEY ?? "",
    endpoint: process.env.STORAGE_ENDPOINT ?? process.env.CLOUDFLARE_S3_API_ENDPOINT ?? undefined,
    urlTtl: Number(process.env.STORAGE_URL_TTL ?? 3600),
  },
};
