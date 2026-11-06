import * as anchor from "@coral-xyz/anchor";
import * as web3 from "@solana/web3.js";
import * as mocha from "mocha/browser-entry";
import { format } from "util";

import {
  kitSignerWith,
  sandboxSignerProviderWith,
  signerMethodsWith,
} from "../../wallet/sandbox-signer-provider";
import { pgSignerFromFileWith, reasonMessage, showBigInts } from "../kit";
import { PgJsRuntimePackage } from "../package";
import type { OutputLevel } from "../protocol";
import type { RunMessage, SandboxChannel } from "./channel";
import { patchConfirmTransaction } from "./confirm";
import { countUnsent, patchWeb3 } from "./placeholders";

/** The names the page's code wrapper calls (`prepare-code.ts`) */
const DONE = "__pgDone";
const IMPORT = "__pgImport";

/** Utilities project code finds under `pg` */
interface Pg {
  connection: web3.Connection;
  wallet?: object;
  wallets?: Record<string, object>;
  PROGRAM_ID?: web3.PublicKey;
  program?: anchor.Program;
}

/**
 * Prints to the terminal, as `console` did in the page: the page adds the
 * indent and the colour for the level.
 */
const consoleFor = (channel: SandboxChannel) => {
  const printAt =
    (level: OutputLevel) =>
    (...args: unknown[]) =>
      channel.post({
        type: "output",
        level,
        text: format(...showBigInts(args)),
      });
  return {
    log: printAt("log"),
    info: printAt("info"),
    warn: printAt("warn"),
    error: printAt("error"),
  };
};

/** `pg`, built from what the page sent */
const pgFor = (channel: SandboxChannel) => (run: RunMessage) => {
  const connection = new web3.Connection(run.endpoint, {
    commitment: run.commitment as web3.Commitment,
  });
  const pg: Pg = { connection };

  const provider = sandboxSignerProviderWith(channel.sign);
  const walletOf = (wallet: RunMessage["wallets"][number]) => {
    const publicKey = new web3.PublicKey(wallet.publicKey);
    if (wallet.isPg) {
      return provider.walletFor({ name: wallet.name, publicKey });
    }
    return {
      isPg: false,
      name: wallet.name,
      publicKey,
      ...signerMethodsWith(channel.sign)(publicKey),
    };
  };

  const current =
    run.current === undefined ? undefined : run.wallets[run.current];
  if (current) {
    pg.wallet = walletOf(current);
    pg.wallets = Object.fromEntries(
      run.wallets.map((wallet) => [wallet.key, walletOf(wallet)])
    );
  }

  if (run.programId) pg.PROGRAM_ID = new web3.PublicKey(run.programId);

  if (pg.wallet && pg.PROGRAM_ID && run.idl) {
    pg.program = new anchor.Program(
      run.idl as anchor.Idl,
      pg.PROGRAM_ID,
      new anchor.AnchorProvider(
        connection,
        pg.wallet as anchor.Wallet,
        anchor.AnchorProvider.defaultOptions()
      )
    );
  }

  return pg;
};

/**
 * Adds what Anchor's local setup gives a test: `AnchorProvider.local()`,
 * `AnchorProvider.env()`, `provider.wallet.payer` and `anchor.workspace`.
 */
