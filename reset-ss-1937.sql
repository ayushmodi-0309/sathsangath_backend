-- Resets the test profile SS-1937 so its sign-in account goes back through onboarding.
--
-- Deletes the Member row only. The Account (Firebase login, verified email) is NOT touched, so the app
-- sees "signed in, no profile" and routes straight to the onboarding wizard. Everything attached to the
-- member (photos, likes, intros, tags, notifications...) goes with it through ON DELETE CASCADE.
--
-- Guarded: it deletes only if SS-1937 is still the PENDING web sign-up on that account. Anything else
-- and it deletes nothing (you will see DELETE 0).
--
-- NOT removed: the photo and ID-proof files in storage (the row is gone, the objects are orphaned).
-- Harmless for a test profile.
--
--   cd sathsangath_backend && set -a && . ./.env && set +a
--   psql "$DIRECT_URL" -f <this file>

BEGIN;

DELETE FROM "Member" m
USING "Account" a
WHERE m."accountId" = a.id
  AND m."profileCode" = 'SS-1937'
  AND m.status = 'PENDING'
  AND m.source = 'WEB'
  AND a.email = 'dilise9560@chuwel.com';

-- Expect: profile_left = 0, account_left = 1
SELECT
  (SELECT count(*) FROM "Member"  WHERE "profileCode" = 'SS-1937')            AS profile_left,
  (SELECT count(*) FROM "Account" WHERE email = 'dilise9560@chuwel.com')      AS account_left;

COMMIT;
