# Shared by every script under scripts/db/<provider>/. Sourced, never run.
#
# Each script takes `--pr <number>` or `--branch <name>` and never a database
# name: `parse_target` reads the pair, and the Cloud SQL name comes from
# preview-name.mjs alone (see client-v2-preview-database, "No input names a
# preview's database").

DB_SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CLIENT_V2=$(cd "$DB_SCRIPTS/../.." && pwd)
NEON_SH=$(cd "$CLIENT_V2/.." && pwd)/.github/scripts/neon.sh
NEON_PREVIEW_BRANCH=$CLIENT_V2/scripts/neon-preview-branch.sh

usage() {
  echo "usage: $(basename "$0") --pr <number> | --branch <name>${1:+ | $1}" >&2
  exit 2
}

# Sets TARGET_KIND (pr | branch) and TARGET (the number or the branch).
# `$1` names an extra mode the caller accepts in place of the pair, such as
# `production`; it sets TARGET_KIND to that word.
parse_target() {
  local extra=$1
  shift
  if [ -n "$extra" ] && [ "$#" -eq 1 ] && [ "$1" = "$extra" ]; then
    TARGET_KIND=$extra TARGET=
    return
  fi
  [ "$#" -eq 2 ] || usage "$extra"
  case "$1" in
    --pr) TARGET_KIND=pr ;;
    --branch) TARGET_KIND=branch ;;
    *) usage "$extra" ;;
  esac
  TARGET=$2
  [ -n "$TARGET" ] || usage "$extra"
}

# Splits "$@" at `--`: TARGET_ARGS before it, COMMAND after (empty without
# `--`). `migration-url` runs COMMAND with DATABASE_URL set, or prints the URL.
split_command() {
  TARGET_ARGS=() COMMAND=()
  while [ "$#" -gt 0 ]; do
    if [ "$1" = -- ]; then
      shift
      COMMAND=("$@")
      return
    fi
    TARGET_ARGS+=("$1")
    shift
  done
}

# The Cloud SQL database for TARGET; fails on a malformed PR number
preview_db_name() {
  local name
  name=$(node "$DB_SCRIPTS/preview-name.mjs" "--$TARGET_KIND" "$TARGET") || return 1
  [ -n "$name" ] || { echo "preview-name.mjs printed no name" >&2; return 1; }
  printf '%s\n' "$name"
}

# The Neon branch for TARGET, as preview.yml and neon-preview-branch.sh name it
neon_branch() {
  if [ "$TARGET_KIND" = pr ]; then
    [[ "$TARGET" =~ ^[1-9][0-9]*$ ]] || { echo "not a pull request number: \"$TARGET\"" >&2; return 1; }
    printf 'preview/pr-%s\n' "$TARGET"
  else
    printf 'preview/%s\n' "$TARGET"
  fi
}
