# Deprecations — things kept only for older app builds

Every entry here is dead weight the API carries so that a copy of the app already on somebody's
phone keeps working. None of it is used by the current web, admin or app code.

**The rule for all of them: accepted and ignored, never rejected.** An older build must be able to
submit a bio data or save a profile without a validation error. Removing a field from a schema
turns it into "unrecognised key" and the save starts failing for exactly the people who cannot fix
it — so these come out *after* the old builds are gone, not before.

## When can these be removed?

When the oldest app build still in use no longer sends them. That means:

1. The new build is live on the App Store and Play Store.
2. Enough time has passed, or a forced-update gate is in place, that the old build is not in use.
3. Ideally confirmed from the API logs rather than assumed.

Current app version: **1.1.1+9** (`sathsangath_app/pubspec.yaml`). Note the version that first
ships without each field below, and compare against what is actually calling the API.

---

## 1. `Member.siblings` — free-text brothers and sisters

Replaced by four counts: `brothers`, `brothersMarried`, `sisters`, `sistersMarried`, plus the
`siblingsSummary` string the API builds for display.

| | |
| --- | --- |
| Column | still present, **63 rows still hold a value** |
| API accepts | yes — `public.ts` intake, `member.ts` profile patch, `admin.ts` both edit schemas |
| API writes | no — stripped as `siblings: _retiredSiblings` in each route's destructure |
| API returns | no — removed from `publicFields` and `toPublicProfile` |
| Clients | no web or app code references it |

**To remove:** drop the four `siblings:` lines from the schemas and the `_retiredSiblings`
destructures, then `ALTER TABLE "Member" DROP COLUMN "siblings"`.

> The 63 values were supposed to be cleared by `prisma/sql/add-sibling-counts.sql`, but only the
> `ALTER TABLE` half of that file was run. They are invisible to every client, so nothing is
> broken — but they are real answers ("1 Sister & 1 Brother", "No siblings") and dropping the
> column deletes them. Either clear them deliberately, or parse them into the new counts first.

## 2. `Member.visaExpiry` — visa / status expiry date

Retired entirely: nobody asks for it and nobody shows it.

| | |
| --- | --- |
| Column | still present, **8 rows still hold a date** |
| API accepts | yes — all three write paths |
| API writes | no — `visaExpiryValue()` in `admin.ts` always returns "untouched"; the other routes drop it |
| API returns | **yes** — still in `publicFields` and `toPublicProfile` |
| Clients | no web or app code references it |

Unlike `siblings`, this one is **still serialized**. That was deliberate: app builds in the wild
still render the row, so withdrawing it would have made stored dates vanish from their screens
mid-release. It can stop being returned as soon as those builds are gone — that is a separate,
earlier step than dropping the column.

**To remove:** first drop `visaExpiry` from `serializers.ts` (two places), then the schema
entries and the destructures, then the column.

## 3. `nearby` — the "Nearby" quick filter

Removed from the web filter bar and the app filter sheet. The API still understands it so that an
older app build's feed request does not 400.

| | |
| --- | --- |
| API accepts | yes — `member.ts:372` query schema |
| API honours it | yes — `matching.ts:148` still filters by the viewer's city if `nearby=1` arrives |
| Clients | neither web nor app sends it |

Deliberately still *working*, not just tolerated: an old build showing a "Nearby" chip that
silently did nothing would be worse than one that still works.

**To remove:** delete the query-schema line, the `nearby?: boolean` on the filters type
(`matching.ts:43`) and the branch at `matching.ts:148`.

## 4. `BASIC` and `PRO` — retired membership plan codes

Superseded by `DIKRI` / `DIKRA` / `DIKRA_6M` / `SIGNATURE`. Kept so a membership sold under the old
names still reads correctly rather than showing a raw code.

- `admin.ts:75` — both still in the plan filter enum
- `sathsangath_frontend/lib/plans.ts:27` — `LEGACY_PLAN_NAMES`
- `sathsangath_app/lib/data/plans.dart:11-12` — the same mapping

Not tied to app versions. These can go once no `MembershipPlan` row holds either code:

```sql
SELECT plan, count(*) FROM "MembershipPlan" WHERE plan IN ('BASIC','PRO') GROUP BY plan;
```

## 5. Visa type aliases — shorter labels from earlier builds

`"Work visa"` → `"Work visa (other)"`, `"Green card"` → `"Permanent resident (PR / Green card)"`,
and so on. Mapped on load so a stored short label lands on the matching dropdown option instead of
showing blank.

- `sathsangath_backend/src/routes/public.ts:88`
- `sathsangath_frontend/components/member/profile-constants.ts:40`
- `sathsangath_app/lib/core/widgets/form_fields.dart:77`

Also version-independent. Removable once no member row holds a short label:

```sql
SELECT "visaType", count(*) FROM "Member"
WHERE "visaType" IN ('Work visa','Dependent / spouse visa','Permanent resident','Green card')
GROUP BY "visaType";
```

---

## Related, but not deprecations

Listed so they are not mistaken for dead code.

- **Education and profession are closed lists.** They were removed from `TAG_FIELD_CATEGORIES`
  (`src/lib/tags.ts`) so no new values are learned from what members type. The `Education` and
  `Profession` tag categories still exist and are re-synced from code on every boot by
  `syncClosedLists()` — that is how the app gets the lists without a release. Not removable.
- **`coerceEducation` / `coerceProfession`** fold an off-list value to `"Other"` instead of
  rejecting it. This exists for older builds that still offer free text, so it belongs to the same
  release gate as the items above — but folding is also a reasonable permanent safety net against
  a bad import. Decide when the gate opens.
- **`incomeCurrency`** is new, not retired. Rows that predate it default to `INR`.

## `GET /public/cities` and the `City` tag category — legacy, kept on purpose

Place of living is now a closed cascade: Country → State → District → City/Town, held in
`src/lib/locations.ts` and generated by `scripts/generate-india-locations.ts`. Both of these stay
alive for clients that predate it:

- **`GET /public/cities`** (`src/lib/cities.ts`, the `country-state-city` package). The shipped app
  builds drive their city picker off it, and both the web form and the app still use it for the
  native place (vatan), which remains free text. It is no longer used on any write path.
- **The `City` `TagCategory` and its values.** `city` was removed from `TAG_FIELD_CATEGORIES` in
  `src/lib/tags.ts`, so new values stop being learned — but the existing rows are still served by
  `GET /public/tags`, which is where an older app build gets its city list. Removing them would
  empty that picker. Same reasoning as the Education/Profession note in that file.

Retire both once the oldest supported app build sends `district`. At that point also drop the
legacy branch in `PUT /member/profile` and in the intake transform, which fills the district in
from a free-typed city via `resolveLegacyCity()`.

### Not yet moved onto the closed list

`prefCities` (partner preferences, comma-separated) and the hard-coded marketing `cities` list in
the web's `lib/content.ts` still hold free text, and `prefCountries` stores country *names* rather
than ISO codes. Unifying those is a separate change.
