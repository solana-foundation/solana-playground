import { createLogger } from "@/shared/lib/logger";

import { PgCommon } from "../common";
import { PgConnection } from "../connection";
import { PgProgramInfo } from "../program-info";
import { PgTerminal } from "../terminal";
import { PgWallet } from "../wallet";
import { signRequestWith } from "../wallet/sign-bridge";
import { formatOutputFor } from "./output";
import { serveSandboxWith } from "./page-channel";
import { prepareCode } from "./prepare-code";
import type { SandboxWallet, ToSandbox } from "./protocol";
import { relayRpcWith } from "./rpc-relay";
import { connectWith, LOAD_TIMEOUT_MS, SANDBOX_URL } from "./sandbox-frame";

const log = createLogger("js-runtime:sandbox");

/** Options to use when running a script/test */
interface ExecuteParams {
  /** Name of the file to execute */
  fileName: string;
  /** JS/TS code to execute */
  code: string;
  /** Whether to run the script as a test */
  isTest: boolean;
}

/** What is running now, if anything */
type Running = "client" | "tests" | undefined;

/**
 * Runs project code for `run` and `test` in a sandboxed frame
 * (`runtime.html`, `sandbox="allow-scripts"`): an opaque origin with no
 * access to the page, its storage or the wallet's keys. The page transpiles
 * the code, sends it with the IDL, the program id, the endpoint and the
 * wallets' public keys, prints what the sandbox prints, signs what it asks
 * to have signed and carries out its RPC requests (`page-channel.ts`).
 */
export class PgJsRuntime {
  /**
   * Run or test JS/TS code.
   *
   * @param params client parameters
   */
  static async execute({ fileName, code, isTest }: ExecuteParams) {
    if (this._running === "client") {
      throw new Error(
        isTest
          ? "Please wait for client to finish."
          : "Client is already running!"
      );
    }
    if (this._running === "tests") {
      throw new Error(
        isTest
          ? "Tests are already running!"
          : "Please wait for tests to finish."
      );
    }

    this._running = isTest ? "tests" : "client";
    try {
      PgTerminal.println(`  ${fileName}:`);

      // `describe` is only available when as test
      if (isTest && !code.includes("describe")) {
        throw new Error(
          `Tests must use '${PgTerminal.bold(
            "describe"
          )}' function. Use '${PgTerminal.bold(
            "run"
          )}' command to run the script.`
        );
      }

      const run = this._runMessage(prepareCode(code), isTest);
      const port = await this._openSandbox();
      const ended = serveSandboxWith({
        print: ({ level, text }) => {
          const line = formatOutputFor(level)(text);
          if (line !== undefined) PgTerminal.println(line);
        },
        sign: async (request) => {
          const reply = await signRequestWith(() =>
            PgWallet.getConnectedWallets()
          )(request);
          if ("error" in reply)
            log.warn(`sign request refused: ${reply.error}`);
          return reply;
        },
        rpc: relayRpcWith(() => window.fetch)(window.location.origin),
      })(port);
      port.postMessage(run);
      await ended;
      port.close();

      if (!isTest) PgTerminal.println("");
    } finally {
      this._running = undefined;
    }
  }

  /** The `run` message: the code and what `pg` is built from */
  private static _runMessage(code: string, isTest: boolean): ToSandbox {
    const current = PgWallet.current;
    const wallets: SandboxWallet[] = current
      ? PgWallet.getConnectedWallets().map((wallet) => ({
          name: wallet.name,
          key: PgCommon.toCamelCase(wallet.name),
          publicKey: wallet.publicKey.toBase58(),
          isPg: !!wallet.isPg,
        }))
      : [];
    const currentIndex = current
      ? wallets.findIndex(
          (wallet) => wallet.publicKey === current.publicKey.toBase58()
        )
      : -1;

    const idl = PgProgramInfo.idl ?? undefined;
    const workspaceNames = idl
      ? Array.from(
          new Set([
            PgCommon.toPascalFromSnake(idl.name), // default before 0.29.0
            PgCommon.toCamelFromSnake(idl.name),
            PgCommon.toKebabFromSnake(idl.name),
            idl.name,
          ])
        )
      : [];

    return {
      type: "run",
      code,
      isTest,
      idl,
      workspaceNames,
      programId: PgProgramInfo.pk?.toBase58(),
      endpoint: PgConnection.current.rpcEndpoint,
      commitment: PgConnection.current.commitment ?? "confirmed",
      wallets,
      current: currentIndex === -1 ? undefined : currentIndex,
    };
  }

  /**
   * Loads a fresh sandbox and opens its private channel. The frame is made
   * once and reloaded for every run, so no run sees another's globals.
   *
   * @returns the page's side of the channel
   */
  private static async _openSandbox() {
    if (!this._frame) {
      const frame = document.createElement("iframe");
      // Scripts only: no same-origin access, top-level navigation, popups
      // or forms, so the frame's origin is opaque
      frame.setAttribute("sandbox", "allow-scripts");
      frame.setAttribute("aria-hidden", "true");
      frame.title = "Project code runtime";
      frame.style.display = "none";
      document.body.appendChild(frame);
      this._frame = frame;
    }

    const frame = this._frame;
    const connected = connectWith(window)(LOAD_TIMEOUT_MS)(
      () => frame.contentWindow
    );
    frame.src = SANDBOX_URL;
    try {
      return await connected;
    } catch (error) {
      log.error(error, { report: true });
      throw error;
    }
  }

  /** What is running now */
  private static _running: Running;

  /** The sandbox's frame, made on the first run */
  private static _frame: HTMLIFrameElement | undefined;
}
