/* eslint-disable layers/curry-order, max-params -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import type { Act } from "@/entities/tutorial";
import { linkingOwnTxs } from "@/shared/lib/tx-links";

import type { Runner } from "../ports";
import { failedResult } from "../ports";

/** One act's runner, as the `Runner` port calls it */
export type ActRun = Runner["run"];

/**
 * The `Runner` the frame gives `PgConversation.init`: one runner per act,
 * each from its own run ticket (build HOO-2355, deploy HOO-2356, run and
 * call HOO-2357). An act with none yet answers a failed result that says so,
 * so a lesson reaching it shows a failed card rather than hang.
 *
 * An act's card links the transaction it shows, so its sends raise no
 * Explorer toast over that card (HOO-2703).
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
    return linkingOwnTxs(() => run(act, input, onStage));
  },
});

if (import.meta.vitest) {
  const { beforeAll, describe, it, expect, vi } = import.meta.vitest;

  let isTxLinkedBySender: typeof import("@/shared/lib/tx-links").isTxLinkedBySender;
  beforeAll(async () => {
    ({ isTxLinkedBySender } = await import("@/shared/lib/tx-links"));
  });

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

    it("marks the act's sends as shown by its card, and only while it runs", async () => {
      let during = false;
      const call = vi.fn<ActRun>(async (act) => {
        during = isTxLinkedBySender();
        return failedResult(act, "stub");
      });
      await actRunner({ call }).run("call", { beatId: "s3.call" }, () => {});
      expect(during).toBe(true);
      expect(isTxLinkedBySender()).toBe(false);
    });

    it("lifts the mark when the act throws", async () => {
      const run = vi.fn<ActRun>(async () => {
        throw new Error("the script broke");
      });
      await expect(
        actRunner({ run }).run("run", { beatId: "s3.run" }, () => {})
      ).rejects.toThrow("the script broke");
      expect(isTxLinkedBySender()).toBe(false);
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
