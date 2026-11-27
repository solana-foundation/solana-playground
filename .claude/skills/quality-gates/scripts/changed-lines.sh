#!/usr/bin/env bash
# Prints `<path>\t<line number>\t<line>` rows; kept out of SKILL.md because Claude Code replaces `$0`, `$1`... there with the skill's arguments.
# Usage: changed-lines.sh pr <root> <merge-base>
#        changed-lines.sh files <root> <path>...
set -euo pipefail

mode=$1
root=$2
shift 2
excludes=(':(exclude)client/' ':(exclude)server/' ':(exclude)wasm/' ':(exclude).github/reviews/')

every_line() {
  for path in "$@"; do
    awk -v p="$path" '{print p "\t" FNR "\t" $0}' "$root/$path"
  done
}

case $mode in
  pr)
    git -C "$root" --no-pager diff --no-ext-diff --no-color -U0 "$1" -- . "${excludes[@]}" |
      awk '/^diff --git /{h=1; next} h && /^\+\+\+ /{f=substr($0,7); next} /^@@/{h=0; split($3,a,","); n=substr(a[1],2); next} !h && /^\+/{print f "\t" n "\t" substr($0,2); n++}'
    untracked=()
    while IFS= read -r -d '' path; do untracked+=("$path"); done < <(git -C "$root" ls-files -z --others --exclude-standard -- . "${excludes[@]}")
    every_line ${untracked[@]+"${untracked[@]}"}
    ;;
  files)
    every_line "$@"
    ;;
  *)
    echo "changed-lines.sh: unknown mode $mode; use pr or files" >&2
    exit 1
    ;;
esac