const anchorFor =
  (pg: Pg) =>
  (run: RunMessage) =>
  (name: string, pkg: Record<string, unknown>) => {
    // Fix `Cannot assign to property 'workspace' of [object Module]`
    const overridden: Record<string, unknown> = { ...pkg };
    const providerName =
      name === "@coral-xyz/anchor" ? "AnchorProvider" : "Provider";
    const Provider = overridden[providerName] as {
      local?: unknown;
      env?: unknown;
    };

    /** `provider.wallet.payer` is the wallet's keypair, as in local tests */
    const withPayer = (provider: anchor.AnchorProvider) => {
      const wallet = provider.wallet as anchor.Wallet & {
        isPg?: boolean;
        keypair?: web3.Keypair;
      };
      if (wallet.isPg) {
        Object.assign(provider, {
          wallet: Object.assign(Object.create(wallet), {
            payer: wallet.keypair,
          }),
        });
      }
      return provider;
    };

    // Anchor defines the signature
    Provider.local = (
      // eslint-disable-next-line layers/curry-order -- Anchor defines the signature
      url?: string,
      // eslint-disable-next-line layers/curry-order -- Anchor defines the signature
      opts: web3.ConfirmOptions = anchor.AnchorProvider.defaultOptions()
    ) => {
      if (!pg.wallet) throw new Error("Wallet not connected");
      const connection = new web3.Connection(
        url ?? "http://localhost:8899",
        opts.commitment
      );
      return withPayer(
        new anchor.AnchorProvider(connection, pg.wallet as anchor.Wallet, opts)
      );
    };

    Provider.env = () => {
      const provider = pg.program?.provider;
      if (!provider) throw new Error("Provider not ready");
      return withPayer(provider as anchor.AnchorProvider);
    };

    if (pg.program) {
      const workspace: Record<string, unknown> = {};
      for (const workspaceName of run.workspaceNames) {
        Object.defineProperty(workspace, workspaceName, {
          enumerable: true,
          get: () => {
            const program = pg.program;
            if (!program) return program;
            const getProvider = overridden.getProvider as () => anchor.Provider;
            return new anchor.Program(
              program.idl,
              program.programId,
              getProvider()
            );
          },
        });
      }
      overridden.workspace = workspace;
    }

    return overridden;
  };

/** Imports a package or the project's IDL, for the page's import rewrite */
const importerFor =
  (overridePackage: (name: string, pkg: Record<string, unknown>) => object) =>
  (run: RunMessage) =>
  async (path: string) => {
    if (path.startsWith(".")) {
      // Anchor's `target/types` is the only local import
      if (!path.includes("target/types")) {
        throw new Error("File imports are not yet supported.");
      }
      if (!run.idl) {
        throw new Error("IDL not found, build the program to create the IDL.");
      }
      return { IDL: run.idl };
    }
    const pkg = await PgJsRuntimePackage.import(path);
    return overridePackage(path, pkg as Record<string, unknown>);
  };

/** The globals `supported-packages.json` names, as project code gets them */
const globalPackagesFor = async (
  overridePackage: (name: string, pkg: Record<string, unknown>) => object
) =>
  Promise.all(
    Object.entries(PACKAGES.global).map(async ([name, style]) => {
      const pkg = overridePackage(
        name,
        (await PgJsRuntimePackage.import(name)) as Record<string, unknown>
      ) as Record<string, unknown>;
      const s = style as { as?: string; named?: string; default?: string };
      if (s.as) return [s.as, pkg] as const;
      if (s.named) return [s.named, pkg[s.named]] as const;
      if (s.default) return [s.default, pkg.default ?? pkg] as const;
      throw new Error(`No import style for \`${name}\``);
    })
  );

/**
 * Prints an error the way the old runtime did, and goes on
 *
 * @param console the sandbox's console
 * @param fail records the run's failure, returning the error's message
 */
const printUncaughtWith =
  (console: ReturnType<typeof consoleFor>) =>
  (fail: (reason: unknown) => string) =>
  (error: unknown) =>
    console.log("Uncaught error:", fail(error));

/**
 * Overrides `@solana/kit-plugin-signer`'s `signerFromFile`: the Playground
 * wallet, signing through the page, is a docs script's `wallet.json`
 */
const kitPluginSignerFor =
  (channel: SandboxChannel) =>
  (run: RunMessage) =>
  (pkg: Record<string, unknown>) => {
    const current =
      run.current === undefined ? undefined : run.wallets[run.current];
    return {
      ...pkg,
      signerFromFile: pgSignerFromFileWith({
        signer: pkg.signer as (signer: unknown) => (client: unknown) => unknown,
      })(() =>
        current?.isPg
          ? kitSignerWith(channel.sign)(new web3.PublicKey(current.publicKey))
          : undefined
      ),
    };
  };

/** Runs mocha over what the code registered, posting each line and the counts */
const runMocha = (channel: SandboxChannel) =>
  new Promise<void>((resolve) => {
    const runner = mocha.run(() => {
      const stats = (
        runner as {
          stats?: { passes: number; failures: number; pending: number };
        }
      ).stats;
      channel.post({
        type: "result",
        passes: stats?.passes ?? 0,
        failures: stats?.failures ?? 0,
        pending: stats?.pending ?? 0,
      });
      resolve();
    });
  });

