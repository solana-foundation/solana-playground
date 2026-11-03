import type { Act } from "@/entities/tutorial";

import { failedResult } from "../ports";
import type { Runner } from "../ports";

/** One act's runner, as the `Runner` port calls it */
export type ActRun = Runner["run"];

/**
 * The `Runner` the frame gives `PgConversation.init`: one runner per act,
 * each from its own run ticket (build HOO-2355, deploy HOO-2356, run and
 * call HOO-2357). An act with none yet answers a failed result that says so,
 * so a lesson reaching it shows a failed card rather than hang.
 */
export const actRunner = (
  runs: Partial<Record<Act, ActRun>>,
  recognise?: Runner["recognise"]
): Runner => ({
  recognise,
  run: (act, input, onStage) => {
    const run = runs[act];
    if (!run) {
      return Promise.resolve(
        failedResult(act, `The ${act} act is not wired yet.`)
      );
    }
    return run(act, input, onStage);
  },
});

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  describe("features/tutorial-conversation/model/runners/act-runner", () => {
    it("hands each act to its own runner", async () => {
      const deploy = vi.fn<ActRun>(async (act) => failedResult(act, "stub"));
      const runner = actRunner({ deploy, buildDeploy: deploy });
      const onStage = () => {};
      await runner.run("buildDeploy", { beatId: "s4.deploy" }, onStage);
      expect(deploy).toHaveBeenCalledWith(
        "buildDeploy",
        { beatId: "s4.deploy" },
        onStage
      );
    });

    it("answers an act with no runner as a failed result", async () => {
      await expect(
        actRunner({}).run("call", { beatId: "s3.call" }, () => {})
      ).resolves.toMatchObject({
        act: "call",
        ok: false,
        message: "The call act is not wired yet.",
      });
    });
  });
}
