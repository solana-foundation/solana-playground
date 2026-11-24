// Fails a Vercel build whose sign-in environment mixes roles (HOO-2816).
//
// Previews sign in through a staging app, the OAuth proxy's host, never
// through production: production holds no AUTH_OAUTH_PROXY_* variable, the
// host says so with AUTH_OAUTH_PROXY_HOST=true, and a preview never does. One
// value is never two secrets: AUTH_SECRET signs a deployment's cookies, the
// proxy secret seals what the host hands a preview, and every preview holds
// the latter. How it is deployed: docs/deploy-client-vercel.md, "Sign-in on
// previews". Only vercel.json's buildCommand (scripts/vercel-build.sh) runs
// it. Names only, never values: the build log is readable by the team.

/** Set and non-empty: a local `vercel pull` delivers a Sensitive variable as "" */
const value = (name) => process.env[name] || undefined;

const preview = process.env.VERCEL_ENV === "preview";
const hostFlag = value("AUTH_OAUTH_PROXY_HOST");
const proxyURL = value("AUTH_OAUTH_PROXY_URL");
const proxySecret = value("AUTH_OAUTH_PROXY_SECRET");

const problems = [];

if (hostFlag !== undefined && hostFlag !== "true") {
  problems.push(
    'AUTH_OAUTH_PROXY_HOST is set but not exactly "true"; unset it, or set it ' +
      "to true on the staging sign-in host only."
  );
}
const host = hostFlag === "true";

if (preview) {
  if (host) {
    problems.push(
      "AUTH_OAUTH_PROXY_HOST is set on a preview. Only the staging sign-in " +
        "host sets it; a preview points AUTH_OAUTH_PROXY_URL at that host."
    );
  }
} else if (host) {
  if (!proxySecret) {
    problems.push(
      "AUTH_OAUTH_PROXY_HOST=true without AUTH_OAUTH_PROXY_SECRET: the host " +
        "cannot seal what it hands a preview."
    );
  }
  if (proxyURL) {
    problems.push(
      "AUTH_OAUTH_PROXY_URL is set on the sign-in host. Only a preview names " +
        "the host; unset it here."
    );
  }
} else {
  const held = [
    proxyURL && "AUTH_OAUTH_PROXY_URL",
    proxySecret && "AUTH_OAUTH_PROXY_SECRET",
  ].filter(Boolean);
  if (held.length) {
    problems.push(
      `${held.join(" and ")} set on a deployment that is not the staging ` +
        "sign-in host. Production holds no AUTH_OAUTH_PROXY_* variable: " +
        "previews sign in through the staging app, never through production. " +
        "Delete them here, or set AUTH_OAUTH_PROXY_HOST=true if this project " +
        "is the staging app."
    );
  }
}

if (proxySecret && proxySecret === value("AUTH_SECRET")) {
  problems.push(
    "AUTH_SECRET equals AUTH_OAUTH_PROXY_SECRET. Every preview holds the " +
      "proxy secret, so it must never sign a deployment's cookies; generate " +
      "each with `openssl rand -base64 32`."
  );
}

if (problems.length) {
  for (const problem of problems) console.error(`check-auth-env: ${problem}`);
  process.exit(1);
}
