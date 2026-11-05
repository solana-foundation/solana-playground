#!/usr/bin/env bash
# Install the Cloud SQL Auth Proxy on a Linux x86-64 runner, at a pinned
# version checked against the SHA-256 Google publishes in the release notes.
# A version bump changes both lines below.
#
# --with-pg-dump also installs the PostgreSQL client at the instance's major
# version, for create-preview-db: pg_dump refuses a server newer than itself,
# and the runner's own client is older. Its bin directory goes first on PATH
# for the steps after this one.
#
#   install-cloud-sql-proxy.sh [--with-pg-dump]
set -euo pipefail

# The preview instance's major version (docs/cloud-sql.md, step 2)
PG_MAJOR=17

VERSION=v2.27.0
SHA256=39ed2abcaa073c3b4714585e36a904e2b1d92218c5e07c18224fb73ef4bedde5

bin=/usr/local/bin/cloud-sql-proxy
curl -fsSL -o "$bin" \
  "https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/$VERSION/cloud-sql-proxy.linux.amd64"
echo "$SHA256  $bin" | sha256sum -c --quiet
chmod +x "$bin"
command -v psql >/dev/null || { echo "::error::psql is not on the runner"; exit 1; }

if [ "${1:-}" = --with-pg-dump ]; then
  # The PostgreSQL project's apt repository, set up by the script the runner's
  # postgresql-common package ships
  sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y >/dev/null
  sudo apt-get install -y -qq "postgresql-client-$PG_MAJOR" >/dev/null
  echo "/usr/lib/postgresql/$PG_MAJOR/bin" >> "$GITHUB_PATH"
  "/usr/lib/postgresql/$PG_MAJOR/bin/pg_dump" --version
fi
