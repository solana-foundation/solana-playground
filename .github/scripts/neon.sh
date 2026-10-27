#!/usr/bin/env bash
# Neon REST calls shared by the preview workflows. The REST API rather than
# neonctl, whose flags change between its weekly major releases.
#
#   neon.sh ensure <branch>       create <branch> from $NEON_BASE_BRANCH unless it exists; print its id
#   neon.sh uri <branch> [pooled] print the branch's connection string (direct unless "pooled")
#   neon.sh delete <branch>       delete <branch>; absence is a pass
#   neon.sh list                  print "<name> <age in minutes>" for every unprotected, non-default branch
#
# Every API error fails the command: a preview that cannot get its database
# must not deploy against some other one, and a cleanup that cannot delete
# must not report success.
set -euo pipefail

: "${NEON_API_KEY:?NEON_API_KEY secret is unset}"
: "${NEON_PROJECT_ID:?NEON_PROJECT_ID variable is unset}"
BASE_BRANCH=${NEON_BASE_BRANCH:-main}
DATABASE=${NEON_DATABASE:-neondb}

API=https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID

# A branch with a running operation answers 423 Locked to the next write; Neon
# documents retrying. curl's own --retry does not cover 423, hence the loop.
# A POST is retried only on 423 and 429, which refuse it unprocessed: after a
# 5xx or a dropped connection it may have created the branch already.
api() {
  local attempt status body retry='^(423|429|5..|000)$'
  [[ " $* " == *" -X POST "* ]] && retry='^(423|429)$'
  body=$(mktemp)
  for attempt in 1 2 3 4 5 6; do
    status=$(curl -sS --connect-timeout 10 --max-time 60 -o "$body" -w '%{http_code}' \
      -H "Authorization: Bearer $NEON_API_KEY" -H 'Content-Type: application/json' "$@") || status=000
    [[ "$status" == 2?? ]] && { cat "$body"; rm -f "$body"; return 0; }
    [[ "$status" =~ $retry ]] && [ "$attempt" -lt 6 ] || break
    echo "neon: HTTP $status, retry $attempt" >&2
    sleep $((attempt * 5))
  done
  echo "neon: HTTP $status for $*" >&2
  cat "$body" >&2
  rm -f "$body"
  return 1
}

# Every branch matching `search` (all of them without one), as one page. The
# API's page limit is 10000, far above any plan's branch cap; a full page
# fails rather than let a branch on a later page read as absent.
# The explicit returns: this runs inside `$(...)`, where `set -e` is off.
branches() {
  local page count
  page=$(api -G --data-urlencode limit=10000 ${1:+--data-urlencode "search=$1"} "$API/branches") || return 1
  count=$(jq -e '.branches | length' <<<"$page") || return 1
  if [ "$count" -ge 10000 ]; then
    echo "neon: 10000 branches in one page, the rest unread" >&2
    return 1
  fi
  printf '%s\n' "$page"
}

# Exact match: `search` is a substring filter, so `preview/pr-1` also finds `preview/pr-12`.
branch_id() {
  branches "$1" | jq -er --arg name "$1" 'first(.branches[] | select(.name == $name) | .id) // ""'
}

wait_ready() {
  local state
  for _ in $(seq 1 30); do
    state=$(api "$API/branches/$1" | jq -r .branch.current_state)
    [ "$state" = ready ] && return 0
    sleep 2
  done
  echo "neon: branch $1 still $state after a minute" >&2
  return 1
}

cmd_ensure() {
  local name=$1 id parent
  id=$(branch_id "$name")
  if [ -z "$id" ]; then
    # Cut from `main` of the preview Neon project, so the preview starts with
    # its schema and `schema_migrations` and dbmate applies only what `main`
    # lacks: see client-v2/docs/neon.md.
    parent=$(branch_id "$BASE_BRANCH")
    [ -n "$parent" ] || { echo "neon: no parent branch $BASE_BRANCH" >&2; return 1; }
    id=$(api -X POST "$API/branches" -d "$(jq -n --arg name "$name" --arg parent "$parent" \
      '{branch: {name: $name, parent_id: $parent}, endpoints: [{type: "read_write"}]}')" | jq -er .branch.id)
    echo "created Neon branch $name ($id)" >&2
  else
    echo "reusing Neon branch $name ($id)" >&2
  fi
  wait_ready "$id"
  printf '%s\n' "$id"
}

cmd_uri() {
  local name=$1 pooled=false id role
  [ "${2:-}" = pooled ] && pooled=true
  id=$(branch_id "$name")
  [ -n "$id" ] || { echo "neon: no branch $name" >&2; return 1; }
  # The one role the integration made; inherited from the parent branch.
  role=$(api "$API/branches/$id/roles" | jq -r '[.roles[] | select(.protected | not) | .name] | if length == 1 then .[0] else error("expected one role, got \(.)") end')
  api -G --data-urlencode "branch_id=$id" --data-urlencode "database_name=$DATABASE" \
    --data-urlencode "role_name=$role" --data-urlencode "pooled=$pooled" \
    "$API/connection_uri" | jq -er .uri
}

cmd_delete() {
  local name=$1 id
  id=$(branch_id "$name")
  if [ -z "$id" ]; then
    echo "no Neon branch $name, nothing to delete"
    return 0
  fi
  api -X DELETE "$API/branches/$id" >/dev/null
  echo "deleted Neon branch $name ($id)"
}

cmd_list() {
  branches | jq -r '.branches[] | select((.default // false) or (.protected // false) | not)
      | "\(.name) \((now - (.created_at | sub("\\.[0-9]+"; "") | fromdateiso8601)) / 60 | floor)"'
}

case "${1:-}" in
  ensure) cmd_ensure "$2" ;;
  uri) cmd_uri "$2" "${3:-}" ;;
  delete) cmd_delete "$2" ;;
  list) cmd_list ;;
  *) echo "usage: neon.sh ensure|uri|delete <branch> | list" >&2; exit 2 ;;
esac
