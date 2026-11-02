#!/usr/bin/env sh
# Shows a change its own lint warnings; always exits 0, since `yarn lint`'s `--max-warnings` is the gate.
# Usage: client-v2/scripts/lint-changed.sh <repo-relative path>...
client=$(cd "$(dirname "$0")/.." && pwd)
root=$(dirname "$client")

for path do
  shift
  case $path in
    client-v2/src/* | client-v2/api/* | client-v2/e2e/*) ;;
    *) continue ;;
  esac
  case $path in
    *.ts | *.tsx | *.mjs | *.mts) ;;
    *) continue ;;
  esac
  [ -f "$root/$path" ] || continue
  set -- "$@" "${path#client-v2/}"
done
[ $# -gt 0 ] || exit 0

# Notices go to stdout, the stream the Claude Code hook forwards to the agent
notice() {
  echo "lint-changed: $1; lint messages not checked"
  exit 0
}

eslint=$client/node_modules/.bin/eslint
[ -x "$eslint" ] || notice "client-v2/node_modules/.bin/eslint missing (run yarn install in client-v2)"
command -v jq >/dev/null 2>&1 || notice "jq not found"

# Exit 1 means lint errors, which the report lists; above 1, ESLint itself failed
report=$(cd "$client" && "$eslint" -f json "$@")
status=$?
[ "$status" -le 1 ] || notice "ESLint exited $status (run yarn lint in client-v2 for its error)"
# Node can exit 1 before ESLint writes anything, which would read as a clean file
printf '%s\n' "$report" | jq -e 'type == "array"' >/dev/null 2>&1 ||
  notice "ESLint exited $status without a JSON report (run yarn lint in client-v2 for its error)"

printf '%s\n' "$report" | jq -r --arg root "$root/" '
  def severity: if .severity == 2 then "error" else "warn" end;
  [.[] | .filePath as $file | .messages[]
    | .file = ($file | ltrimstr($root)) | .level = severity | .rule = (.ruleId // "eslint")] as $all
  | ($all[] | "\(.file):\(.line // 0):\(.column // 0) \(.level) \(.rule) \(.message)"),
    ($all | group_by([.level, .rule]) | .[] | "\(length) \(.[0].level) \(.[0].rule)")
' || notice "jq could not read the ESLint report"
exit 0
