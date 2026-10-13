#!/bin/bash
# Put the design system, the product and Studio on one site, and publish it:
# https://solana-playground-ds.vercel.app
#
#   bash scripts/site.sh            build everything, then deploy
#   NO_DEPLOY=1 bash scripts/site.sh   assemble only, into the stage below
#
# The product is the proposal's own build, copied from its deploy stage, so
# this site shows exactly what solana-playground-proposal shows. Studio's
# tools come from ~/Studio; the only Playground file among them is the
# config this repo generates.
set -euo pipefail
DS="$(cd "$(dirname "$0")/.." && pwd)"
PRODUCT="${PRODUCT:-$HOME/.solana-playground-proposal/site}"
STUDIO="${STUDIO:-$HOME/Studio/tools}"
STAGE="$HOME/.solana-playground-ds/solana-playground-ds"

cd "$DS"
[ -n "${SKIP_BUILD:-}" ] || npm run build

mkdir -p "$STAGE"
rsync -a --delete --exclude '.vercel' --exclude 'vercel.json' "$PRODUCT/" "$STAGE/"
rsync -a --delete "$DS/dist/" "$STAGE/design-system/"
rsync -a --delete "$DS/registry-dist/r/" "$STAGE/r/"
mkdir -p "$STAGE/studio"
cp "$STUDIO"/*.js "$STUDIO"/*.css "$STAGE/studio/"
node "$DS/scripts/studio-config.mjs" "$STAGE/studio/studio.config.js"
rm -f "$STAGE/design-system/studio.config.js"

# The five tags Studio's server would add, at the end of each page's body
node - "$STAGE/index.html" "$STAGE/design-system/index.html" <<'JS'
const fs = require("fs")
const TAGS = ["studio.config.js", "annotate.js", "components.js", "narrate.js", "studio.js"]
  .map((f) => `<script src="/studio/${f}"></script>`).join("\n")
for (const file of process.argv.slice(2)) {
  let html = fs.readFileSync(file, "utf8")
  if (html.includes("/studio/studio.js")) continue
  html = html.replace(/<\/body>(?![\s\S]*<\/body>)/i, () => TAGS + "\n</body>")
  fs.writeFileSync(file, html)
}
JS

cat > "$STAGE/vercel.json" <<'JSON'
{
  "rewrites": [
    { "source": "/design-system", "destination": "/design-system/index.html" },
    { "source": "/((?!design-system/|studio/|r/).*)", "destination": "/index.html" }
  ],
  "headers": [
    { "source": "/r/(.*)", "headers": [{ "key": "Access-Control-Allow-Origin", "value": "*" }] },
    { "source": "/studio/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" }] },
    { "source": "/design-system/index.html", "headers": [{ "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" }] }
  ]
}
JSON

echo "assembled: $STAGE"
[ -z "${NO_DEPLOY:-}" ] || exit 0
: "${VERCEL_SCOPE:?set VERCEL_SCOPE to the Vercel team slug to deploy under}"
cd "$STAGE"
npx --yes vercel@latest deploy --prod --yes --scope "$VERCEL_SCOPE"
