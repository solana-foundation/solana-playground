// Smoke test for a deployment's database: `GET <url>/api/sync` must answer
// with `enabled: true` and `db: "ok"`. Anything else -- sync off,
// `db: "unreachable"`, a login page, a 5xx, a timeout -- is a failure, and the
// failure names the URL and the body it received, so a red run says which
// deployment and what it said.
//
//   node scripts/smoke-sync.mjs <deployment-url>
//
// `SMOKE_BYPASS_SECRET` is Vercel's "Protection Bypass for Automation" secret;
// when set it is sent as `x-vercel-protection-bypass`, which a per-deployment
// URL behind Deployment Protection needs. `GITHUB_STEP_SUMMARY`, when set,
// receives the verdict as Markdown. Used by the `smoke` job of
// `.github/workflows/client-v2.yml`.
import { appendFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;
const REQUEST_TIMEOUT_MS = 15000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One probe of `/api/sync`: `ok` only for status 200 and a body that parses
 * to `enabled: true` and `db: "ok"`. `body` is always the raw text, cut
 * to 500 characters (a login page is long), or the error message when no
 * response came.
 *
 * @param {string} baseUrl
 * @param {{ bypassSecret?: string, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<{ ok: boolean, status: number | undefined, body: string, reason: string }>}
 */
export async function probe(baseUrl, options = {}) {
  const { bypassSecret, fetchImpl = fetch } = options;
  const headers = { accept: "application/json" };
  if (bypassSecret) headers["x-vercel-protection-bypass"] = bypassSecret;

  let res;
  let text;
  try {
    const url = new URL("/api/sync", baseUrl);
    // `redirect: "manual"`: Deployment Protection answers a redirect to a login
    // page, and following it would report the login page's 200.
    res = await fetchImpl(url, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    text = await res.text();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      status: undefined,
      body: message,
      reason: "no response",
    };
  }

  const body = text.length > 500 ? `${text.slice(0, 500)}...` : text;
  if (res.status !== 200) {
    const protectedHint = [301, 302, 303, 307, 308, 401, 403].includes(
      res.status
    )
      ? " (Deployment Protection? set SMOKE_BYPASS_SECRET)"
      : "";
    return {
      ok: false,
      status: res.status,
      body,
      reason: `status ${res.status}${protectedHint}`,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, status: 200, body, reason: "body is not JSON" };
  }
  if (parsed?.enabled !== true || parsed?.db !== "ok") {
    return {
      ok: false,
      status: 200,
      body,
      reason: 'expected { "enabled": true, "db": "ok" }',
    };
  }
  return { ok: true, status: 200, body, reason: "" };
}

/**
 * Probes up to `attempts` times, so a cold start or a deployment still
 * warming does not fail the run; the last result is the verdict.
 *
 * @param {string} baseUrl
 * @param {{ bypassSecret?: string, fetchImpl?: typeof fetch, attempts?: number, delayMs?: number }} [options]
 */
export async function smoke(baseUrl, options = {}) {
  const { attempts = ATTEMPTS, delayMs = RETRY_DELAY_MS } = options;
  let result;
  for (let i = 1; i <= attempts; i += 1) {
    result = await probe(baseUrl, options);
    if (result.ok) return { ...result, attempts: i };
    if (i < attempts) await sleep(delayMs);
  }
  return { ...result, attempts };
}

const summaryOf = (url, result) =>
  result.ok
    ? `### Smoke: production database reachable\n\n- URL: ${url}\n- \`GET /api/sync\`: \`${result.body}\`\n`
    : `### Smoke: FAILED\n\n- URL: ${url}\n- Reason: ${
        result.reason
      }\n- Status: ${
        result.status ?? "none"
      }\n- Body: \`${result.body.replaceAll("`", "'")}\`\n- Attempts: ${
        result.attempts
      }\n`;

async function main(argv) {
  const url = argv[0];
  if (!url) {
    console.error("usage: node scripts/smoke-sync.mjs <deployment-url>");
    return 2;
  }
  const result = await smoke(url, {
    bypassSecret: process.env.SMOKE_BYPASS_SECRET || undefined,
    // Only the entrypoint test sets this, to keep a red case from waiting 10 s.
    delayMs: process.env.SMOKE_RETRY_DELAY_MS
      ? Number(process.env.SMOKE_RETRY_DELAY_MS)
      : undefined,
  });
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryOf(url, result));
  }
  if (result.ok) {
    console.log(`smoke-sync: ok ${url} -> ${result.body}`);
    return 0;
  }
  console.error(
    `smoke-sync: FAIL ${url}: ${result.reason}; status ${
      result.status ?? "none"
    }; body: ${result.body}`
  );
  return 1;
}

// Both sides resolved: `process.argv[1]` is not a realpath and `import.meta.url`
// is, so under a symlinked directory a plain comparison is false and the script
// would exit 0 without probing anything.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  process.exitCode = await main(process.argv.slice(2));
}
