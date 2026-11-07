#!/usr/bin/env bash
# Merge upstream (solpg/master) into foundation/master on a sync branch and open or update its PR.
#
# Usage:
#   sync-upstream.sh message <from> <to>   print the commit message for from..to
#   sync-upstream.sh synced-to <subject>   print the <to> hash a sync commit subject names
#   sync-upstream.sh prepare               fetch, merge into a sync worktree, commit when nothing conflicts
#   sync-upstream.sh commit [<worktree>]   commit the merge after conflicts were resolved by hand
#   sync-upstream.sh publish [<worktree>]  push the sync branch and open or update the PR
#
# Env overrides: UPSTREAM_REMOTE (solpg), UPSTREAM_BRANCH (master), TARGET_REMOTE (foundation),
#   TARGET_BRANCH (master), PUSH_REMOTE (hoodieshq), SYNC_BRANCH_PREFIX (sync/),
#   WORKTREE_ROOT (<main checkout>/.worktrees), SYNC_NO_SIGN (unset; 1 commits unsigned, dry runs only).
set -euo pipefail

UPSTREAM_REMOTE=${UPSTREAM_REMOTE:-solpg}
UPSTREAM_BRANCH=${UPSTREAM_BRANCH:-master}
TARGET_REMOTE=${TARGET_REMOTE:-foundation}
TARGET_BRANCH=${TARGET_BRANCH:-master}
PUSH_REMOTE=${PUSH_REMOTE:-hoodieshq}
SYNC_BRANCH_PREFIX=${SYNC_BRANCH_PREFIX:-sync/}

SUBJECT_PREFIX='chore(upstream): '
# Matches the squash subjects ("sync to") and the merge subjects ("merge <remote>/<branch> to").
SUBJECT_RE='^chore\(upstream\): (sync|merge [^ ]+) to [0-9a-f]+ \(([0-9a-f]+)\.\.([0-9a-f]+)\)$'

# "<path> <ERE>": a hit is content the merge brings back that foundation/master lacks; no ERE means the path itself.
GUARDS=(
  'compose.yaml ^x-client:'
  'compose.yaml ^  client(-prod|-standalone)?:'
  'client-v2/scripts/update-static.mjs'
  '.gitmodules ^\[submodule "client/public"\]'
  'server/src/routes/share.rs'
)

repo=$(git rev-parse --show-toplevel)
main_checkout=$(dirname "$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir)")
WORKTREE_ROOT=${WORKTREE_ROOT:-$main_checkout/.worktrees}

die() { echo "error: $*" >&2; exit 1; }

short() { git -C "$repo" rev-parse --short=8 "$1"; }

sign_flag() { if [[ ${SYNC_NO_SIGN:-} == 1 ]]; then echo --no-gpg-sign; else echo -S; fi; }

# Message body: one "- <hash8> <subject>" per commit, oldest first; body lines become "  * " sub-bullets.
message() {
  local from=$1 to=$2 from8 to8 sha
  from8=$(short "$from")
  to8=$(short "$to")
  printf '%smerge %s/%s to %s (%s..%s)\n\n' "$SUBJECT_PREFIX" "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH" "$to8" "$from8" "$to8"
  for sha in $(git -C "$repo" rev-list --reverse "$from..$to"); do
    git -C "$repo" log -1 --format='- %h %s' --abbrev=8 "$sha"
    git -C "$repo" log -1 --format='%b' "$sha" | sed -E '/^[[:space:]]*$/d; s/^\* ?//; s/^/  * /'
  done
}

synced_to() {
  [[ $1 =~ $SUBJECT_RE ]] || return 1
  printf '%s\n' "${BASH_REMATCH[3]}"
}

# Foundation merges PRs by squash or rebase, so the previous upstream tip survives only in the subject.
previous_to() {
  local subject to
  subject=$(git -C "$repo" log -1 --format=%s -E --grep='^chore\(upstream\): (sync|merge [^ ]+) to ' "$TARGET_REMOTE/$TARGET_BRANCH")
  to=$(synced_to "$subject") || die "no upstream sync subject on $TARGET_REMOTE/$TARGET_BRANCH"
  git -C "$repo" rev-parse --verify --quiet "$to^{commit}" || die "previous sync point $to is unknown; fetch $UPSTREAM_REMOTE"
}

repo_slug() { gh repo view "$(git -C "$repo" remote get-url "$1")" --json nameWithOwner --jq .nameWithOwner; }

