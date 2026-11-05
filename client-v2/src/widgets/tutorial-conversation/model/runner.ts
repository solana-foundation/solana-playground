/* eslint-disable layers/curry-order, max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import type { Runner } from "@/features/tutorial-conversation";
import { createLogger } from "@/shared/lib/logger";

/** Who hears that a deploy ran outside the deploy command: `PgFlow` */
export interface DeployListener {
  deployStarted(): void;
  deployFinished(ok: boolean): void;
}

const log = createLogger("tutorial-conversation:runner");

/** Tells `flow`, never letting a listener's throw reach the run */
const tell = (what: string, call: () => void) => {
  try {
    call();
  } catch (e) {
    log.error(e, { report: true, context: { what } });
  }
};

/**
 * `runner`, telling `flow` when a deploy or build-and-deploy starts and ends.
 * The terminal bar, the drawer's opening on the first deploy and the amber
 * "changed since the last deploy" all read `PgFlow`, which otherwise follows
 * only the editor's deploy command. A run that throws ends as failed. A
 * deploy whose workspace (`workspace`, read at the start and the end) was
 * left meanwhile tells nothing at its end: `PgFlow` already reset for the
 * other one. A listener that throws is logged, and the run's own result
 * stands.
 */
export const announceDeploys = (
  runner: Runner,
  flow: DeployListener,
  workspace: () => string | undefined = () => undefined
): Runner => ({
  recognise: runner.recognise,
  run: async (act, input, onStage) => {
    if (act !== "deploy" && act !== "buildDeploy") {
      return runner.run(act, input, onStage);
    }
    const startedIn = workspace();
    tell("deploy started", () => flow.deployStarted());
    let ok = false;
    try {
      const result = await runner.run(act, input, onStage);
      ok = result.ok;
      return result;
    } finally {
      if (workspace() === startedIn) {
        tell("deploy finished", () => flow.deployFinished(ok));
      }
    }
  },
});

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  describe("widgets/tutorial-conversation/model/runner", () => {
    const flow = () => ({ deployStarted: vi.fn(), deployFinished: vi.fn() });
    const answering = (ok: boolean): Runner => ({
      run: vi.fn(async (act) =>
        ok
          ? {
              act: "deploy" as const,
              ok: true as const,
              seconds: 1,
              programId: "P",
              signature: "S",
              upgraded: false,
              lamports: 1,
              instructions: [],
            }
          : {
              act: act as "deploy",
              ok: false as const,
              seconds: 1,
              reason: "failed" as const,
              message: "no",
            }
      ),
    });

    it("tells the flow a deploy started and landed", async () => {
      const f = flow();
      await announceDeploys(answering(true), f).run(
        "deploy",
        { beatId: "s2.deploy" },
        () => {}
      );
      expect(f.deployStarted).toHaveBeenCalledTimes(1);
      expect(f.deployFinished).toHaveBeenCalledWith(true);
    });

    it("ends a failed or thrown build-and-deploy as failed", async () => {
      const f = flow();
      await announceDeploys(answering(false), f).run(
        "buildDeploy",
        { beatId: "s4.ship" },
        () => {}
      );
      expect(f.deployFinished).toHaveBeenCalledWith(false);
      const thrown = flow();
      const runner: Runner = {
        run: () => Promise.reject(new Error("boom")),
      };
      await expect(
        announceDeploys(runner, thrown).run(
          "deploy",
          { beatId: "s2.deploy" },
          () => {}
        )
      ).rejects.toThrow("boom");
      expect(thrown.deployFinished).toHaveBeenCalledWith(false);
    });

    it("drops the finish of a deploy whose workspace was left meanwhile", async () => {
      const f = flow();
      let workspace = "hello";
      const runner: Runner = {
        run: async (act) => {
          workspace = "other";
          return answering(true).run(act, { beatId: "s2.deploy" }, () => {});
        },
      };
      const result = await announceDeploys(runner, f, () => workspace).run(
        "deploy",
        { beatId: "s2.deploy" },
        () => {}
      );
      expect(result.ok).toBe(true);
      expect(f.deployStarted).toHaveBeenCalledTimes(1);
      expect(f.deployFinished).not.toHaveBeenCalled();
    });

    it("keeps the deploy's own result when the flow's listener throws", async () => {
      const f = {
        deployStarted: vi.fn(() => {
          throw new Error("listener");
        }),
        deployFinished: vi.fn(() => {
          throw new Error("listener");
        }),
      };
      await expect(
        announceDeploys(answering(true), f).run(
          "deploy",
          { beatId: "s2.deploy" },
          () => {}
        )
      ).resolves.toMatchObject({ ok: true, programId: "P" });
    });

    it("passes the runner's recognise through", () => {
      const recognise = vi.fn(async () => null);
      expect(
        announceDeploys({ run: vi.fn(), recognise }, flow()).recognise
      ).toBe(recognise);
    });

    it("says nothing of a build or a call", async () => {
      const f = flow();
      await announceDeploys(answering(true), f).run(
        "build",
        { beatId: "s1.build" },
        () => {}
      );
      expect(f.deployStarted).not.toHaveBeenCalled();
      expect(f.deployFinished).not.toHaveBeenCalled();
    });
  });
}
