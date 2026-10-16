/* Serve the built registry to `shadcn add`, from the repo.
 *
 * registry.json names its dependencies @playground/<name>, and a consumer's
 * components.json maps @playground to this server, so an install never
 * reaches the public host. A missing item answers 404 JSON, not a page, so
 * shadcn reports it as not found; any other failure is logged and answers
 * 500, so a broken build is not mistaken for a typo in a name.
 *
 * Started by client-v2's ds-add with an IPC channel, it sends one message
 * over that channel once it accepts requests (ds-add waits for any message,
 * so no text has to match), and exits when its parent goes, so a killed
 * install never leaves it holding the port.
 *
 *   npm run build:registry && npm run registry:serve     PORT=3010 by default
 */
import http from "node:http"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, "../registry-dist/r")
const PORT = Number(process.env.PORT || 3010)

http
  .createServer(async (req, res) => {
    const pathname = (req.url ?? "/").split("?")[0]
    const item = pathname.match(/^\/r\/([a-z0-9-]+)\.json$/)?.[1]
    try {
      const body = item && (await readFile(path.join(ROOT, `${item}.json`)))
      if (body) send(res, 200, body)
      else send(res, 404, { error: "Not Found", message: pathname })
    } catch (err) {
      // A missing item is the caller's mistake; anything else (no
      // registry-dist, a wrong ROOT, EACCES) is this server's, and says so.
      if (err.code === "ENOENT" && existsSync(ROOT)) {
        send(res, 404, { error: "Not Found", message: pathname })
      } else {
        console.error(err.message)
        send(res, 500, { error: "Internal Server Error", message: err.message })
      }
    }
    console.log(res.statusCode, pathname)
  })
  .on("error", (err) => {
    console.error(err.message)
    process.exit(1)
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`registry on http://127.0.0.1:${PORT}/r`)
    process.send?.("ready")
  })

if (process.send) process.on("disconnect", () => process.exit(0))

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(Buffer.isBuffer(body) ? body : JSON.stringify(body))
}