# Head branch of an open sync PR from the push remote, so a rerun updates that PR instead of opening another.
open_sync_branch() {
  local owner=$1 slug=$2
  gh pr list --repo "$slug" --base "$TARGET_BRANCH" --state open --limit 100 \
    --json headRefName,headRepositoryOwner,title |
    jq -r --arg owner "$owner" --arg prefix "${SYNC_BRANCH_PREFIX}merge-" --arg title "${SUBJECT_PREFIX}merge " \
      '[.[] | select(.headRepositoryOwner.login == $owner and (.headRefName | startswith($prefix)) and (.title | startswith($title)))][0].headRefName // empty'
}

worktree_of() { git -C "$repo" worktree list --porcelain | awk -v b="refs/heads/$1" '$1=="worktree"{w=$2} $1=="branch"&&$2==b{print w}'; }

state_dir() { printf '%s/sync-upstream\n' "$(git -C "$1" rev-parse --path-format=absolute --git-dir)"; }

# client/ is upstream's client, which the fork keeps at its own state until it is deleted.
restore_client() {
  local wt=$1 target=$2
  git -C "$wt" rm -r -q --cached --ignore-unmatch -- client
  if git -C "$wt" cat-file -e "$target:client" 2>/dev/null; then
    git -C "$wt" reset -q "$target" -- client
    git -C "$wt" checkout -- client
  fi
  git -C "$wt" clean -fdq -- client
}

