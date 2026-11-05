import type { PgGlobal } from "@/utils";

type DeployState = typeof PgGlobal.deployState;

/**
 * Whether the network may change now: not while a deploy runs or waits
 * paused, since its later transactions would go to the new network while
 * its buffer stays on the old one
 */
export const canSwitchNetwork = (deployState: DeployState) =>
  deployState !== "loading" && deployState !== "paused";

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/settings-page/model/network-hold", () => {
    it.each([
      ["ready", true],
      ["cancelled", true],
      ["loading", false],
      ["paused", false],
    ] as const)("canSwitchNetwork while the deploy is %s: %s", (state, can) => {
      expect(canSwitchNetwork(state)).toBe(can);
    });
  });
}
