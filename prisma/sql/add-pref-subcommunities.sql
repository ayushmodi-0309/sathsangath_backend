-- Optional partner preference: preferred sub-communities, stored the way prefCommunities is
-- (a comma-separated string, "" meaning no preference).
--
-- Additive and defaulted, so existing members and older app builds / the website are unaffected:
-- a member who never sets it has "", and a client that does not send it leaves it alone.
--
-- Safe to run more than once.
--
--   cd sathsangath_backend && set -a && . ./.env && set +a
--   psql "$DIRECT_URL" -f prisma/sql/add-pref-subcommunities.sql

ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "prefSubCommunities" TEXT NOT NULL DEFAULT '';

-- Expect: prefSubCommunities present, filled = 0
SELECT count(*) AS members, count(*) FILTER (WHERE "prefSubCommunities" <> '') AS filled FROM "Member";
