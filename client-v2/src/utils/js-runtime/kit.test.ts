// The test API comes from vitest: `src/utils/js-runtime` imports mocha, whose
// types declare globals of the same names
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { signer } from "@solana/kit-plugin-signer";
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  pgSignerFromFileWith,
  reasonMessage,
  showBigInts,
  SIGNER_NEEDS_PG_WALLET,
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

describe("showBigInts", () => {
  it("writes a BigInt as Node does and leaves the rest", () => {
    expect(showBigInts([2000n, "SOL", 1])).toEqual(["2000n", "SOL", 1]);
  });
});

describe("pgSignerFromFileWith", () => {
  const deps = { signer };

  it("makes the Playground wallet's signer the identity and the payer", async () => {
    const keypair = Keypair.generate();
    const kitSigner = await createKeyPairSignerFromBytes(keypair.secretKey);
    const signerFromFile = pgSignerFromFileWith(deps)(() => kitSigner);

    const client = await signerFromFile("wallet.json")({});

    expect(client.identity.address).toBe(keypair.publicKey.toBase58());
    expect(client.payer.address).toBe(keypair.publicKey.toBase58());
  });

  it("refuses a wallet that is not the Playground wallet", async () => {
    const signerFromFile = pgSignerFromFileWith(deps)(() => undefined);

    await expect(signerFromFile("wallet.json")({})).rejects.toThrow(
      SIGNER_NEEDS_PG_WALLET
    );
  });
});
