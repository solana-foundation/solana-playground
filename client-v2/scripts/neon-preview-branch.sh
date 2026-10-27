#!/bin/sh
# Print the connection string for this git branch's Neon branch, creating the
# branch on first use. One isolated database per preview, so two people testing
# migrations on two branches cannot corrupt each other.
#
# Previews are cut from `main`, the default branch of the preview Neon project,
# which is not production's. A copy-on-write branch carries its schema and
# `schema_migrations`, so dbmate applies only the migrations `main` lacks. `--schema-only` would not do: it copies the
# tables but leaves `schema_migrations` empty, which makes dbmate try to create
# tables that are already there.
#
# Pass --pooled for the connection string the deployed app uses. Leave it off for
# migrations, which need a direct connection rather than the PgBouncer endpoint.
#
# `--ssl require` is explicit: dbmate refuses a URL that names no sslmode, and
# src/features/persistence/model/db.mjs would otherwise be free to connect in
# the clear.
set -e

# A Vercel-managed Neon account has no CLI login -- `neon login` cannot work, so
# a project-scoped key from the Neon console is the only way in. Makefile.vercel
# reads it out of client-v2/.env, the same file dbmate takes DATABASE_URL from.
: "${NEON_API_KEY:?NEON_API_KEY is unset -- add it to client-v2/.env}"
: "${NEON_PROJECT_ID:?NEON_PROJECT_ID is unset -- add it to client-v2/.env}"

DATABASE=${NEON_DATABASE:-neondb}
BASE_BRANCH=${NEON_BASE_BRANCH:-main}

neon() { npx --yes neonctl@latest "$@"; }

branch="preview/$(git rev-parse --abbrev-ref HEAD)"

conn() {
  neon connection-string "$branch" "$@" --ssl require \
    --project-id "$NEON_PROJECT_ID" --database-name "$DATABASE" 2>/dev/null
}

url=$(conn "$@") || url=""

if [ -z "$url" ]; then
  echo "creating Neon branch $branch from $BASE_BRANCH" >&2
  neon branches create --name "$branch" --parent "$BASE_BRANCH" \
    --project-id "$NEON_PROJECT_ID" --no-secrets >/dev/null
  url=$(conn "$@")
fi

printf '%s\n' "$url"
