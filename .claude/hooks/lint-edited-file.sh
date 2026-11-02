#!/usr/bin/env sh
# PostToolUse hook for Edit|Write: hands the edited file's lint messages to the agent as additionalContext, never blocking.
if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"lint-changed: jq not found; lint messages not checked"}}'
  exit 0
fi
file=$(jq -r '.tool_input.file_path // empty')
[ -f "$file" ] || exit 0
# The file's own checkout, so an edit in a worktree runs that worktree's script and config
root=$(git -C "$(dirname "$file")" rev-parse --show-toplevel 2>/dev/null) || exit 0
case $file in
  "$root"/*) ;;
  *) exit 0 ;;
esac
script=$root/client-v2/scripts/lint-changed.sh
[ -x "$script" ] || exit 0
# stderr goes to the checkout's ignored cache; without node_modules the script says so on stdout
err=/dev/null
cache=$root/client-v2/node_modules/.cache
if [ -d "$root/client-v2/node_modules" ] && mkdir -p "$cache"; then
  err=$cache/lint-edited-file.$$.err
fi
out=$("$script" "${file#"$root"/}" 2>"$err")
status=$?
stderr=""
[ "$err" = /dev/null ] || { stderr=$(tail -n 5 "$err"); rm -f "$err"; }
if [ "$status" -ne 0 ] || { [ -z "$out" ] && [ -n "$stderr" ]; }; then
  out="lint-changed failed: exit $status${stderr:+: $stderr}"
fi
[ -n "$out" ] || exit 0
jq -n --arg out "$out" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: ("ESLint on the edited file. A new warning fails yarn lint once the total passes the --max-warnings cap; an error line always fails it:\n" + $out)
  }
}'
