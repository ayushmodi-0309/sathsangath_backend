-- Moves existing members' profession onto the new two-level list.
--
-- Source of truth: profession-mapping.csv (151 members to change; regenerated 2026-11-21 after the API deploy). Every new value is a role in
-- sathsangath_*/lib/profession.ts; the group is derived in code and is NOT stored.
--
-- Safe to re-run, and safe against edits made since the mapping was written:
--   * the old value of every row is copied to profession_backup_20261121 first (once; re-runs
--     never overwrite the original), and
--   * a row is only updated while its profession STILL equals the old value in the mapping, so a
--     member who has already changed theirs is left alone.
--
-- Run it BEFORE deploying the API that serves the new list, so that no member ever holds a value
-- the list does not know (which the API would otherwise turn into "Other" on their next save).
--
--   cd sathsangath_backend && set -a && . ./.env && set +a
--   psql "$DIRECT_URL" -f prisma/sql/migrate-profession-to-roles.sql
--
-- To undo:
--   UPDATE "Member" m SET profession = b.profession
--   FROM profession_backup_20261121 b WHERE m."profileCode" = b."profileCode";

BEGIN;

CREATE TABLE IF NOT EXISTS profession_backup_20261121 (
  "profileCode" text PRIMARY KEY,
  profession    text,
  education     text,
  "savedAt"     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO profession_backup_20261121 ("profileCode", profession, education)
SELECT "profileCode", profession, education FROM "Member"
WHERE profession IS NOT NULL AND btrim(profession) <> ''
ON CONFLICT ("profileCode") DO NOTHING;

WITH map("profileCode", old_profession, new_profession, basis) AS (VALUES
  ('SS-1399', 'Doctor / Medical', 'Healthcare Professional (Other)', 'Needs member'),
  ('SS-1923', 'Doctor / Medical', 'Healthcare Professional (Other)', 'Needs member'),
  ('SS-2000', 'Doctor / Medical', 'Healthcare Professional (Other)', 'Needs member'),
  ('SS-2006', 'Doctor / Medical', 'Healthcare Professional (Other)', 'Needs member'),
  ('SS-2015', 'Doctor / Medical', 'Healthcare Professional (Other)', 'Needs member'),
  ('SS-1930', 'Management / Administration', 'Private / Corporate Employee (Other)', 'Needs member'),
  ('SS-1945', 'Management / Administration', 'Private / Corporate Employee (Other)', 'Needs member'),
  ('SS-1951', 'Management / Administration', 'Private / Corporate Employee (Other)', 'Needs member'),
  ('SS-1956', 'Management / Administration', 'Private / Corporate Employee (Other)', 'Needs member'),
  ('SS-1978', 'Management / Administration', 'Private / Corporate Employee (Other)', 'Needs member'),
  ('SS-2047', 'Management / Administration', 'Private / Corporate Employee (Other)', 'Needs member'),
  ('SS-1722', 'Marketing / Sales / HR', 'Private / Corporate Employee (Other)', 'Needs member'),
  ('SS-1936', 'Marketing / Sales / HR', 'Private / Corporate Employee (Other)', 'Needs member'),
  ('SS-1948', 'Marketing / Sales / HR', 'Private / Corporate Employee (Other)', 'Needs member'),
  ('SS-1961', 'Marketing / Sales / HR', 'Private / Corporate Employee (Other)', 'Needs member'),
  ('SS-1974', 'Marketing / Sales / HR', 'Private / Corporate Employee (Other)', 'Needs member'),
  ('SS-1993', 'Marketing / Sales / HR', 'Private / Corporate Employee (Other)', 'Needs member'),
  ('SS-2012', 'Marketing / Sales / HR', 'Private / Corporate Employee (Other)', 'Needs member'),
  ('SS-2032', 'Marketing / Sales / HR', 'Private / Corporate Employee (Other)', 'Needs member'),
  ('SS-1913', 'sod', 'Other', 'Needs member'),
  ('SS-1532', 'Banking / Finance / CA', 'Chartered Accountant', 'Suggested'),
  ('SS-1767', 'Doctor / Medical', 'Physiotherapist', 'Suggested'),
  ('SS-1839', 'Doctor / Medical', 'Doctor / Physician', 'Suggested'),
  ('SS-1918', 'Doctor / Medical', 'Physiotherapist', 'Suggested'),
  ('SS-1937', 'Doctor / Medical', 'Doctor / Physician', 'Suggested'),
  ('SS-1955', 'Doctor / Medical', 'Pharmacist', 'Suggested'),
  ('SS-1982', 'Doctor / Medical', 'Pharmacist', 'Suggested'),
  ('SS-2004', 'Doctor / Medical', 'Physiotherapist', 'Suggested'),
  ('SS-2027', 'Doctor / Medical', 'Physiotherapist', 'Suggested'),
  ('SS-2040', 'Doctor / Medical', 'Doctor / Physician', 'Suggested'),
  ('SS-2044', 'Doctor / Medical', 'Physiotherapist', 'Suggested'),
  ('SS-2049', 'Doctor / Medical', 'Physiotherapist', 'Suggested'),
  ('SS-2052', 'Doctor / Medical', 'Dentist', 'Suggested'),
  ('SS-1914', 'Engineer', 'Electrical Engineer', 'Suggested'),
  ('SS-1908', 'Garment business', 'Textile Trader / Manufacturer', 'Suggested'),
  ('SS-1921', 'Media / Designing', 'Artist', 'Suggested'),
  ('SS-2022', 'Other', 'Nurse', 'Suggested'),
  ('SS-2024', 'Other', 'Pharmacist', 'Suggested'),
  ('SS-2025', 'Other', 'Artist', 'Suggested'),
  ('SS-2046', 'Other', 'Physiotherapist', 'Suggested'),
  ('SS-1032', 'Private Job', 'Pharmacist', 'Suggested'),
  ('SS-1939', 'Private Job', 'Nurse', 'Suggested'),
  ('SS-1988', 'Private Job', 'Architect', 'Suggested'),
  ('SS-2042', 'Agriculture / Farming', 'Farming', 'Auto'),
  ('SS-1836', 'Banking / Finance / CA', 'Finance Professional (Other)', 'Auto'),
  ('SS-1855', 'Banking / Finance / CA', 'Finance Professional (Other)', 'Auto'),
  ('SS-1878', 'Banking / Finance / CA', 'Finance Professional (Other)', 'Auto'),
  ('SS-1912', 'Banking / Finance / CA', 'Finance Professional (Other)', 'Auto'),
  ('SS-1922', 'Banking / Finance / CA', 'Finance Professional (Other)', 'Auto'),
  ('SS-1925', 'Banking / Finance / CA', 'Finance Professional (Other)', 'Auto'),
  ('SS-1980', 'Banking / Finance / CA', 'Finance Professional (Other)', 'Auto'),
  ('SS-1984', 'Banking / Finance / CA', 'Finance Professional (Other)', 'Auto'),
  ('SS-1996', 'Banking / Finance / CA', 'Finance Professional (Other)', 'Auto'),
  ('SS-2041', 'Banking / Finance / CA', 'Finance Professional (Other)', 'Auto'),
  ('SS-2054', 'Banking / Finance / CA', 'Finance Professional (Other)', 'Auto'),
  ('SS-1375', 'Business / Entrepreneur', 'Business Owner / Entrepreneur', 'Auto'),
  ('SS-1461', 'Business / Entrepreneur', 'Business Owner / Entrepreneur', 'Auto'),
  ('SS-1744', 'Business / Entrepreneur', 'Business Owner / Entrepreneur', 'Auto'),
  ('SS-1749', 'Business / Entrepreneur', 'Business Owner / Entrepreneur', 'Auto'),
  ('SS-1780', 'Business / Entrepreneur', 'Business Owner / Entrepreneur', 'Auto'),
  ('SS-1844', 'Business / Entrepreneur', 'Business Owner / Entrepreneur', 'Auto'),
  ('SS-1915', 'Business / Entrepreneur', 'Business Owner / Entrepreneur', 'Auto'),
  ('SS-1924', 'Business / Entrepreneur', 'Business Owner / Entrepreneur', 'Auto'),
  ('SS-1931', 'Business / Entrepreneur', 'Business Owner / Entrepreneur', 'Auto'),
  ('SS-1968', 'Business / Entrepreneur', 'Business Owner / Entrepreneur', 'Auto'),
  ('SS-1986', 'Business / Entrepreneur', 'Business Owner / Entrepreneur', 'Auto'),
  ('SS-2009', 'Business / Entrepreneur', 'Business Owner / Entrepreneur', 'Auto'),
  ('SS-2010', 'Business / Entrepreneur', 'Business Owner / Entrepreneur', 'Auto'),
  ('SS-2028', 'Business / Entrepreneur', 'Business Owner / Entrepreneur', 'Auto'),
  ('SS-2055', 'Business / Entrepreneur', 'Business Owner / Entrepreneur', 'Auto'),
  ('SS-1906', 'Bussiness', 'Business Owner / Entrepreneur', 'Auto'),
  ('SS-1151', 'Education / Teaching', 'Education / Training Professional', 'Auto'),
  ('SS-1413', 'Education / Teaching', 'Education / Training Professional', 'Auto'),
  ('SS-1005', 'Engineer', 'Engineer (Other)', 'Auto'),
  ('SS-1864', 'Engineer', 'Engineer (Other)', 'Auto'),
  ('SS-1907', 'Engineer', 'Engineer (Other)', 'Auto'),
  ('SS-1919', 'Engineer', 'Engineer (Other)', 'Auto'),
  ('SS-1927', 'Engineer', 'Engineer (Other)', 'Auto'),
  ('SS-1928', 'Engineer', 'Engineer (Other)', 'Auto'),
  ('SS-1929', 'Engineer', 'Engineer (Other)', 'Auto'),
  ('SS-1935', 'Engineer', 'Engineer (Other)', 'Auto'),
  ('SS-1942', 'Engineer', 'Engineer (Other)', 'Auto'),
  ('SS-1943', 'Engineer', 'Engineer (Other)', 'Auto'),
  ('SS-1947', 'Engineer', 'Engineer (Other)', 'Auto'),
  ('SS-1949', 'Engineer', 'Engineer (Other)', 'Auto'),
  ('SS-1954', 'Engineer', 'Engineer (Other)', 'Auto'),
  ('SS-1958', 'Engineer', 'Engineer (Other)', 'Auto'),
  ('SS-1959', 'Engineer', 'Engineer (Other)', 'Auto'),
  ('SS-1960', 'Engineer', 'Engineer (Other)', 'Auto'),
  ('SS-1972', 'Engineer', 'Engineer (Other)', 'Auto'),
  ('SS-1983', 'Engineer', 'Engineer (Other)', 'Auto'),
  ('SS-1985', 'Engineer', 'Engineer (Other)', 'Auto'),
  ('SS-1998', 'Engineer', 'Engineer (Other)', 'Auto'),
  ('SS-2002', 'Engineer', 'Engineer (Other)', 'Auto'),
  ('SS-2016', 'Engineer', 'Engineer (Other)', 'Auto'),
  ('SS-2021', 'Engineer', 'Engineer (Other)', 'Auto'),
  ('SS-2043', 'Engineer', 'Engineer (Other)', 'Auto'),
  ('SS-2057', 'Engineer', 'Engineer (Other)', 'Auto'),
  ('SS-1969', 'Government Job', 'Government Employee (Other)', 'Auto'),
  ('SS-2011', 'Government Job', 'Government Employee (Other)', 'Auto'),
  ('SS-2053', 'Government Job', 'Government Employee (Other)', 'Auto'),
  ('SS-1926', 'HR Executive', 'HR Professional', 'Auto'),
  ('SS-1094', 'IT / Software', 'IT Professional (Other)', 'Auto'),
  ('SS-1237', 'IT / Software', 'IT Professional (Other)', 'Auto'),
  ('SS-1610', 'IT / Software', 'IT Professional (Other)', 'Auto'),
  ('SS-1642', 'IT / Software', 'IT Professional (Other)', 'Auto'),
  ('SS-1790', 'IT / Software', 'IT Professional (Other)', 'Auto'),
  ('SS-1920', 'IT / Software', 'IT Professional (Other)', 'Auto'),
  ('SS-1933', 'IT / Software', 'IT Professional (Other)', 'Auto'),
  ('SS-1938', 'IT / Software', 'IT Professional (Other)', 'Auto'),
  ('SS-1944', 'IT / Software', 'IT Professional (Other)', 'Auto'),
  ('SS-1950', 'IT / Software', 'IT Professional (Other)', 'Auto'),
  ('SS-1953', 'IT / Software', 'IT Professional (Other)', 'Auto'),
  ('SS-1963', 'IT / Software', 'IT Professional (Other)', 'Auto'),
  ('SS-1966', 'IT / Software', 'IT Professional (Other)', 'Auto'),
  ('SS-1977', 'IT / Software', 'IT Professional (Other)', 'Auto'),
  ('SS-1979', 'IT / Software', 'IT Professional (Other)', 'Auto'),
  ('SS-1987', 'IT / Software', 'IT Professional (Other)', 'Auto'),
  ('SS-1989', 'IT / Software', 'IT Professional (Other)', 'Auto'),
  ('SS-2014', 'IT / Software', 'IT Professional (Other)', 'Auto'),
  ('SS-2018', 'IT / Software', 'IT Professional (Other)', 'Auto'),
  ('SS-2030', 'IT / Software', 'IT Professional (Other)', 'Auto'),
  ('SS-2035', 'IT / Software', 'IT Professional (Other)', 'Auto'),
  ('SS-2037', 'IT / Software', 'IT Professional (Other)', 'Auto'),
  ('SS-2039', 'IT / Software', 'IT Professional (Other)', 'Auto'),
  ('SS-2045', 'IT / Software', 'IT Professional (Other)', 'Auto'),
  ('SS-2005', 'Lawyer / Legal', 'Lawyer / Advocate', 'Auto'),
  ('SS-2033', 'Media / Designing', 'Media Professional (Other)', 'Auto'),
  ('SS-1594', 'Private Job', 'Private / Corporate Employee (Other)', 'Auto'),
  ('SS-1909', 'Private Job', 'Private / Corporate Employee (Other)', 'Auto'),
  ('SS-1916', 'Private Job', 'Private / Corporate Employee (Other)', 'Auto'),
  ('SS-1932', 'Private Job', 'Private / Corporate Employee (Other)', 'Auto'),
  ('SS-1934', 'Private Job', 'Private / Corporate Employee (Other)', 'Auto'),
  ('SS-1952', 'Private Job', 'Private / Corporate Employee (Other)', 'Auto'),
  ('SS-1967', 'Private Job', 'Private / Corporate Employee (Other)', 'Auto'),
  ('SS-1970', 'Private Job', 'Private / Corporate Employee (Other)', 'Auto'),
  ('SS-1971', 'Private Job', 'Private / Corporate Employee (Other)', 'Auto'),
  ('SS-1973', 'Private Job', 'Private / Corporate Employee (Other)', 'Auto'),
  ('SS-1981', 'Private Job', 'Private / Corporate Employee (Other)', 'Auto'),
  ('SS-1990', 'Private Job', 'Private / Corporate Employee (Other)', 'Auto'),
  ('SS-1992', 'Private Job', 'Private / Corporate Employee (Other)', 'Auto'),
  ('SS-1995', 'Private Job', 'Private / Corporate Employee (Other)', 'Auto'),
  ('SS-1999', 'Private Job', 'Private / Corporate Employee (Other)', 'Auto'),
  ('SS-2003', 'Private Job', 'Private / Corporate Employee (Other)', 'Auto'),
  ('SS-2008', 'Private Job', 'Private / Corporate Employee (Other)', 'Auto'),
  ('SS-2013', 'Private Job', 'Private / Corporate Employee (Other)', 'Auto'),
  ('SS-2019', 'Private Job', 'Private / Corporate Employee (Other)', 'Auto'),
  ('SS-2020', 'Private Job', 'Private / Corporate Employee (Other)', 'Auto'),
  ('SS-2031', 'Private Job', 'Private / Corporate Employee (Other)', 'Auto'),
  ('SS-2038', 'Private Job', 'Private / Corporate Employee (Other)', 'Auto'),
  ('SS-2050', 'Private Job', 'Private / Corporate Employee (Other)', 'Auto')
)
UPDATE "Member" m
SET profession = map.new_profession
FROM map
WHERE m."profileCode" = map."profileCode"
  AND m.profession = map.old_profession
  AND m.profession <> map.new_profession;

-- What it did: rows now holding a role from the new list, and anything still on an old value.
SELECT profession, count(*) FROM "Member"
WHERE profession IS NOT NULL AND btrim(profession) <> ''
GROUP BY profession ORDER BY count(*) DESC, profession;

COMMIT;
