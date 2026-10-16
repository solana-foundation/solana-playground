/* Bake the drawn page into dist/index.html.
 *
 * Studio reads the specimens by fetching this page and parsing it, without
 * running it. So the page ships with a copy of itself as the browser drew
 * it: every block, every specimen, the values the swatches read. The app's
 * first render replaces the copy, so nothing is hydrated and nothing can
 * disagree with it.
 *
 *   node scripts/snapshot.mjs            after vite build
 */
import http from "node:http"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
// client-v2 already carries Playwright for its e2e tests.
const PLAYWRIGHT = process.env.PLAYWRIGHT || path.resolve(here, "../../client-v2/node_modules/playwright/index.mjs")
const { chromium } = await import(pathToFileURL(PLAYWRIGHT).href)

const DIST = path.resolve(here, "../dist")
const BASE = "/design-system/"
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2" }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x")
  let p = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : ""
  if (!p || p.endsWith("/")) p += "index.html"
  const file = path.join(DIST, p)
  try {
    const body = await readFile(file)
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" })
    res.end(body)
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise((r) => server.listen(0, "127.0.0.1", r))
const port = server.address().port

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on("pageerror", (e) => errors.push(e.message))
await page.goto(`http://127.0.0.1:${port}${BASE}`, { waitUntil: "load" })
await page.waitForSelector("html[data-ds-ready]", { timeout: 30000 })
await page.waitForTimeout(400)
const { root, blocks } = await page.evaluate(() => ({
  root: document.getElementById("root").innerHTML,
  blocks: document.querySelectorAll("[data-ds-block]").length,
}))
await browser.close()
server.close()

if (errors.length) {
  console.error("The page threw while drawing:\n  " + errors.join("\n  "))
  process.exit(1)
}

const indexFile = path.join(DIST, "index.html")
const html = await readFile(indexFile, "utf8")
if (!html.includes('<div id="root"></div>')) throw new Error("dist/index.html has no empty #root to fill")
/* a function, not a string: the markup is full of $ signs ('$' in a class,
   for one) that a replacement string would read as patterns */
await writeFile(indexFile, html.replace('<div id="root"></div>', () => `<div id="root">${root}</div>`))
console.log(`snapshot: ${blocks} blocks, ${(root.length / 1024).toFixed(0)} KB of markup`)