guard() {
  local wt=$1 target=$2 entry path re hits=()
  for entry in "${GUARDS[@]}"; do
    read -r path re <<< "$entry"
    if [[ -z $re ]]; then
      git -C "$wt" cat-file -e ":$path" 2>/dev/null || continue
      git -C "$wt" cat-file -e "$target:$path" 2>/dev/null && continue
    else
      local merged base=''
      merged=$(git -C "$wt" show ":$path" 2>/dev/null) || continue
      grep -qE "$re" <<< "$merged" || continue
      base=$(git -C "$wt" show "$target:$path" 2>/dev/null) || true
      grep -qE "$re" <<< "$base" && continue
    fi
    hits+=("$entry")
  done
  [[ ${#hits[@]} -eq 0 ]] || die "the merge brings back what $TARGET_REMOTE/$TARGET_BRANCH removed: $(printf '\n  %s' "${hits[@]}")"
}

commit_merge() {
  local wt=$1 state target to unmerged
  state=$(state_dir "$wt")
  [[ -f $state/target && -f $state/to ]] || die "no prepared sync in $wt; run prepare"
  target=$(cat "$state/target")
  to=$(cat "$state/to")
  [[ $(git -C "$wt" rev-parse -q --verify MERGE_HEAD) == "$to" ]] || die "no merge of $(short "$to") in progress in $wt; run prepare"

  unmerged=$(git -C "$wt" diff --name-only --diff-filter=U)
  [[ -z $unmerged ]] || die "resolve these in $wt, stage them, then run: $0 commit $wt$(printf '\n  %s' $unmerged)"
  git -C "$wt" diff --cached --quiet "$target" -- client || die "client/ differs from $(short "$target"); restore it with: git -C $wt checkout $target -- client"
  guard "$wt" "$target"

  git -C "$wt" commit -q "$(sign_flag)" -F "$state/message.txt"
  git -C "$wt" rev-parse HEAD > "$state/commit"
  echo "merge commit $(git -C "$wt" rev-parse --short=8 HEAD) on $(git -C "$wt" symbolic-ref --short HEAD) in $wt"
  echo "next, after the user's go-ahead: $0 publish $wt"
}

prepare() {
  git -C "$repo" fetch --quiet "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH"
  git -C "$repo" fetch --quiet "$TARGET_REMOTE" "$TARGET_BRANCH"

  local target from to to8 branch owner slug wt state lease
  target=$(git -C "$repo" rev-parse "$TARGET_REMOTE/$TARGET_BRANCH")
  to=$(git -C "$repo" rev-parse "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH")
  from=$(previous_to)
  [[ $from != "$to" ]] || die "nothing to sync: $TARGET_REMOTE/$TARGET_BRANCH already has $(short "$to")"
  git -C "$repo" merge-base --is-ancestor "$from" "$to" || die "previous sync point $(short "$from") is not an ancestor of $UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
  to8=$(short "$to")

  owner=$(gh repo view "$(git -C "$repo" remote get-url "$PUSH_REMOTE")" --json owner --jq .owner.login)
  slug=$(repo_slug "$TARGET_REMOTE")
  branch=$(open_sync_branch "$owner" "$slug")
  branch=${branch:-${SYNC_BRANCH_PREFIX}merge-$to8}

  # Rebuild from the newest target: the previous merge commit is replaced, never stacked on.
  wt=$(worktree_of "$branch")
  if [[ -n $wt ]]; then
    git -C "$wt" rev-parse -q --verify MERGE_HEAD > /dev/null && die "a merge is in progress in $wt; finish it with commit or run: git -C $wt merge --abort"
    [[ -z $(git -C "$wt" status --porcelain) ]] || die "$wt has uncommitted changes"
    git -C "$wt" checkout -q -B "$branch" "$target"
  else
    wt=$WORKTREE_ROOT/$branch
    [[ ! -e $wt ]] || die "$wt exists but does not hold $branch"
    git -C "$repo" worktree add -q -B "$branch" "$wt" "$target"
  fi

  state=$(state_dir "$wt")
  mkdir -p "$state"
  printf '%s\n' "$target" > "$state/target"
  printf '%s\n' "$to" > "$state/to"
  rm -f "$state/commit"
  # Lease on the remote tip seen now, so publish refuses to overwrite a push made after prepare.
  lease=$(git -C "$repo" ls-remote "$PUSH_REMOTE" "refs/heads/$branch" | cut -f1)
  printf '%s\n' "$lease" > "$state/lease"
  message "$from" "$to" > "$state/message.txt"

  echo "range: $(short "$from")..$to8, $(git -C "$repo" rev-list --count "$from..$to") commits; base $(short "$target"); branch $branch in $wt"
  # A conflicting merge exits non-zero; the unmerged paths are reported by commit_merge.
  git -C "$wt" merge --quiet --no-commit --no-ff -X theirs "$to" || true
  restore_client "$wt" "$target"
  echo
  cat "$state/message.txt"
  echo
  commit_merge "$wt"
}

publish() {
  local wt=$1 state branch commit lease owner slug existing
  state=$(state_dir "$wt")
  [[ -f $state/commit ]] || die "no committed sync in $wt; run prepare"
  commit=$(cat "$state/commit")
  branch=$(git -C "$wt" symbolic-ref --short HEAD)
  [[ $(git -C "$wt" rev-parse HEAD) == "$commit" ]] || die "$branch moved since prepare; run prepare again"
  git -C "$wt" cat-file commit "$commit" | grep -q '^gpgsig' || die "$(short "$commit") is unsigned; run prepare again without SYNC_NO_SIGN"
  git -C "$wt" diff --quiet "$(cat "$state/target")" "$commit" -- client || die "client/ differs from $TARGET_REMOTE/$TARGET_BRANCH"

  lease=$(cat "$state/lease")
  git -C "$wt" push --force-with-lease="refs/heads/$branch:$lease" "$PUSH_REMOTE" "$branch"

  owner=$(gh repo view "$(git -C "$wt" remote get-url "$PUSH_REMOTE")" --json owner --jq .owner.login)
  slug=$(repo_slug "$TARGET_REMOTE")
  tail -n +3 "$state/message.txt" > "$state/body.md"
  existing=$(gh pr list --repo "$slug" --head "$branch" --base "$TARGET_BRANCH" --state open --json url,headRepositoryOwner |
    jq -r --arg owner "$owner" '[.[] | select(.headRepositoryOwner.login == $owner)][0].url // empty')
  if [[ -n $existing ]]; then
    gh pr edit "$existing" --title "$(head -n1 "$state/message.txt")" --body-file "$state/body.md"
    echo "$existing"
  else
    gh pr create --repo "$slug" --base "$TARGET_BRANCH" --head "$owner:$branch" \
      --title "$(head -n1 "$state/message.txt")" --body-file "$state/body.md"
  fi
}

worktree_arg() { git -C "${1:-$PWD}" rev-parse --show-toplevel; }

case ${1:-} in
  message) [[ $# -eq 3 ]] || die "usage: $0 message <from> <to>"; message "$2" "$3" ;;
  synced-to) [[ $# -eq 2 ]] || die "usage: $0 synced-to <subject>"; synced_to "$2" || die "not a sync subject: $2" ;;
  prepare) prepare ;;
  commit) commit_merge "$(worktree_arg "${2:-}")" ;;
  publish) publish "$(worktree_arg "${2:-}")" ;;
  *) die "usage: $0 message <from> <to> | synced-to <subject> | prepare | commit [<worktree>] | publish [<worktree>]" ;;
esac
