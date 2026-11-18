-- Safety copy of community and subCommunity, taken before Community becomes a closed list.
--
-- "Community" is moving from free text to an admin-managed list, and existing values will be
-- re-mapped onto it. These two columns hold what each member had BEFORE that happens, so a
-- wrong mapping can be corrected from the row itself during the transition.
--
-- They are write-once backup columns: nothing in the API or either UI reads or writes them.
-- Once the transition is over they can be dropped.
--
-- The copy only fills rows where the backup column is still empty, so running this again after
-- the re-mapping does NOT overwrite the originals. Safe to run more than once.
--
--   cd sathsangath_backend && set -a && . ./.env && set +a
--   psql "$DIRECT_URL" -f prisma/sql/add-community-old.sql

BEGIN;

ALTER TABLE "Member"
  ADD COLUMN IF NOT EXISTS "communityOld"    TEXT,
  ADD COLUMN IF NOT EXISTS "subCommunityOld" TEXT;

UPDATE "Member" SET "communityOld"    = "community"    WHERE "communityOld"    IS NULL AND "community"    IS NOT NULL;
UPDATE "Member" SET "subCommunityOld" = "subCommunity" WHERE "subCommunityOld" IS NULL AND "subCommunity" IS NOT NULL;

COMMIT;

-- Expect: both *_differs counts = 0 right after the first run, and members = total rows.
SELECT
  count(*)                                                                AS members,
  count("communityOld")                                                   AS community_saved,
  count("subCommunityOld")                                                AS sub_saved,
  count(*) FILTER (WHERE "community"    IS DISTINCT FROM "communityOld")    AS community_differs,
  count(*) FILTER (WHERE "subCommunity" IS DISTINCT FROM "subCommunityOld") AS sub_differs
FROM "Member";
