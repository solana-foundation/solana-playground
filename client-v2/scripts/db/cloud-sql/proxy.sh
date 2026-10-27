# The Cloud SQL Auth Proxy for the scripts beside this file. Sourced, never run.
#
# Reads:
#   CLOUD_SQL_INSTANCE    `<project>:<region>:<instance>` to reach
#   CLOUD_SQL_USER        the application's IAM database user: the owner of a
#                         preview database, and the role every migration sets,
#                         so the application owns every table it creates
#   CLOUD_SQL_LOGIN_USER  optional; the IAM database user the proxy logs in as,
#                         on Application Default Credentials, which must belong
#                         to it (google-github-actions/auth's in CI). Unset, the
#                         proxy logs in as gcloud's active account on gcloud's
#                         credentials, a service account without
#                         `.gserviceaccount.com`
#   CLOUD_SQL_PROXY_PORT  optional; 5434, clear of the compose Postgres
#
# The proxy runs with `--auto-iam-authn`, so its credentials and the user name
# in the URL must be the same identity. It carries the TLS, so the URLs below
# say `sslmode=disable` to a listener on 127.0.0.1.

: "${CLOUD_SQL_INSTANCE:?CLOUD_SQL_INSTANCE is unset: the instance to reach, <project>:<region>:<instance>}"
: "${CLOUD_SQL_USER:?CLOUD_SQL_USER is unset: the IAM database user the application connects as}"
PROXY_PORT=${CLOUD_SQL_PROXY_PORT:-5434}

# The template every preview database is cloned from, and that
# migrate-preview-base keeps migrated
PREVIEW_BASE=solpg_preview_base

# Every name below is interpolated into SQL as a quoted identifier
[[ "$CLOUD_SQL_USER" =~ ^[A-Za-z0-9@._-]+$ ]] || {
  echo "CLOUD_SQL_USER is not an IAM database user name: \"$CLOUD_SQL_USER\"" >&2
  exit 1
}

login_user() {
  local account=${CLOUD_SQL_LOGIN_USER:-}
  if [ -z "$account" ]; then
    account=$(gcloud config get-value account 2>/dev/null) || account=
  fi
  [ -n "$account" ] || {
    echo "no Google identity: run 'gcloud auth login' or set CLOUD_SQL_LOGIN_USER" >&2
    return 1
  }
  printf '%s\n' "${account%.gserviceaccount.com}"
}

# `--` so a value starting with `-` reaches the script, not node's options
urlencode() {
  node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' -- "$1"
}

# A URL for `database` through the proxy. With `role`, every session sets it,
# so what a migration creates belongs to the application's user. Each step is
# checked: a failure inside one `$(...)` in a string would go unnoticed, and a
# URL missing its role creates tables the application cannot use.
proxy_url() {
  local database=$1 role=${2:-} user options=
  user=$(login_user) || return 1
  user=$(urlencode "$user") || return 1
  if [ -n "$role" ]; then
    options=$(urlencode "-c role=$role") || return 1
    options="&options=$options"
  fi
  printf 'postgres://%s@127.0.0.1:%s/%s?sslmode=disable%s\n' \
    "$user" "$PROXY_PORT" "$database" "$options"
}

# Run SQL on the instance's `postgres` database as the login user
admin_sql() {
  local url
  url=$(proxy_url postgres) || return 1
  psql -v ON_ERROR_STOP=1 -qtAX "$url" -c "$1"
}

PROXY_PID=

# Start the proxy and wait for its ready line. Fails, printing its log, when
# it exits first or is not ready within 30 seconds.
start_proxy() {
  command -v cloud-sql-proxy >/dev/null 2>&1 || {
    echo "cloud-sql-proxy required: https://cloud.google.com/sql/docs/postgres/sql-proxy#install" >&2
    return 1
  }
  command -v psql >/dev/null 2>&1 || { echo "psql required" >&2; return 1; }
  # The credentials of the identity login_user names
  local auth=()
  [ -n "${CLOUD_SQL_LOGIN_USER:-}" ] || auth=(--gcloud-auth)
  PROXY_LOG=$(mktemp)
  cloud-sql-proxy --auto-iam-authn ${auth[@]+"${auth[@]}"} --port "$PROXY_PORT" "$CLOUD_SQL_INSTANCE" >"$PROXY_LOG" 2>&1 &
  PROXY_PID=$!
  for _ in $(seq 1 60); do
    grep -q 'ready for new connections' "$PROXY_LOG" && return 0
    kill -0 "$PROXY_PID" 2>/dev/null || break
    sleep 0.5
  done
  echo "cloud-sql-proxy did not start:" >&2
  cat "$PROXY_LOG" >&2
  stop_proxy
  return 1
}

stop_proxy() {
  [ -n "$PROXY_PID" ] || return 0
  kill "$PROXY_PID" 2>/dev/null || true
  wait "$PROXY_PID" 2>/dev/null || true
  PROXY_PID=
  rm -f "$PROXY_LOG"
}
