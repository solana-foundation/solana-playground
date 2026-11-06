/** A build server on this machine -- upstream's development default */
export const LOCAL_ENDPOINT = "http://localhost:8080";

/**
 * The Solana Foundation's build server itself. Not a default and not in the
 * picker: with its API key set it refuses a request without the key, which
 * only this deployment's `/api/build-server` holds. That route forwards to it (`PG_BUILD_SERVER_URL`, whose
 * default in `shared/config/server-env.mjs` is this same host). Kept so a
 * profile that stored it as a custom address is moved onto the route.
 */
export const FOUNDATION_DIRECT_ENDPOINT =
  "https://playground-server-dot-analytics-324114.de.r.appspot.com";

/**
 * The Solana Foundation's server as the browser reaches it, and what a fresh
 * profile uses: this deployment's own route, which asks for a GitHub sign-in
 * and records every build (`api/build-server.mjs`).
 *
 * A path, not an address. The default is computed once at build time under
 * Node, where there is no origin, and a path resolves against whichever
 * origin serves the client, a preview's included.
 */
export const FOUNDATION_ENDPOINT = "/api/build-server";

/**
 * What the picker offers, in this order -- the default first. The custom
 * URL field comes after these, from the setting itself.
 *
 * Upstream's own backend, `api.solpg.io`, is not offered: it is Acheron's
 * capacity, not Solana's, and whoever needs it enters it as a
 * custom server.
 */
export const SERVER_ENDPOINT_OPTIONS: ReadonlyArray<{
  name: string;
  value: string;
}> = [
  { name: "Solana Foundation", value: FOUNDATION_ENDPOINT },
  { name: "Local", value: LOCAL_ENDPOINT },
];

/**
 * Which build server a fresh profile talks to.
 *
 * The Foundation's server in every environment, development included,
 * through this deployment's route. Upstream defaults development to a local
 * server, but nothing in this repository starts one, so the first build of a
 * fresh checkout used to fail in milliseconds against a port with nothing
 * behind it. The dev server serves the route too; it needs sign-in
 * configured: `DATABASE_URL`, `AUTH_SECRET`, `GITHUB_CLIENT_ID` and
 * `GITHUB_CLIENT_SECRET` (`.env.example`). Running a server locally is a picker entry
 * away, or `REACT_APP_SERVER_URL=http://localhost:8080`.
 *
 * `||` not `??`: sourcing an env file leaves unfilled keys as "", which is
 * not nullish and would win.
 *
 * This decides the default only. A profile stores the option it picked,
 * not the address (`settings/stored-endpoint.ts`): one on this default
 * follows `REACT_APP_SERVER_URL` when it changes, and one that picked
 * another option keeps that option.
 */
export const defaultServerEndpoint = (env: {
  REACT_APP_SERVER_URL?: string;
  NODE_ENV?: string;
}) => throughRoute(env.REACT_APP_SERVER_URL) || FOUNDATION_ENDPOINT;

/**
 * An address with the Foundation's server's own host replaced by the route
 * in front of it. A deployment whose `REACT_APP_SERVER_URL` still names that
 * host, and a profile that stored it, would otherwise call a server that
 * refuses them once its API key is set.
 *
 * @param url an address, or nothing
 * @returns the route for the Foundation's host, else `url` unchanged
 */
export const throughRoute = <T extends string | undefined>(url: T) =>
  (url && url.replace(/\/+$/, "") === FOUNDATION_DIRECT_ENDPOINT
    ? FOUNDATION_ENDPOINT
    : url) as T;

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll } = import.meta.vitest;

  describe("settings/server/default-endpoint", () => {
    let DEFAULT_BUILD_SERVER_URL: typeof import("../../shared/config/server-env.mjs").DEFAULT_BUILD_SERVER_URL;
    beforeAll(async () => {
      ({ DEFAULT_BUILD_SERVER_URL } = await import(
        "../../shared/config/server-env.mjs"
      ));
    });

    describe("SERVER_ENDPOINT_OPTIONS", () => {
      it("leads with the server the default points at", () => {
        expect(SERVER_ENDPOINT_OPTIONS[0]).toEqual({
          name: "Solana Foundation",
          value: FOUNDATION_ENDPOINT,
        });
      });

      it("does not offer upstream's api.solpg.io", () => {
        expect(SERVER_ENDPOINT_OPTIONS).toEqual([
          { name: "Solana Foundation", value: FOUNDATION_ENDPOINT },
          { name: "Local", value: LOCAL_ENDPOINT },
        ]);
      });

      it("keeps a local server selectable", () => {
        expect(LOCAL_ENDPOINT).toBe("http://localhost:8080");
        expect(
          SERVER_ENDPOINT_OPTIONS.find((o) => o.value === LOCAL_ENDPOINT)?.name
        ).toBe("Local");
      });
    });

    describe("defaultServerEndpoint", () => {
      it("is the Foundation's server in every environment", () => {
        for (const NODE_ENV of ["production", "development", "test"]) {
          expect(defaultServerEndpoint({ NODE_ENV })).toBe(FOUNDATION_ENDPOINT);
        }
      });

      it("names the same host the route forwards to", () => {
        expect(FOUNDATION_DIRECT_ENDPOINT).toBe(DEFAULT_BUILD_SERVER_URL);
      });

      it("is this deployment's route, not the server's own host", () => {
        expect(FOUNDATION_ENDPOINT).toBe("/api/build-server");
        expect(FOUNDATION_ENDPOINT).not.toBe(FOUNDATION_DIRECT_ENDPOINT);
      });

      it("never defaults to api.solpg.io", () => {
        for (const NODE_ENV of ["production", "development", "test"]) {
          expect(defaultServerEndpoint({ NODE_ENV })).not.toBe(
            "https://api.solpg.io"
          );
        }
      });

      it("lets REACT_APP_SERVER_URL win", () => {
        expect(
          defaultServerEndpoint({
            NODE_ENV: "development",
            REACT_APP_SERVER_URL: "http://localhost:8080",
          })
        ).toBe(LOCAL_ENDPOINT);
      });

      it("sends a REACT_APP_SERVER_URL naming the server's own host through the route", () => {
        expect(
          defaultServerEndpoint({
            REACT_APP_SERVER_URL: `${FOUNDATION_DIRECT_ENDPOINT}/`,
          })
        ).toBe(FOUNDATION_ENDPOINT);
      });

      it("moves only the Foundation's host itself onto the route", () => {
        for (const url of [
          `${FOUNDATION_DIRECT_ENDPOINT}.evil.test`,
          `${FOUNDATION_DIRECT_ENDPOINT}/x`,
          FOUNDATION_DIRECT_ENDPOINT.replace("https:", "http:"),
          "https://api.solpg.io",
        ]) {
          expect(throughRoute(url)).toBe(url);
        }
      });

      it("ignores an empty REACT_APP_SERVER_URL", () => {
        expect(
          defaultServerEndpoint({
            NODE_ENV: "development",
            REACT_APP_SERVER_URL: "",
          })
        ).toBe(FOUNDATION_ENDPOINT);
      });
    });
  });
}
