-- "Not interested": a member privately marks a profile they do not want to see.
--
-- The marked profile is never told. The row hides the profile from the member's feed (and their
-- Received / Suggested lists); deleting it brings the profile back. Staff can read it from the
-- member's Activity tab.
--
-- Additive only (one new table), so it can be applied before or after the API that uses it.
-- Safe to run more than once.
--
--   cd sathsangath_backend && set -a && . ./.env && set +a
--   psql "$DIRECT_URL" -f prisma/sql/add-not-interested.sql
--
-- NOT YET APPLIED. A pre-change dump is in backups/sathsangath-*-20261119-181150.*

BEGIN;

CREATE TABLE IF NOT EXISTS "NotInterested" (
  "id"        TEXT        NOT NULL,
  "memberId"  TEXT        NOT NULL,
  "profileId" TEXT        NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotInterested_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NotInterested_memberId_profileId_key" ON "NotInterested"("memberId", "profileId");
CREATE INDEX IF NOT EXISTS "NotInterested_profileId_idx" ON "NotInterested"("profileId");

DO $$ BEGIN
  ALTER TABLE "NotInterested" ADD CONSTRAINT "NotInterested_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "NotInterested" ADD CONSTRAINT "NotInterested_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;

-- Expect: one row, 0 rows in the table
SELECT count(*) AS not_interested_rows FROM "NotInterested";
