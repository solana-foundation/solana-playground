import type { Reporter } from "./types";

/**
 * Stands in for `./sentry` in a build that does not carry Sentry (see
 * `sentryEnabled`), so the SDK stays out of the bundle; craco.config.js makes
 * the swap. A send rejects: resolving would tell the user it went somewhere.
 */
export const reporter: Reporter = {
  carried: false,
  init: () => {},
  capture: () => {},
  sendFeedback: () =>
    Promise.reject(new Error("This build does not carry a reporter")),
};
