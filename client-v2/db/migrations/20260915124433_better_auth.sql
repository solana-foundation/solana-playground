-- Better Auth's own schema, emitted by `getMigrations()` from better-auth
-- 1.7.5 and checked in rather than applied by `npx auth migrate`. The only
-- addition to the generated output is the "login" column, declared to Better
-- Auth as an additional field -- see the comment on it below.
--
-- Two migration runners against one database would have no shared ordering,
-- and `projects.user_id` (the next migration) has a foreign key into "user",
-- so ordering matters. dbmate is the only runner.
--
-- Every identifier is quoted: the table `user` is a reserved word, and the
-- columns are camelCase, which Postgres would otherwise fold to lowercase.
--
-- To refresh after a better-auth upgrade: regenerate, diff against this file,
-- and write a new migration for the delta. Never edit this one in place.

-- migrate:up

create table "user" (
  "id" text not null primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" boolean not null,
  "image" text,
  "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
  "updatedAt" timestamptz default CURRENT_TIMESTAMP not null,
  -- Not part of Better Auth's core schema. Declared to it as
  -- `user.additionalFields.login` and filled by `mapProfileToUser` from the
  -- GitHub profile, so this column is Better Auth's to write.
  --
  -- It is NOT an identity key: a login is renameable, so ownership keys off
  -- "id". It exists only to render "@handle" and link to the profile, which
  -- is why it is nullable -- a provider without a handle is still a valid user.
  "login" text
);

create table "session" (
  "id" text not null primary key,
  "expiresAt" timestamptz not null,
  "token" text not null unique,
  "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
  "updatedAt" timestamptz not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references "user" ("id") on delete cascade
);

create table "account" (
  "id" text not null primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
  "updatedAt" timestamptz not null
);

create table "verification" (
  "id" text not null primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz default CURRENT_TIMESTAMP not null,
  "updatedAt" timestamptz default CURRENT_TIMESTAMP not null
);

create index "session_userId_idx" on "session" ("userId");
create index "account_userId_idx" on "account" ("userId");
create index "verification_identifier_idx" on "verification" ("identifier");

-- migrate:down

-- Reverse dependency order: `session` and `account` reference `user`.
drop table if exists "verification";
drop table if exists "account";
drop table if exists "session";
drop table if exists "user";
