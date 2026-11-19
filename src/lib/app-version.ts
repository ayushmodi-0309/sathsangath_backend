import { z } from "zod";
import { prisma } from "./db";

/**
 * Mobile update gate. The app compares its own *build number* (the `+N` in pubspec's
 * `version: 1.1.2+10`, which is Android versionCode and iOS CFBundleVersion) against these values.
 *
 * `latest` is the newest build that is LIVE in the store. Only raise it once the store actually
 * serves that build; Apple/Google can lag behind an "approved" release by hours or days.
 * 0 means "no prompt". This is advisory only: nothing is blocked or rejected based on it.
 * Stored in SiteContent, so no schema change is needed.
 */
export const PLATFORMS = ["android", "ios"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const appVersionSchema = z.object({
  latest: z.number().int().min(0),
  storeUrl: z.string().trim().max(500).url().or(z.literal("")),
  message: z.string().trim().max(300),
});
export type AppVersion = z.infer<typeof appVersionSchema>;

const ANDROID_STORE = "https://play.google.com/store/apps/details?id=com.sathsangath.app";
const DEFAULTS: Record<Platform, AppVersion> = {
  android: { latest: 0, storeUrl: ANDROID_STORE, message: "" },
  ios: { latest: 0, storeUrl: "", message: "" },
};
const key = (p: Platform) => `app.version.${p}`;

export const isPlatform = (v: unknown): v is Platform => (PLATFORMS as readonly string[]).includes(String(v));

export async function getAppVersion(p: Platform): Promise<AppVersion> {
  // A failed lookup must never surface as an error: the update prompt is a nicety, so fall back to "no prompt".
  const row = await prisma.siteContent.findUnique({ where: { key: key(p) } }).catch(() => null);
  if (!row) return DEFAULTS[p];
  try {
    const parsed = appVersionSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? { ...DEFAULTS[p], ...parsed.data, storeUrl: parsed.data.storeUrl || DEFAULTS[p].storeUrl } : DEFAULTS[p];
  } catch { return DEFAULTS[p]; }
}

export async function setAppVersion(p: Platform, v: AppVersion): Promise<void> {
  const value = JSON.stringify(v);
  await prisma.siteContent.upsert({ where: { key: key(p) }, create: { key: key(p), value }, update: { value } });
}
