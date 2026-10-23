// Fails a Vercel build that has no AGENT_API_KEY, so a deployment cannot ship
// with the assistant's default backend off, and a production build that has
// the key without sign-in or without AUTH_BASE_URL, where /api/agent would
// refuse every turn or check origins against a per-deployment hostname. A
// preview may run without either: GET /api/agent then reports no backend.
// Only vercel.json's buildCommand runs it: local, CI and e2e builds need no key.
// The constants file, not `server.mjs`: that one loads Better Auth and the pool
import { SIGN_IN_ENV } from "../src/features/auth/config.mjs";

// Vercel's build machine sets CI; a local `vercel build` does not, and pulls a Secret as ""
const onVercel = !!process.env.CI;
const production = process.env.VERCEL_ENV === "production";

/** Whether a variable counts as set: non-empty on Vercel, as `read()` in server-env.mjs treats "" as unset */
const isSet = (name) =>
  onVercel ? !!process.env[name] : process.env[name] !== undefined;

const fail = (message) => {
  console.error(`check-agent-env: ${message}`);
  process.exit(1);
};

if (!isSet("AGENT_API_KEY")) {
  fail(
    "AGENT_API_KEY is unset or empty. Set it in the Vercel project " +
      "environment, or the assistant backend ships disabled."
  );
}

const missing = SIGN_IN_ENV.filter((name) => !isSet(name));
if (missing.length) {
  const message =
    `AGENT_API_KEY is set but sign-in is not: ${missing.join(", ")} unset ` +
    "or empty. /api/agent answers only signed-in users, so this deployment " +
    "serves no default backend.";
  if (production) fail(message);
  console.warn(`check-agent-env: ${message}`);
}

if (production) {
  const baseUrl = process.env.AUTH_BASE_URL;
  if (!isSet("AUTH_BASE_URL")) {
    fail(
      "AUTH_BASE_URL is unset or empty. Without it the session cookie and " +
        "the origin check on /api/agent, /api/mcp and the sync routes use " +
        "Vercel's own hostnames for the deployment, not the production " +
        "domain, so sign-in there is refused."
    );
  }
  if (baseUrl && !URL.canParse(baseUrl)) {
    fail(
      `AUTH_BASE_URL is not a URL: "${baseUrl}". Set the production origin, ` +
        "scheme included."
    );
  }
}

const empty = ["AGENT_API_KEY", ...SIGN_IN_ENV, "AUTH_BASE_URL"].filter(
  (name) => process.env[name] === ""
);
if (!onVercel && empty.length) {
  console.warn(
    `check-agent-env: ${empty.join(", ")} empty here. A local \`vercel ` +
      "build` pulls a Secret as empty, so this check cannot tell one from a " +
      "value never set; Vercel's own build treats an empty value as unset."
  );
}
