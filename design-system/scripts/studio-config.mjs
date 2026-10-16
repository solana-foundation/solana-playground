/* Write Studio's config for Playground, with the component map read off the
 * design system's own files: every data-slot a component carries becomes a
 * name Studio can say when you pick it, and every cva variant and status a
 * name more specific than that.
 *
 *   node scripts/studio-config.mjs [out]      default dist/studio.config.js
 */
import { readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const UI = path.resolve(here, "../src/components/ui")
const out = process.argv[2] || path.resolve(here, "../dist/studio.config.js")
const registry = JSON.parse(await readFile(path.resolve(here, "../registry.json"), "utf8"))
/* Ours are the files the registry ships */
const OURS = new Set(registry.items.flatMap((i) => i.files.map((f) => path.basename(f.path, ".tsx"))))

const title = (slot) => slot.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase())

/* The keys of the object that opens at `from` (the index of its "{") */
function keysOf(src, from) {
  let depth = 0, i = from, keys = [], line = ""
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === "{") depth++
    else if (c === "}") { depth--; if (depth === 0) break }
    else if (c === '"' || c === "'" || c === "`") { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++ } continue }
    if (depth === 1) {
      if (c === "\n") line = ""
      else line += c
      const m = line.match(/^\s*"?([a-z0-9-]+)"?\s*:$/)
      if (m) keys.push(m[1])
    }
  }
  return keys
}
function slotBefore(src, index) {
  const all = [...src.slice(0, index).matchAll(/data-slot="([a-z0-9-]+)"/g)]
  return all.length ? all[all.length - 1][1] : null
}

const specific = []
const plain = []
for (const file of (await readdir(UI)).filter((f) => f.endsWith(".tsx")).sort()) {
  const src = await readFile(path.join(UI, file), "utf8")
  const base = file.replace(/\.tsx$/, "")
  const who = OURS.has(base) ? " · Playground" : ""
  /* variants: each cva's `variant` keys, named after the part that uses it */
  for (const m of src.matchAll(/const (\w+) = cva\(/g)) {
    const at = src.indexOf("variant:", src.indexOf("variants:", m.index))
    if (at < 0) continue
    const use = src.indexOf(m[1] + "(", m.index + m[0].length)
    const slot = use > 0 ? slotBefore(src, use) : null
    if (!slot) continue
    for (const v of keysOf(src, src.indexOf("{", at))) {
      if (v === "default") continue
      specific.push({ name: `${title(slot)}, ${v.replace(/-/g, " ")}${who}`, sel: `[data-slot="${slot}"][data-variant="${v}"]` })
    }
  }
  /* statuses: a part with data-status, and the union its prop allows */
  const st = src.indexOf("data-status=")
  const union = src.match(/status\??:\s*((?:"[a-z-]+"\s*\|?\s*)+)/)
  if (st > 0 && union) {
    const slot = slotBefore(src, st)
    for (const s of [...union[1].matchAll(/"([a-z-]+)"/g)].map((x) => x[1]))
      specific.push({ name: `${title(slot)}, ${s}${who}`, sel: `[data-slot="${slot}"][data-status="${s}"]` })
  }
  const slots = [...new Set([...src.matchAll(/data-slot="([a-z0-9-]+)"/g)].map((x) => x[1]))]
  for (const s of slots) plain.push({ name: title(s) + who, sel: `[data-slot="${s}"]` })
}

const system = specific.concat(plain)
const template = await readFile(path.resolve(here, "../studio/studio.config.template.js"), "utf8")
await writeFile(out, template.replace("__SYSTEM__", JSON.stringify(system, null, 2).replace(/\n/g, "\n  ")))
console.log(`studio config: ${system.length} names (${specific.length} variants and statuses) → ${path.relative(process.cwd(), out)}`)
