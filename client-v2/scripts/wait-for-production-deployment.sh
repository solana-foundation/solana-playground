#!/usr/bin/env bash
# Wait for Vercel's `Production` deployment of commit $SHA in $REPO and write
# its URL to $GITHUB_OUTPUT as `url`. The `smoke` job of client-v2.yml runs it
# before probing the deployment's database.
#
# The newest status of the commit's `Production` deployment decides:
# `success` carries the URL; `failure`, `error` or `inactive` (superseded by a
# newer production deployment) ends the wait with exit 1; anything else is a
# build still going. Gives up after 30 minutes. A GitHub API error is retried,
# not fatal; three in a row end the wait.
#
# Needs `gh` authenticated (GH_TOKEN) and GitHub Actions' GITHUB_OUTPUT and
# GITHUB_STEP_SUMMARY.
set -u

: "${REPO:?REPO is unset (owner/name)}"
: "${SHA:?SHA is unset (the commit whose deployment to wait for)}"

deadline=$((SECONDS + 1800))
state=none
api_failures=0
while [ "$SECONDS" -lt "$deadline" ]; do
  if ! id=$(gh api "repos/$REPO/deployments?sha=$SHA&environment=Production" \
    --jq 'map(select(.creator.login == "vercel[bot]")) | .[0].id // empty'); then
    api_failures=$((api_failures + 1))
    if [ "$api_failures" -ge 3 ]; then
      echo "::error::the GitHub API failed three times in a row while looking for the production deployment of $SHA"
      echo "### Smoke FAILED: the GitHub API failed three times in a row while looking for the production deployment of \`$SHA\`" >> "$GITHUB_STEP_SUMMARY"
      exit 1
    fi
    sleep 20
    continue
  fi
  if [ -n "$id" ]; then
    # Unit separator, not a tab: tab is IFS whitespace, so an empty field would shift the next one left.
    if ! row=$(gh api "repos/$REPO/deployments/$id/statuses" \
      --jq '.[0] // {} | [(.state // "pending"), (.environment_url // .target_url // "-"), (.description // "-")] | join("\u001f")'); then
      api_failures=$((api_failures + 1))
      if [ "$api_failures" -ge 3 ]; then
        echo "::error::the GitHub API failed three times in a row while reading the status of deployment $id"
        echo "### Smoke FAILED: the GitHub API failed three times in a row while reading the status of deployment $id" >> "$GITHUB_STEP_SUMMARY"
        exit 1
      fi
      sleep 20
      continue
    fi
    api_failures=0
    IFS=$'\x1f' read -r state url description <<< "$row"
    # Vercel's text goes into a workflow command: one line, no `::`.
    description=$(printf '%s' "$description" | tr -d '\r\n' | sed 's/::/: :/g')
    echo "deployment $id: $state"
    case "$state" in
      success)
        echo "url=$url" >> "$GITHUB_OUTPUT"
        exit 0 ;;
      failure|error|inactive)
        echo "::error::Vercel's production deployment of $SHA ended as '$state' (a deployment problem, the database was not probed): $description ($url)"
        echo "### Smoke FAILED: Vercel's production deployment of \`$SHA\` ended as \`$state\` (a deployment problem, the database was not probed): $description ($url)" >> "$GITHUB_STEP_SUMMARY"
        exit 1 ;;
    esac
  else
    api_failures=0
    echo "no Production deployment of $SHA yet"
  fi
  sleep 20
done
echo "::error::no successful Vercel production deployment of $SHA within 30 minutes (last state: $state)"
echo "### Smoke FAILED: no successful Vercel production deployment of \`$SHA\` within 30 minutes (last state: \`$state\`)" >> "$GITHUB_STEP_SUMMARY"
exit 1
