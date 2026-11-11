import type { PgGlobal } from "@/utils";

type Global = Pick<typeof PgGlobal, "deployState" | "isIdlWriting">;

/**
 * What holds the network where it is: a deploy that runs or waits paused,
 * since its later transactions would go to the new network while its buffer
 * stays on the old one, or an `anchor idl` write, whose later transactions
 * would go to a network its mainnet check never saw
 */
export const networkHeldBy = ({ deployState, isIdlWriting }: Global) => {
  if (deployState === "loading" || deployState === "paused") return "deploy";
  if (isIdlWriting) return "idl";
  return undefined;
};

/** Whether the network may change now */
export const canSwitchNetwork = (global: Global) =>
  networkHeldBy(global) === undefined;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/settings-page/model/network-hold", () => {
    it.each([
      ["ready", true],
      ["cancelled", true],
      ["loading", false],
      ["paused", false],
    ] as const)("canSwitchNetwork while the deploy is %s: %s", (state, can) => {
      expect(
        canSwitchNetwork({ deployState: state, isIdlWriting: false })
      ).toBe(can);
    });

    it("holds the network while an anchor idl write runs", () => {
      const global = { deployState: "ready", isIdlWriting: true } as const;
      expect(canSwitchNetwork(global)).toBe(false);
      expect(networkHeldBy(global)).toBe("idl");
    });
  });
}
