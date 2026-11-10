/* Write the icon set as SVG files, one per name, for Figma and for dev.
 *
 * The names and glyphs are read from src/components/ui/icon.tsx, so the
 * files cannot drift from what the product draws. Each file is the 24 grid
 * at stroke 1.5 in currentColor.
 *
 *   npm run icons:export     writes public/icons/<name>.svg
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import * as lucide from "lucide-react"

const DS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const OUT = path.join(DS, "public/icons")
const source = readFileSync(path.join(DS, "src/components/ui/icon.tsx"), "utf8")
const block = source.slice(source.indexOf("const ICONS = {"), source.indexOf("type IconName"))
const pairs = [...block.matchAll(/^\s+"?([a-z-]+)"?: ([A-Za-z0-9]+),$/gm)]

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
for (const [, name, glyph] of pairs) {
  const svg = renderToStaticMarkup(createElement(lucide[glyph], { strokeWidth: 1.5 }))
    .replace(/ class="[^"]*"/, "")
  writeFileSync(path.join(OUT, `${name}.svg`), svg + "\n")
}
console.log(`${pairs.length} icons in public/icons`)
