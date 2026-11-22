-- Clears the "preferred occupation" of the 29 members whose preference still holds values from the old
-- profession list ("Engineer", "Private Job", "Doctor / Medical"...), so they are asked to set it again.
--
-- Why clear rather than map: an old value in a preference was a choice, not a label. "Engineer" meant
-- any engineer, which is six roles now, and "Doctor / Medical" could mean doctors or all healthcare.
-- Only 29 of ~1,000 members have set one, so asking again is cheaper than guessing.
--
-- Members whose preference holds only roles from the new list are left alone.
--
-- Safe to re-run, and safe against edits made since: a row is only cleared while it STILL holds the
-- value read at the time of writing. The original value of every cleared row is kept in
-- pref_occupation_backup_20261121.
--
--   set -a && . ./.env && set +a
--   psql "$DIRECT_URL" -f prisma/sql/clear-pref-occupation.sql
--
-- To undo:
--   UPDATE "Member" m SET "prefOccupation" = b."prefOccupation"
--   FROM pref_occupation_backup_20261121 b WHERE m."profileCode" = b."profileCode" AND m."prefOccupation" = '';

BEGIN;

CREATE TABLE IF NOT EXISTS pref_occupation_backup_20261121 (
  "profileCode"    text PRIMARY KEY,
  "prefOccupation" text NOT NULL,
  "savedAt"        timestamptz NOT NULL DEFAULT now()
);

WITH target("profileCode", expected) AS (VALUES
  ('SS-1050', 'Engineer'),
  ('SS-1094', 'Engineer,Doctor / Medical,Business / Entrepreneur,Banking / Finance / CA,Aviation / Hospitality,Agriculture / Farming,Family Business,Government Job,Homemaker,IT / Software,Not Working,Other,Private Job,Police / Defence,Self Employed / Freelancer'),
  ('SS-1364', '''Job'),
  ('SS-1642', 'Aviation / Hospitality,Banking / Finance / CA,Business / Entrepreneur,Doctor / Medical,Education / Teaching,Engineer,Family Business,Government Job,IT / Software,Lawyer / Legal,Management / Administration,Marketing / Sales / HR,Media / Designing,Private Job,Self Employed / Freelancer'),
  ('SS-1718', 'Banking / Finance / CA,Business / Entrepreneur,Family Business,Government Job,IT / Software'),
  ('SS-1839', 'Doctor / Medical'),
  ('SS-1861', 'Bussiness,Self Employed'),
  ('SS-1874', '-'),
  ('SS-1876', 'Business Owner,Buider,Builder,Business'),
  ('SS-1904', '''Job'),
  ('SS-1914', 'Banking / Finance / CA,Homemaker,Government Job,Private Job,Self Employed / Freelancer'),
  ('SS-1924', 'Business / Entrepreneur,Private Job,Banking / Finance / CA,Education / Teaching,Homemaker,Student,Not Working'),
  ('SS-1926', 'Banking / Finance / CA,Government Job,Homemaker,IT / Software,Other'),
  ('SS-1934', 'Private Job,Government Job,Banking / Finance / CA,Education / Teaching,Homemaker,Not Working,Other,Retired,Student'),
  ('SS-1943', 'Student,Private Job'),
  ('SS-1950', 'Engineer,IT / Software,Banking / Finance / CA,Management / Administration,Marketing / Sales / HR,Private Job,Business / Entrepreneur,Doctor / Medical'),
  ('SS-1964', 'Private Job,Other'),
  ('SS-1968', 'Agriculture / Farming'),
  ('SS-1971', 'Private Job'),
  ('SS-1982', 'Doctor / Medical,Engineer,IT / Software,Business / Entrepreneur,Private Job,Banking / Finance / CA,Education / Teaching,Lawyer / Legal,Management / Administration,Marketing / Sales / HR,Aviation / Hospitality,Agriculture / Farming,Media / Designing,Family Business'),
  ('SS-1986', 'Business / Entrepreneur'),
  ('SS-2003', 'Aviation / Hospitality,Banking / Finance / CA,Business / Entrepreneur,Engineer,Family Business,Government Job,Lawyer / Legal'),
  ('SS-2013', 'Private Job,Other,Management / Administration,IT / Software,Government Job,Engineer,Banking / Finance / CA'),
  ('SS-2016', 'Doctor / Medical,Engineer,IT / Software,Business / Entrepreneur,Government Job,Private Job,Banking / Finance / CA,Management / Administration,Lawyer / Legal,Education / Teaching,Marketing / Sales / HR,Police / Defence,Aviation / Hospitality,Self Employed / Freelancer,Media / Designing,Family Business,Other'),
  ('SS-2018', 'Business / Entrepreneur,Engineer,IT / Software,Self Employed / Freelancer'),
  ('SS-2030', 'Business / Entrepreneur'),
  ('SS-2034', 'Banking / Finance / CA,Doctor / Medical,Engineer,IT / Software,Management / Administration,Marketing / Sales / HR'),
  ('SS-2040', 'Doctor / Medical,Engineer,Lawyer / Legal,Family Business,IT / Software'),
  ('SS-2044', 'Aviation / Hospitality,Banking / Finance / CA,Business / Entrepreneur,Doctor / Medical,Engineer,Family Business,Government Job,IT / Software,Lawyer / Legal,Police / Defence,Self Employed / Freelancer,Private Job')
), saved AS (
  INSERT INTO pref_occupation_backup_20261121 ("profileCode", "prefOccupation")
  SELECT m."profileCode", m."prefOccupation" FROM "Member" m JOIN target t ON t."profileCode" = m."profileCode" AND m."prefOccupation" = t.expected
  ON CONFLICT ("profileCode") DO NOTHING
  RETURNING "profileCode"
)
UPDATE "Member" m SET "prefOccupation" = ''
FROM target t
WHERE m."profileCode" = t."profileCode" AND m."prefOccupation" = t.expected;

-- Expect 29 here
SELECT count(*) AS cleared FROM pref_occupation_backup_20261121;

COMMIT;
