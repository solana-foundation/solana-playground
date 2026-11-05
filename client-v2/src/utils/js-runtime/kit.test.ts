// The test API comes from vitest: `src/utils/js-runtime` imports mocha, whose
// types declare globals of the same names
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { signer } from "@solana/kit-plugin-signer";
import { Keypair } from "@solana/web3.js";
import { transpile } from "typescript";
import { describe, expect, it } from "vitest";

import {
  pgSignerFromFileWith,
  reasonMessage,
  showBigInts,
  SIGNER_NEEDS_PG_WALLET,
  TRANSPILE_OPTIONS,
  wrapScriptWith,
} from "./kit";
import { missingPackageMessage, missingPackageOf } from "./missing-package";

describe("missingPackageOf", () => {
  it("names the package a failed import asked for", () => {
    expect(
      missingPackageOf("Package `@solana-program/memo` is not available.")
    ).toBe("@solana-program/memo");
  });

  it("reads back the message the runtime throws", () => {
    expect(
      missingPackageOf(missingPackageMessage("@solana-program/memo"))
    ).toBe("@solana-program/memo");
  });

  it("is undefined for any other error", () => {
    expect(missingPackageOf("fetch failed")).toBeUndefined();
  });
});

describe("reasonMessage", () => {
  it("reads an error's message whichever window built it", () => {
    // An iframe's `Error` is not the page's: only the shape is shared
    expect(reasonMessage({ name: "Error", message: "boom" })).toBe("boom");
    expect(reasonMessage(new Error("boom"))).toBe("boom");
  });

  it("names an error that has no message", () => {
    expect(reasonMessage(new Error())).toBe("Error");
    expect(reasonMessage(new TypeError(""))).toBe("TypeError");
  });

  it("prints anything else a script rejects with", () => {
    expect(reasonMessage("boom")).toBe("boom");
    expect(reasonMessage(undefined)).toBe("undefined");
    expect(reasonMessage(Object.create(null))).toBe(
      "a value that cannot be printed"
    );
  });
});

describe("TRANSPILE_OPTIONS", () => {
  it("keeps for...of over a Map working", () => {
    const code = transpile(
      `for (const [k] of new Map([["a", 1]])) out.push(k);`,
      TRANSPILE_OPTIONS
    );
    const out: string[] = [];
    // eslint-disable-next-line no-new-func
    new Function("out", code)(out);
    expect(out).toEqual(["a"]);
  });

  it("keeps BigInt literals and numeric separators", () => {
    const code = transpile(`out.push(1_000n * 2n);`, TRANSPILE_OPTIONS);
    const out: bigint[] = [];
    // eslint-disable-next-line no-new-func
    new Function("out", code)(out);
    expect(out).toEqual([2000n]);
  });
});

describe("showBigInts", () => {
  it("writes a BigInt as Node does and leaves the rest", () => {
    expect(showBigInts([2000n, "SOL", 1])).toEqual(["2000n", "SOL", 1]);
  });
});

describe("wrapScriptWith", () => {
  /** Run a wrapped script; resolves with what it logged once it ends */
  const run = (script: string) =>
    new Promise<unknown[]>((resolve) => {
      const logged: unknown[] = [];
      const code = transpile(
        wrapScriptWith("__end()")(script),
        TRANSPILE_OPTIONS
      );
      // eslint-disable-next-line no-new-func
      new Function("console", "__fail", "__end", code)(
        { log: (...args: unknown[]) => logged.push(args.join(" ")) },
        (reason: unknown) => {
          const message = reasonMessage(reason);
          logged.push(`fail: ${message}`);
          return message;
        },
        () => resolve(logged)
      );
    });

  it("runs a script with top-level await", async () => {
    expect(
      await run("const x = await Promise.resolve(2); console.log(x);")
    ).toEqual(["2"]);
  });

  it("hides eval and Function from the script", async () => {
    expect(await run("console.log(typeof eval, typeof Function);")).toEqual([
      "undefined undefined",
    ]);
  });

  it("reports an uncaught error", async () => {
    expect(await run('throw new Error("boom");')).toEqual([
      "fail: boom",
      "Uncaught error: boom",
    ]);
  });

  it("runs the script as strict code", async () => {
    const logged = await run("undeclared = 1;");
    expect(logged[0]).toMatch(/^fail: .*undeclared/);
  });

  it("reports a thrown value that cannot be printed", async () => {
    expect(await run("throw Object.create(null);")).toEqual([
      "fail: a value that cannot be printed",
      "Uncaught error: a value that cannot be printed",
    ]);
  });
});

describe("pgSignerFromFileWith", () => {
  const deps = { createKeyPairSignerFromBytes, signer };

  it("makes the Playground wallet the identity and the payer", async () => {
    const keypair = Keypair.generate();
    const signerFromFile = pgSignerFromFileWith(deps)(() => ({
      isPg: true,
      keypair,
    }));

    const client = await signerFromFile("wallet.json")({});

    expect(client.identity.address).toBe(keypair.publicKey.toBase58());
    expect(client.payer.address).toBe(keypair.publicKey.toBase58());
  });

  it("refuses a wallet that is not the Playground wallet", async () => {
    const signerFromFile = pgSignerFromFileWith(deps)(() => ({ isPg: false }));

    await expect(signerFromFile("wallet.json")({})).rejects.toThrow(
      SIGNER_NEEDS_PG_WALLET
    );
  });
});
