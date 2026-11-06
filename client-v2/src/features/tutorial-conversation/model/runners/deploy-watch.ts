import type { Idl } from "@coral-xyz/anchor";

import { createLogger } from "@/shared/lib/logger";

import type { Disposable } from "../../../../utils/types";
import { parseDeployed } from "../deployed-idl";

const log = createLogger("tutorial-conversation:deploy-watch");

/** What the watcher reads of the deploy command and the open program */
export interface DeployWatchPort {
  /** Every run of the deploy command, from any caller, as it starts */
  onDidStart(cb: () => void): Disposable;
  /** The same runs as they finish */
  onDidFinish(cb: (result: { err?: unknown }) => void): Disposable;
  /**
   * Whether no deploy is running: true as a new deploy starts and once it has
   * finished. A second Deploy press while one runs pauses or resumes it,
   * starting and finishing at once with no deploy behind it
   */
  isIdle(): boolean;
  /** The open workspace, by name */
  workspace(): string | undefined;
  cluster(): string | undefined;
  /** The open program's IDL: the last build's, whose binary the deploy shipped */
  idl(): Idl | undefined;
}

/**
 * Tell `onIdl` the IDL of every landed deploy that went through the deploy
 * command: the terminal's `deploy`, the explorer's menu, the assistant and any
 * other caller. The cards deploy through their own runner
 * (`runDeployOnDevnet`), hand their IDL to the engine themselves and never
 * reach the command. A deploy counts only if it started and finished in the
 * same workspace, on devnet: the Call panel talks to the devnet program, which
 * a deploy to another cluster does not change, and a deploy that finished
 * after a switch shipped another workspace's program.
 */
export const watchDeploys = (
  onIdl: (idl: Idl) => void,
  port: DeployWatchPort
): Disposable => {
  let started: { workspace?: string; cluster?: string } | undefined;
  const subs = [
    port.onDidStart(() => {
      // A pause or resume press starts too: keep the running deploy's
      if (port.isIdle()) {
        started = { workspace: port.workspace(), cluster: port.cluster() };
      }
    }),
    port.onDidFinish((result) => {
      if (!port.isIdle()) return;
      const run = started;
      started = undefined;
      if (result.err || !run) return;
      try {
        if (run.cluster !== "devnet" || port.cluster() !== "devnet") return;
        if (!run.workspace || run.workspace !== port.workspace()) {
          log.info("A deploy finished in another workspace than it started", {
            context: { started: run.workspace, now: port.workspace() },
          });
          return;
        }
        const idl = port.idl();
        if (!idl) {
          log.info("A deploy landed without an IDL: the Call panel keeps its");
          return;
        }
        // The panel maps it on render: one it cannot read must not reach it
        if (!parseDeployed({ idl, added: [] })) {
          log.warn("A deploy landed with an IDL the Call panel cannot read");
          return;
        }
        onIdl(idl);
      } catch (e) {
        log.error(e, { report: true, context: { stage: "deployed IDL" } });
      }
    }),
  ];
  return { dispose: () => subs.forEach((s) => s.dispose()) };
};

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  const IDL = { version: "0.1.0", name: "p", instructions: [] } as Idl;

  interface World {
    idle: boolean;
    workspace: string | undefined;
    cluster: string | undefined;
    idl: Idl | undefined;
  }

  const devnet = (): World => ({
    idle: true,
    workspace: "Hello Anchor",
    cluster: "devnet",
    idl: IDL,
  });

  /** The watcher over a fake deploy command reading `world` */
  const watching = (world: World) => {
    let start: () => void = () => {};
    let finish: (r: { err?: unknown }) => void = () => {};
    const dispose = vi.fn();
    const onIdl = vi.fn();
    const sub = watchDeploys(onIdl, {
      onDidStart: (cb) => {
        start = cb;
        return { dispose };
      },
      onDidFinish: (cb) => {
        finish = cb;
        return { dispose };
      },
      isIdle: () => world.idle,
      workspace: () => world.workspace,
      cluster: () => world.cluster,
      idl: () => world.idl,
    });
    /** One deploy: it starts, runs `during`, and finishes as `result` */
    const deploy = (during: () => void, result: { err?: unknown }) => {
      start();
      world.idle = false;
      during();
      world.idle = true;
      finish(result);
    };
    /** A Deploy press while one runs: it starts and finishes at once */
    const press = () => {
      start();
      finish({});
    };
    return { onIdl, sub, dispose, deploy, press };
  };

  const nothing = () => {};

  describe("features/tutorial-conversation/model/runners/deploy-watch", () => {
    it("passes on the IDL of a terminal deploy that landed on devnet", () => {
      const { onIdl, deploy } = watching(devnet());
      deploy(nothing, {});
      expect(onIdl).toHaveBeenCalledWith(IDL);
    });

    it("ignores a failed deploy", () => {
      const { onIdl, deploy } = watching(devnet());
      deploy(nothing, { err: new Error("no funds") });
      expect(onIdl).not.toHaveBeenCalled();
    });

    it("ignores a pause or a resume, and still takes the deploy it paused", () => {
      const world = devnet();
      const { onIdl, deploy, press } = watching(world);
      deploy(() => {
        press();
        expect(onIdl).not.toHaveBeenCalled();
        press();
      }, {});
      expect(onIdl).toHaveBeenCalledTimes(1);
    });

    it("ignores a deploy on another cluster than devnet, or moved off it", () => {
      const world = devnet();
      world.cluster = "localnet";
      const { onIdl, deploy } = watching(world);
      deploy(nothing, {});
      deploy(() => {
        world.cluster = "devnet";
      }, {});
      deploy(() => {
        world.cluster = "localnet";
      }, {});
      expect(onIdl).not.toHaveBeenCalled();
    });

    it("ignores a deploy that finished after a switch to another workspace", () => {
      const world = devnet();
      const { onIdl, deploy } = watching(world);
      deploy(() => {
        world.workspace = "Counter PDA Tutorial";
      }, {});
      expect(onIdl).not.toHaveBeenCalled();
    });

    it("ignores a program with no IDL, or one the panel cannot read", () => {
      const world = devnet();
      world.idl = undefined;
      const { onIdl, deploy } = watching(world);
      deploy(nothing, {});
      world.idl = { instructions: [{ name: "hello" }] } as unknown as Idl;
      deploy(nothing, {});
      expect(onIdl).not.toHaveBeenCalled();
    });

    it("reports a hand-off that throws, rather than lose it in the event", () => {
      const { onIdl, deploy } = watching(devnet());
      onIdl.mockImplementation(() => {
        throw new Error("boom");
      });
      expect(() => deploy(nothing, {})).not.toThrow();
    });

    it("stops listening when disposed", () => {
      const { sub, dispose } = watching(devnet());
      sub.dispose();
      expect(dispose).toHaveBeenCalledTimes(2);
    });
  });
}
