/** Where a run sends: the open project and the network, as the settings hold them */
export interface Target {
  workspace: string | undefined;
  endpoint: string;
  cluster: string | undefined;
}

/** Holds the target a run started on and refuses a send once it moved */
export interface TargetGuard {
  /** Remember where the run starts; called once, before its first wait */
  capture: () => void;
  /** Throw unless the project and the network are still the captured ones, on devnet */
  ensure: () => void;
}

/**
 * The loader and the Test form's sender read the current program, wallet and
 * connection when they send. A run waits before it sends (an airdrop, a
 * build, a buffer upload), long enough to switch the project or the network,
 * and dropping the result afterwards does not take back what was sent. Each
 * send checks first, so a switch stops the run before anything reaches
 * another project's program or a network other than devnet.
 *
 * @param what the run in the error's words: "the deploy", "the call"
 */
export const targetGuardFor =
  (what: string) =>
  (read: () => Target): TargetGuard => {
    let started: Target | undefined;
    return {
      capture: () => {
        started = read();
      },
      ensure: () => {
        const now = read();
        if (
          !started ||
          now.workspace !== started.workspace ||
          now.endpoint !== started.endpoint ||
          now.cluster !== "devnet"
        ) {
          throw new Error(
            `The project or the network changed during ${what}, so nothing more was sent. Try again.`
          );
        }
      },
    };
  };

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll } = import.meta.vitest;

  describe("features/tutorial-conversation/model/runners/target", () => {
    let TEST_ENDPOINT: typeof import("@/test-utils/endpoints.mjs").TEST_ENDPOINT;
    let DEVNET: Target;

    beforeAll(async () => {
      ({ TEST_ENDPOINT } = await import("@/test-utils/endpoints.mjs"));
      DEVNET = {
        workspace: "hello_anchor",
        endpoint: TEST_ENDPOINT.DEVNET,
        cluster: "devnet",
      };
    });
    const guardOver = (state: { now: Target }) =>
      targetGuardFor("the deploy")(() => state.now);

    it("lets a send through on the target the run started on", () => {
      const guard = guardOver({ now: DEVNET });
      guard.capture();
      expect(() => guard.ensure()).not.toThrow();
    });

    it("refuses a send before the target was captured", () => {
      expect(() => guardOver({ now: DEVNET }).ensure()).toThrow(
        "changed during the deploy"
      );
    });

    it("refuses a send once the project changed", () => {
      const state = { now: DEVNET };
      const guard = guardOver(state);
      guard.capture();
      state.now = {
        workspace: "zero_copy",
        endpoint: DEVNET.endpoint,
        cluster: DEVNET.cluster,
      };
      expect(() => guard.ensure()).toThrow("changed during the deploy");
    });

    it("refuses a send once the network changed", () => {
      const state = { now: DEVNET };
      const guard = guardOver(state);
      guard.capture();
      state.now = {
        workspace: DEVNET.workspace,
        endpoint: TEST_ENDPOINT.MAINNET_BETA,
        cluster: "mainnet",
      };
      expect(() => guard.ensure()).toThrow("changed during the deploy");
    });
  });
}
