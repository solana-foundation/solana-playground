// @vitest-environment node
// Signing builds web3.js transactions, whose byte checks fail under jsdom
// (its `Uint8Array` is another realm's), so these run in node with the one
// browser global Wallet Standard registration needs. The rest of the bridge's
// tests are in-source, under jsdom.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as ed25519 from "@noble/ed25519";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";

import type { StandardWallet } from "../../../utils/wallet/types";
import type { SigningCluster } from "./bridge";

type Bridge = typeof import("./bridge");
type Fakes = typeof import("../../../test-utils/fake-wallet");
type FakeOptions = Parameters<Fakes["registerFakeWallet"]>[0];

describe("entities/external-wallet/model/bridge", () => {
  let bridge: Bridge;
  let fakes: Fakes;
  const cleanup: (() => void)[] = [];
  const hadWindow = "window" in globalThis;

  beforeAll(async () => {
    Object.assign(globalThis, {
      window: Object.assign(new EventTarget(), { navigator: {} }),
    });
    bridge = await import("./bridge");
    fakes = await import("../../../test-utils/fake-wallet");
  });

  afterEach(() => cleanup.splice(0).forEach((fn) => fn()));

  afterAll(() => {
    if (!hadWindow) Reflect.deleteProperty(globalThis, "window");
  });

  const DEVNET: SigningCluster = {
    id: "solana:devnet",
    label: "devnet",
    url: "https://api.devnet.solana.com",
  };
  const MAINNET: SigningCluster = {
    id: "solana:mainnet",
    label: "mainnet-beta",
    url: "https://api.mainnet-beta.solana.com",
  };

  /** A connected bridged wallet over a fake built from `opts` */
  const connected = async (
    opts: FakeOptions,
    signingCluster: () => SigningCluster | undefined = () => undefined
  ) => {
    const fake = fakes.registerFakeWallet(opts);
    cleanup.push(() => fake.unregister());
    const seen: { latest: StandardWallet[] } = { latest: [] };
    cleanup.push(
      bridge.watchExternalWallets(
        (wallets) => {
          seen.latest = wallets;
        },
        { signingCluster }
      )
    );
    const wallet = seen.latest.find((w) => w.name === opts.name);
    if (!wallet) throw new Error(`${opts.name} not listed`);
    await wallet.connect();
    return { wallet, fake };
  };

  /** A transfer from `from`, with a made-up blockhash: nothing is sent */
  const transfer = (from: Keypair) =>
    new Transaction({
      feePayer: from.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
    }).add(
      SystemProgram.transfer({
        fromPubkey: from.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1,
      })
    );

  it("signs a web3.js Transaction with the selected account", async () => {
    const kp = Keypair.generate();
    const { wallet } = await connected({ name: "Phantom", accounts: [kp] });

    const signed = await wallet.signTransaction!(transfer(kp));

    expect(signed).toBeInstanceOf(Transaction);
    expect(signed.verifySignatures()).toBe(true);
  });

  it("signs several transactions at once", async () => {
    const kp = Keypair.generate();
    const { wallet } = await connected({ name: "Phantom", accounts: [kp] });

    const signed = await wallet.signAllTransactions!([
      transfer(kp),
      transfer(kp),
    ]);

    expect(signed).toHaveLength(2);
    expect(signed.every((tx) => tx.verifySignatures())).toBe(true);
  });

  it("tells the wallet the Playground's cluster at each signature", async () => {
    const kp = Keypair.generate();
    const current: { cluster: SigningCluster | undefined } = {
      cluster: DEVNET,
    };
    const { wallet, fake } = await connected(
      { name: "Phantom", accounts: [kp] },
      () => current.cluster
    );

    await wallet.signTransaction!(transfer(kp));
    current.cluster = MAINNET;
    await wallet.signTransaction!(transfer(kp));
    current.cluster = undefined;
    await wallet.signTransaction!(transfer(kp));

    expect(fake.signedChains()).toEqual([
      "solana:devnet",
      "solana:mainnet",
      undefined,
    ]);
  });

  it("rejects with the wallet's own message when it declines a transaction", async () => {
    const kp = Keypair.generate();
    const { wallet } = await connected({
      name: "Declines",
      accounts: [kp],
      reject: "sign",
    });

    await expect(wallet.signTransaction!(transfer(kp))).rejects.toThrow(
      fakes.FAKE_REJECTION
    );
  });

  it("signs a message that verifies against the account", async () => {
    const kp = Keypair.generate();
    const { wallet } = await connected({ name: "Phantom", accounts: [kp] });
    const message = new TextEncoder().encode("hello");

    const signature = await wallet.signMessage!(message);

    expect(
      await ed25519.verify(signature, message, kp.publicKey.toBytes())
    ).toBe(true);
  });

  it("rejects signing a message when the wallet declines", async () => {
    const { wallet } = await connected({
      name: "Declines",
      accounts: [Keypair.generate()],
      reject: "sign",
    });

    await expect(
      wallet.signMessage!(new TextEncoder().encode("x"))
    ).rejects.toThrow(fakes.FAKE_REJECTION);
  });
});