/**
 * Runs one piece of project code: builds `pg`, the packages and `console`,
 * runs the code (and mocha, for a test) and posts `end`.
 *
 * @param channel the sandbox's side of the port
 * @returns a function of the run the page asked for
 */
export const runWith = (channel: SandboxChannel) => async (run: RunMessage) => {
  const console = consoleFor(channel);
  // The run's first uncaught error, which makes it fail (`RunResult`)
  let failure: string | undefined;
  const fail = (reason: unknown) => {
    const message = reasonMessage(reason);
    failure ??= message;
    return message;
  };
  const printUncaught = printUncaughtWith(console)(fail);
  // An error thrown outside the code's promise chain (a timer's callback)
  // ends the run, as it did in the old runtime: the code may be awaiting that
  // callback, and `finished` would then never settle. The sandbox is a fresh
  // document per run, so one listener per run is all there is.
  const thrownOutside = new Promise<void>((resolve) =>
    window.addEventListener("error", (event) => {
      printUncaught(event.error ?? event.message);
      resolve();
    })
  );
  window.addEventListener("unhandledrejection", (event) =>
    printUncaught(event.reason)
  );

  try {
    const pg = pgFor(channel)(run);
    const overrideAnchor = anchorFor(pg)(run);
    const overrideKitPluginSigner = kitPluginSignerFor(channel)(run);
    const overridePackage = (name: string, pkg: Record<string, unknown>) => {
      if (name === "@coral-xyz/anchor" || name === "@project-serum/anchor") {
        return overrideAnchor(name, pkg);
      }
      if (name === "@solana/kit-plugin-signer") {
        return overrideKitPluginSigner(pkg);
      }
      return pkg;
    };

    if (run.isTest) {
      // Every line mocha's reporters print goes through `Base.consoleLog`
      const { Mocha } = globalThis as unknown as {
        Mocha: { reporters: { Base: { consoleLog: unknown } } };
      };
      Mocha.reporters.Base.consoleLog = (...args: unknown[]) =>
        channel.post({ type: "output", level: "mocha", text: format(...args) });
      mocha.setup({
        ui: "bdd",
        timeout: "30000",
        cleanReferencesAfterRun: false,
        reporter: "spec",
      });
    }

    let finished: Promise<unknown> = Promise.resolve();
    const globals: Array<readonly [string, unknown]> = [
      ["pg", pg],
      ["console", console],
      ["sleep", (ms: number) => new Promise((r) => setTimeout(r, ms))],
      [IMPORT, importerFor(overridePackage)(run)],
      [
        DONE,
        (promise: Promise<unknown>) => {
          finished = promise;
        },
      ],
      ...(await globalPackagesFor(overridePackage)),
    ];

    try {
      // Project code is the frame's own: it runs with the sandbox's globals
      // and only these names added
      // eslint-disable-next-line no-new-func -- the sandbox exists to run project code
      new Function(...globals.map(([name]) => name), run.code)(
        ...globals.map(([, value]) => value)
      );
      await Promise.race([finished, thrownOutside]);
    } catch (error) {
      if (error instanceof SyntaxError) {
        console.error(`SyntaxError: ${fail(error)}`);
      } else {
        printUncaught(error);
      }
    }

    if (run.isTest) await runMocha(channel);

    const unsent = countUnsent();
    if (unsent) {
      console.warn(
        `${unsent} signature(s) of pg.wallet.keypair never reached the cluster: ` +
          "a transaction serialized right after a synchronous tx.sign(...) " +
          "and sent by other means carries no valid signature. Use " +
          "`await tx.sign(...)` before serializing."
      );
    }
  } catch (error) {
    printUncaught(error);
  } finally {
    channel.post(
      failure === undefined ? { type: "end" } : { type: "end", error: failure }
    );
  }
};

/** Patches the sandbox's web3.js once, before any project code runs */
export const prepareWeb3 = () => {
  patchWeb3(web3);
  patchConfirmTransaction(web3);
};
