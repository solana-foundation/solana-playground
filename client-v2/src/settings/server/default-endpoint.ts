import { BUILD_SERVER_URL } from "../../shared/config/client-env";

/** A build server on this machine, and the default when `REACT_APP_SERVER_URL` is empty */
export const LOCAL_ENDPOINT = "http://localhost:8080";

/**
 * This deployment's own way to the build server (`api/build-server.mjs`),
 * which asks for a GitHub sign-in and records every build. Production sets
 * `REACT_APP_SERVER_URL` to it; the route forwards to `PG_BUILD_SERVER_URL`.
 * A path, not an address: it resolves against whichever origin serves the
 * client, a preview's included.
 */
export const BUILD_SERVER_ROUTE = "/api/build-server";

type EndpointOption = { name: string; value: string };

/**
 * What the picker offers, in this order, the default first. The Solana
 * Foundation's server is the deployment's `REACT_APP_SERVER_URL`, so its host
 * lives in deployment configuration only; without the variable it is not
 * offered. The custom URL field comes after these, from the setting itself.
 *
 * Upstream's own backend, `api.solpg.io`, is not offered: it is Acheron's
 * capacity, not Solana's, and whoever needs it enters it as a
 * custom server.
 */
const serverEndpointOptionsFor = (
  foundation: string | undefined
): ReadonlyArray<EndpointOption> => [
  ...(foundation ? [{ name: "Solana Foundation", value: foundation }] : []),
  { name: "Local", value: LOCAL_ENDPOINT },
];

export const SERVER_ENDPOINT_OPTIONS =
  serverEndpointOptionsFor(BUILD_SERVER_URL);

/**
 * Which build server a fresh profile talks to: the deployment's
 * `REACT_APP_SERVER_URL`, or a local server when it is empty.
 *
 * `||` not `??`: sourcing an env file leaves unfilled keys as "", which is
 * not nullish and would win.
 *
 * This decides the default only. A profile stores the option it picked,
 * not the address (`settings/stored-endpoint.ts`): one on this default
 * follows `REACT_APP_SERVER_URL` when it changes, and one that picked
 * another option keeps that option.
 */
export const defaultServerEndpoint = (env: { REACT_APP_SERVER_URL?: string }) =>
  env.REACT_APP_SERVER_URL || LOCAL_ENDPOINT;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("settings/server/default-endpoint", () => {
    describe("serverEndpointOptionsFor", () => {
      // Scenario "The variable is set" (client-v2-build-server-endpoint)
      it("lists the Foundation with the variable's URL, then Local, and not api.solpg.io", () => {
        expect(serverEndpointOptionsFor("https://server.example")).toEqual([
          { name: "Solana Foundation", value: "https://server.example" },
          { name: "Local", value: LOCAL_ENDPOINT },
        ]);
      });

      it("does not list the Foundation when the variable is empty", () => {
        expect(serverEndpointOptionsFor("").map((o) => o.name)).toEqual([
          "Local",
        ]);
      });
    });

    describe("defaultServerEndpoint", () => {
      it("is the variable's URL when it is set", () => {
        expect(
          defaultServerEndpoint({
            REACT_APP_SERVER_URL: "https://server.example",
          })
        ).toBe("https://server.example");
      });

      // Scenario "A fresh checkout" (client-v2-build-server-endpoint)
      it("is a local server when the variable is empty", () => {
        expect(defaultServerEndpoint({ REACT_APP_SERVER_URL: "" })).toBe(
          LOCAL_ENDPOINT
        );
      });
    });
  });
}
