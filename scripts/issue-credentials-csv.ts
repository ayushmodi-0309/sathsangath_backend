/**
 * Issues login passwords to members and writes a CSV the admin can hand out by message.
 *
 * Passwords are stored as bcrypt hashes, so an existing one can never be read back - the only way
 * to produce a shareable list is to set a fresh one. This mints the same kind of temp password the
 * approve / resend-credentials flows use (tempPassword(), bcrypt cost 11, mustChangePassword), but
 * sends no email or SMS: delivery is the admin's to do.
 *
 * Only ADMIN-entered profiles should ever get one. A self-signup member (source WEB / GOOGLE_FORM)
 * signs in through Firebase and never has an admin-issued temp password - see public.ts, which sets
 * mustChangePassword false for them. Giving one a password and that flag traps them on the
 * change-password screen (frame.tsx) asking for a temp password nobody sent, so --source defaults
 * to ADMIN and the script refuses to widen it without --allow-self-signup.
 *
 *   npx tsx scripts/issue-credentials-csv.ts                                  # report only, writes nothing
 *   npx tsx scripts/issue-credentials-csv.ts --apply --exclude-approved       # the usual run
 *   npx tsx scripts/issue-credentials-csv.ts --apply --keep-existing          # skip anyone who already has a password
 *   npx tsx scripts/issue-credentials-csv.ts --apply --out /path/to/file.csv
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db";
import { tempPassword } from "../src/lib/util";

/** Import placeholders: a member whose real mobile the sheet did not give. Cannot be messaged. */
const PLACEHOLDER_PHONE_RE = /^0{6}\d{4}$/;

const flag = (n: string) => process.argv.includes(n);
const opt = (n: string, d: string) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };

const csvCell = (v: string | null | undefined) => {
  const s = (v ?? "").trim();
  // Guard the spreadsheet against a leading =/+/-/@ being read as a formula, and keep the leading
  // zeros of a phone number, by quoting every cell that is not plainly safe.
  return /^[=+\-@]|[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function main() {
  const apply = flag("--apply");
  const source = opt("--source", "ADMIN");
  const excludeApproved = flag("--exclude-approved");
  const keepExisting = flag("--keep-existing");
  const out = opt("--out", path.join(process.cwd(), "member-credentials.csv"));

  if (source !== "ADMIN" && !flag("--allow-self-signup")) {
    throw new Error(`--source ${source} would include self-signup members, who must not get a temp password. Pass --allow-self-signup if you really mean it.`);
  }

  const members = await prisma.member.findMany({
    where: {
      source,
      ...(excludeApproved && { status: { not: "APPROVED" } }),
      ...(keepExisting && { passwordHash: null }),
    },
    select: { id: true, profileCode: true, fullName: true, phone: true, email: true, status: true, passwordHash: true },
    orderBy: { profileCode: "asc" },
  });

  const total = await prisma.member.count();
  console.log(`${total} members in all; ${members.length} match source=${source}${excludeApproved ? ", status != APPROVED" : ""}${keepExisting ? ", no password yet" : ""}.`);
  console.log(`${members.filter((m) => m.passwordHash).length} of them already have a password and will be given a new one.`);
  if (!apply) return console.log("\nDry run - nothing written. Re-run with --apply.");

  const rows: string[] = ["Profile ID,Name,Phone number,Email ID,Password,Status,Note"];
  let done = 0;
  for (const m of members) {
    const password = tempPassword();
    await prisma.member.update({
      where: { id: m.id },
      data: { passwordHash: await bcrypt.hash(password, 11), mustChangePassword: true },
    });
    if (++done % 50 === 0) console.log(`  ${done}/${members.length}`);
    const notes = [
      PLACEHOLDER_PHONE_RE.test(m.phone) ? "placeholder mobile - no real number on the sheet, log in with the Profile ID" : "",
      m.email ? "" : "no email",
      // A member waiting for review can sign in, fill in their bio data, add photos and browse.
      // Only liking and introductions wait for approval (requireApproved in lib/auth.ts).
      m.status === "APPROVED" ? "" : `status ${m.status} - can log in and browse; liking and introductions unlock on approval`,
    ].filter(Boolean);
    rows.push([m.profileCode, m.fullName, m.phone, m.email, password, m.status, notes.join("; ")].map(csvCell).join(","));
  }

  fs.writeFileSync(out, rows.join("\n") + "\n", "utf8");
  console.log(`\nSet ${done} passwords. Wrote ${rows.length - 1} rows to ${out}`);
}

main().finally(() => prisma.$disconnect());
