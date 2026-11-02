#!/usr/bin/env bash
# Write the PR's one preview comment, editing it in place on every later run so
# a PR pushed to twenty times carries one comment, not twenty.
#
#   preview-comment.sh [--edit-only | --replace-if <prefix>] <pr-number> <body>
#
# --edit-only changes an existing comment and posts none, for the teardown of a
# PR that may never have had a preview. --replace-if does the same, and only
# when the existing comment's text starts with <prefix>, so a run replaces its
# own earlier message and nobody else's. Needs GH_TOKEN with
# pull-requests: write and GITHUB_REPOSITORY.
set -euo pipefail

edit_only=false
prefix=
case "${1:-}" in
  --edit-only)
    edit_only=true
    shift
    ;;
  --replace-if)
    edit_only=true
    prefix=$2
    shift 2
    ;;
esac

MARKER='<!-- preview-deploy -->'
pr=$1
body="$MARKER
$2"

# All the ids, then the first: `| head -1` would close the pipe on gh, and
# pipefail would fail a deploy that had succeeded.
ids=$(gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$pr/comments" \
  --jq ".[] | select(.user.login == \"github-actions[bot]\" and (.body | startswith(\"$MARKER\"))) | .id")
id=${ids%%$'\n'*}

if [ -n "$id" ] && [ -n "$prefix" ]; then
  current=$(gh api "repos/$GITHUB_REPOSITORY/issues/comments/$id" --jq .body)
  current=${current#"$MARKER"$'\n'}
  [[ "$current" == "$prefix"* ]] || exit 0
fi

if [ -n "$id" ]; then
  gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$id" -f body="$body" >/dev/null
elif [ "$edit_only" = false ]; then
  gh api "repos/$GITHUB_REPOSITORY/issues/$pr/comments" -f body="$body" >/dev/null
fi
