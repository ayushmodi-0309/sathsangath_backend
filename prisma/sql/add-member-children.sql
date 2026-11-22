-- Optional children (gender + age) for divorced / widowed members. 0..n rows per member.
--
-- Safe to run more than once.
--
--   cd sathsangath_backend && set -a && . ./.env && set +a
--   psql "$DIRECT_URL" -f prisma/sql/add-member-children.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "MemberChild" (
  "id"        TEXT         NOT NULL,
  "memberId"  TEXT         NOT NULL,
  "gender"    TEXT         NOT NULL,
  "age"       INTEGER      NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemberChild_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MemberChild_memberId_fkey" FOREIGN KEY ("memberId")
    REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "MemberChild_memberId_idx" ON "MemberChild"("memberId");

COMMIT;

-- Expect: one row, table exists, 0 children
SELECT count(*) AS children FROM "MemberChild";
