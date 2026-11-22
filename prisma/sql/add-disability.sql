-- Disability status and nature, for members who want it stated on their profile.
--
-- Every member, existing ones included, reads as "No disability" (the column default). That value
-- is the default and is never displayed; only an actual disability shows on a profile.
--
-- Adding a column with a constant default is metadata-only in Postgres 11+: no table rewrite, no
-- long lock, existing rows simply read the default. Safe to run more than once.
--
--   cd sathsangath_backend && set -a && . ./.env && set +a
--   psql "$DIRECT_URL" -f prisma/sql/add-disability.sql

BEGIN;

ALTER TABLE "Member"
  ADD COLUMN IF NOT EXISTS "disability"       TEXT NOT NULL DEFAULT 'No disability',
  ADD COLUMN IF NOT EXISTS "disabilityNature" TEXT NOT NULL DEFAULT '';

COMMIT;

-- Expect: every member under "No disability"
SELECT "disability", count(*) FROM "Member" GROUP BY 1 ORDER BY 2 DESC;
