-- Structured sibling counts, replacing the free-text `siblings` box.
--
-- The old column held whatever people typed — "1 elder sister (married)", "None", "02 Sisiter
-- married", and in two cases somebody's name. Only 60 of 908 members had filled it. It is replaced
-- by four counts, and the old values are cleared rather than parsed: that was the call, and the
-- pre-change dump in backups/ is the way back if it turns out to have been the wrong one.
--
-- Safe to run more than once.
--
--   cd sathsangath_backend && set -a && . ./.env && set +a
--   psql "$DIRECT_URL" -f prisma/sql/add-sibling-counts.sql

BEGIN;

-- NULL means "not answered". 0 means "no brothers" — a different statement, and what the old
-- "None" entries were trying to say.
ALTER TABLE "Member"
  ADD COLUMN IF NOT EXISTS "brothers"        INTEGER,
  ADD COLUMN IF NOT EXISTS "brothersMarried" INTEGER,
  ADD COLUMN IF NOT EXISTS "sisters"         INTEGER,
  ADD COLUMN IF NOT EXISTS "sistersMarried"  INTEGER;

-- The column itself stays one more release so a deploy in either order keeps working; the API
-- stops reading and writing it now.
UPDATE "Member" SET siblings = NULL WHERE siblings IS NOT NULL;

COMMIT;

-- Expect: brothers/brothersMarried/sisters/sistersMarried present, siblings_left = 0
SELECT
  count(*) FILTER (WHERE siblings IS NOT NULL) AS siblings_left,
  count(*) FILTER (WHERE brothers IS NOT NULL) AS brothers_set,
  count(*)                                     AS members
FROM "Member";
