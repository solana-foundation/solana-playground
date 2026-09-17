/**
 * Where the sign-in popup lands once Better Auth has set the session cookie.
 *
 * Better Auth's `callbackURL` points here, so by the time this renders the
 * exchange is done and the cookie is on our origin. Cookies are per-origin,
 * not per-window, so the opener can already read the session -- this page only
 * has to say "finished" and close.
 *
 * That is the whole difference from the legacy `result-page.mjs` next door,
 * which carries an access token in its body and needs a CSP to contain it.
 * Nothing secret travels here, so a forged message can at worst make the app
 * re-read a session it either has or does not.
 *
 * Every outcome must post and close: a response that does nothing leaves the
 * popup open and the app waiting until its timeout.
 */
import {
  AUTH_CHANNEL_NAME,
  AUTH_MESSAGE_TYPE,
} from "../src/features/auth/config.mjs";

/** Bounds what can be echoed back into the page */
const NONCE_PATTERN = /^[0-9a-f]{1,64}$/;

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
export default function handler(req, res) {
  const url = new URL(req.url, "http://localhost");
  const raw = url.searchParams.get("nonce") ?? "";
  // Echoed into a <script>, so it is constrained rather than escaped
  const nonce = NONCE_PATTERN.test(raw) ? raw : "";

  const payload = JSON.stringify({
    type: AUTH_MESSAGE_TYPE,
    ...(nonce ? { nonce } : {}),
  });

  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-content-type-options", "nosniff");
  res.end(page(payload));
}

/**
 * Prefer the opener -- one window, pinned by targetOrigin. A BroadcastChannel
 * reaches every same-origin context, so it is the fallback for when COOP
 * severed the opener across the GitHub hop, not the default.
 */
const page = (payload) =>
  `<!doctype html><meta charset="utf-8"><title>Signed in</title>` +
  `<script>` +
  `var sent = false;` +
  `if (window.opener) {` +
  `window.opener.postMessage(${payload}, window.location.origin);` +
  `sent = true;` +
  `} else {` +
  `try {` +
  `new BroadcastChannel(${JSON.stringify(AUTH_CHANNEL_NAME)})` +
  `.postMessage(${payload});` +
  `sent = true;` +
  `} catch (e) {}` +
  `}` +
  `if (sent) {` +
  `window.close();` +
  `} else {` +
  `document.body.textContent = ` +
  `"Signed in, but this window could not reach the app. ` +
  `Close it and reload the original tab.";` +
  `}` +
  `</script>` +
  `<p>You can close this window.</p>`;
