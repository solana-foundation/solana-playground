import { sameIdlName } from "@/shared/lib/idl-name";

import type { AccountReading, ConversationProgress } from "./progress";

/** The newest saved reading of an account, whichever act took it */
export const latestReading = (
  p: ConversationProgress,
  name: string
): AccountReading | undefined => {
  let latest: { at: number; reading: AccountReading } | undefined;
  for (const runs of Object.values(p.runs)) {
    for (const run of runs) {
      if (run.status !== "ok") continue;
      const { result } = run;
      if ((result.act !== "run" && result.act !== "call") || !result.ok) {
        continue;
      }
      const reading = result.account;
      if (!reading || !sameIdlName(reading.name, name)) continue;
      if (!latest || run.at >= latest.at) latest = { at: run.at, reading };
    }
  }
  return latest?.reading;
};

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;

  const reading = (name: string, energy: string): AccountReading => ({
    name,
    address: "A",
    size: 32,
    fields: { energy },
  });

  const run = ({
    at,
    account,
  }: {
    at: number;
    account?: AccountReading;
  }): import("./progress").RunRecord => ({
    status: "ok",
    at,
    took: 1,
    result: {
      act: "call",
      ok: true,
      seconds: 1,
      signatures: ["sig"],
      line: "ok",
      called: [],
      account,
    },
  });

  const withRuns = (runs: ConversationProgress["runs"]) =>
    ({ runs } as unknown as ConversationProgress);

  describe("latestReading", () => {
    it("finds the newest reading of that account, across acts", () => {
      const p = withRuns({
        init: [run({ at: 1, account: reading("player", "5") })],
        chop: [run({ at: 2, account: reading("player", "4") }), run({ at: 3 })],
        other: [run({ at: 9, account: reading("map", "0") })],
      });
      expect(latestReading(p, "player")?.fields.energy).toBe("4");
    });

    it("matches the IDL's spelling either way", () => {
      const p = withRuns({
        grow: [run({ at: 1, account: reading("big_map", "1") })],
      });
      expect(latestReading(p, "bigMap")?.name).toBe("big_map");
    });

    it("skips a run with no reading of its own", () => {
      const p = withRuns({
        chop: [
          run({ at: 1, account: reading("player", "1") }),
          { status: "started", at: 2 },
          { status: "interrupted", at: 3 },
        ],
      });
      expect(latestReading(p, "player")?.fields.energy).toBe("1");
    });

    it("has none before the first", () => {
      expect(latestReading(withRuns({}), "player")).toBeUndefined();
    });
  });
}
