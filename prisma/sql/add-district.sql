-- The district a member's city sits in, for the unified Country → State → District → City/Town
-- place of living.
--
-- Additive and nullable, so it can be applied before the API that writes it: every read tolerates
-- NULL, and rolling the API back leaves the column harmlessly empty. `city` is deliberately left
-- alone — it keeps meaning the town, which is often smaller than the district.
--
-- Backfilling the existing rows is a separate, reviewable step:
--
--   npm run locations:normalize            # report only
--   npm run locations:normalize -- --apply
--
-- Safe to run more than once.
--
--   cd sathsangath_backend && set -a && . ./.env && set +a
--   psql "$DIRECT_URL" -f prisma/sql/add-district.sql

BEGIN;

ALTER TABLE "Member" ADD COLUMN IF NOT EXISTS "district" TEXT;

COMMIT;

-- Expect: district_set = 0 before the normalise script runs, members unchanged.
SELECT
  count(*) FILTER (WHERE "district" IS NOT NULL) AS district_set,
  count(*) FILTER (WHERE "city"     IS NOT NULL) AS city_set,
  count(*)                                       AS members
FROM "Member";
