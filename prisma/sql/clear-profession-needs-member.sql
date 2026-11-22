-- Clears the profession of the 20 members whose old value could not be mapped to one role.
--
-- These are the "Needs member" rows of profession-mapping.csv: the old value spanned several roles
-- ("Marketing / Sales / HR", "Management / Administration"), or was a medical value their education
-- contradicts, or free text nobody could read. Rather than leave a guess on their profile, the field
-- is emptied so the member is asked to pick their real role.
--
-- Each row is only cleared while it STILL holds the value the first migration gave it, so a member
-- who has already picked a role in the meantime is left alone. The original (pre-migration) values
-- are in profession_backup_20261121.
--
--   set -a && . ./.env && set +a
--   psql "$DIRECT_URL" -f prisma/sql/clear-profession-needs-member.sql
--
-- To undo:
--   UPDATE "Member" m SET profession = b.profession FROM profession_backup_20261121 b
--   WHERE m."profileCode" = b."profileCode" AND m.profession IS NULL
--     AND b."profileCode" IN (SELECT "profileCode" FROM profession_cleared_20261121);

BEGIN;

CREATE TABLE IF NOT EXISTS profession_cleared_20261121 (
  "profileCode" text PRIMARY KEY,
  "clearedAt"   timestamptz NOT NULL DEFAULT now()
);

WITH target("profileCode", expected) AS (VALUES
  ('SS-1399', 'Healthcare Professional (Other)'),
  ('SS-1923', 'Healthcare Professional (Other)'),
  ('SS-2000', 'Healthcare Professional (Other)'),
  ('SS-2006', 'Healthcare Professional (Other)'),
  ('SS-2015', 'Healthcare Professional (Other)'),
  ('SS-1930', 'Private / Corporate Employee (Other)'),
  ('SS-1945', 'Private / Corporate Employee (Other)'),
  ('SS-1951', 'Private / Corporate Employee (Other)'),
  ('SS-1956', 'Private / Corporate Employee (Other)'),
  ('SS-1978', 'Private / Corporate Employee (Other)'),
  ('SS-2047', 'Private / Corporate Employee (Other)'),
  ('SS-1722', 'Private / Corporate Employee (Other)'),
  ('SS-1936', 'Private / Corporate Employee (Other)'),
  ('SS-1948', 'Private / Corporate Employee (Other)'),
  ('SS-1961', 'Private / Corporate Employee (Other)'),
  ('SS-1974', 'Private / Corporate Employee (Other)'),
  ('SS-1993', 'Private / Corporate Employee (Other)'),
  ('SS-2012', 'Private / Corporate Employee (Other)'),
  ('SS-2032', 'Private / Corporate Employee (Other)'),
  ('SS-1913', 'Other')
), done AS (
  UPDATE "Member" m SET profession = NULL
  FROM target t
  WHERE m."profileCode" = t."profileCode" AND m.profession = t.expected
  RETURNING m."profileCode"
)
INSERT INTO profession_cleared_20261121 ("profileCode") SELECT "profileCode" FROM done ON CONFLICT DO NOTHING;

-- Expect 20
SELECT count(*) AS cleared FROM profession_cleared_20261121;

COMMIT;
