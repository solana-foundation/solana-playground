import {
  createTransactionSigner,
  getWalletsRegistry,
  isTransactionError,
  ready,
  type WalletStandardAccount,
  type WalletStandardWallet,
} from "@solana/connector";
import { PublicKey } from "@solana/web3.js";

import { createLogger } from "@/shared/lib/logger";
import type {
  AnyTransaction,
  StandardWallet,
  StandardWalletAdapter,
  StandardWalletEvents,
} from "../../../utils/wallet/types";

const log = createLogger("external-wallet:bridge");

/** The Wallet Standard features the bridge calls, as their specs declare them */
interface ConnectFeature {
  connect(): Promise<{ accounts: readonly WalletStandardAccount[] }>;
}
interface DisconnectFeature {
  disconnect(): Promise<void>;
}
interface EventsFeature {
  on(
    event: "change",
    fn: (properties: { accounts?: readonly WalletStandardAccount[] }) => void
  ): () => void;
}
interface SignMessageFeature {
  signMessage(
    ...inputs: { account: WalletStandardAccount; message: Uint8Array }[]
  ): Promise<{ signature: Uint8Array }[]>;
}

const feature = <T>(
  wallet: WalletStandardWallet,
  name: `${string}:${string}`
) => wallet.features[name] as T | undefined;

const isSolanaChain = (chain: string) => chain.startsWith("solana:");

/**
 * The features a wallet needs before the app lists it, as wallet-adapter's
 * `isWalletAdapterCompatibleStandardWallet` required: `PgWallet` hands a
 * connected wallet to every signing path, and a wallet without `standard:events`
 * would never report a revoke or an account switch
 */
const REQUIRED_FEATURES = [
  "standard:connect",
  "standard:events",
  "solana:signTransaction",
] as const;

/** A wallet the app can use: it speaks Solana, connects, reports and signs */
const isUsableWallet = (wallet: WalletStandardWallet) =>
  wallet.chains.some(isSolanaChain) &&
  REQUIRED_FEATURES.every((name) => !!wallet.features[name]);

/** Like `isUsableWallet`, but a malformed wallet is skipped, not thrown on */
const isListed = (wallet: WalletStandardWallet) => {
  try {
    return isUsableWallet(wallet);
  } catch (error: unknown) {
    log.warn("skipped a malformed wallet", {
      context: { name: String(wallet?.name), error: String(error) },
    });
    return false;
  }
};

const firstSolanaAccount = (accounts: readonly WalletStandardAccount[]) =>
  accounts.find((account) => account.chains.some(isSolanaChain)) ?? null;

/**
 * The wallet's own error, not ConnectorKit's wrapper: the signer rethrows every
 * failure as "Failed to sign transaction", which would hide a user's rejection
 */
const unwrap = (error: unknown) =>
  isTransactionError(error) && error.originalError
    ? error.originalError
    : error;

/** The chain hint a wallet signs with; `undefined` signs without one */
export interface SigningCluster {
  id: `solana:${string}`;
  label: string;
  url: string;
}

export interface WatchOptions {
  /** Read at each signature, so a cluster change applies to the next one */
  signingCluster: () => SigningCluster | undefined;
}

/**
 * One Wallet Standard wallet in the shape `PgWallet` reads. It connects through
 * the wallet's own `standard:connect`, not through a ConnectorKit session: a
 * session holds one wallet, and the app lets several be connected at once, so
 * that connecting a payer never drops the current wallet.
 */
class BridgedWallet implements StandardWalletAdapter {
  readonly readyState = "Installed" as const;
  readonly signMessage?: (message: Uint8Array) => Promise<Uint8Array>;

  private account: WalletStandardAccount | null = null;
  /** The connection request in flight; set exactly while connecting */
  private pending: Promise<void> | null = null;
  private listeners: {
    [E in keyof StandardWalletEvents]: Set<StandardWalletEvents[E]>;
  } = { connect: new Set(), disconnect: new Set() };

  constructor(
    private readonly wallet: WalletStandardWallet,
    private readonly opts: WatchOptions
  ) {
    // Never unsubscribed: one bridged object lives as long as its wallet
    feature<EventsFeature>(wallet, "standard:events")?.on("change", (props) =>
      this.onChange(props.accounts)
    );

    const signMessage = feature<SignMessageFeature>(
      wallet,
      "solana:signMessage"
    );
    if (signMessage) {
      this.signMessage = async (message) => {
        const [signed] = await signMessage.signMessage({
          account: this.connectedAccount(),
          message,
        });
        if (!signed) throw new Error(`${this.name} returned no signature`);
        return signed.signature;
      };
    }
  }

  get name() {
    return this.wallet.name;
  }

  get icon() {
    return this.wallet.icon;
  }

  get connected() {
    return !!this.account;
  }

  get connecting() {
    return !!this.pending;
  }

  get publicKey() {
    return this.account ? new PublicKey(this.account.publicKey) : null;
  }

  /** Asks the wallet once; a second call while it asks waits on the same answer */
  connect() {
    if (this.account) return Promise.resolve();
    this.pending ??= this.requestConnect().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  /** Local state clears even when the wallet fails to disconnect, as wallet-adapter's did */
  async disconnect() {
    try {
      await feature<DisconnectFeature>(
        this.wallet,
        "standard:disconnect"
      )?.disconnect();
    } finally {
      this.setAccount(null);
    }
  }

  async signTransaction<T extends AnyTransaction>(tx: T) {
    try {
      return (await this.signer().signTransaction(tx)) as T;
    } catch (error: unknown) {
      throw unwrap(error);
    }
  }

  async signAllTransactions<T extends AnyTransaction>(txs: T[]) {
    try {
      return (await this.signer().signAllTransactions(txs)) as T[];
    } catch (error: unknown) {
      throw unwrap(error);
    }
  }

  on<E extends keyof StandardWalletEvents>(
    event: E,
    fn: StandardWalletEvents[E]
  ) {
    this.listeners[event].add(fn);
  }

  off<E extends keyof StandardWalletEvents>(
    event: E,
    fn: StandardWalletEvents[E]
  ) {
    this.listeners[event].delete(fn);
  }

  private async requestConnect() {
    const connect = feature<ConnectFeature>(this.wallet, "standard:connect");
    if (!connect) throw new Error(`${this.name} cannot connect`);
    const { accounts } = await connect.connect();
    const account = firstSolanaAccount(accounts);
    if (!account) throw new Error(`${this.name} has no Solana account`);
    this.setAccount(account);
  }

  /** The wallet reported new accounts: a switch inside it, or a revoke */
  private onChange(accounts: readonly WalletStandardAccount[] | undefined) {
    // Only a connected wallet follows its accounts; a wallet that reports
    // accounts unasked has not been approved by this app
    if (!accounts || !this.account) return;
    const next = firstSolanaAccount(accounts);
    if (next?.address === this.account.address) return;
    this.setAccount(next);
  }

  private setAccount(account: WalletStandardAccount | null) {
    const was = this.account;
    this.account = account;
    if (account) this.emit("connect");
    else if (was) this.emit("disconnect");
  }

  /** Each listener on its own, so one that throws does not silence the rest */
  private emit(event: keyof StandardWalletEvents) {
    this.listeners[event].forEach((fn) => {
      try {
        fn();
      } catch (error: unknown) {
        log.error(error, {
          report: true,
          context: { event, wallet: this.name },
        });
      }
    });
  }

  private connectedAccount() {
    if (!this.account) throw new Error(`${this.name} is not connected`);
    return this.account;
  }

  private signer() {
    const signer = createTransactionSigner({
      wallet: this.wallet,
      account: this.connectedAccount(),
      cluster: this.opts.signingCluster(),
    });
    if (!signer) throw new Error(`${this.name} cannot sign transactions`);
    return signer;
  }
}

/**
 * One bridged object per wallet, so listeners on it survive a new list. The
 * options of the first `watchExternalWallets` call that met a wallet stay with
 * it; the app has one caller (`SolanaProvider`).
 */
const bridged = new WeakMap<WalletStandardWallet, BridgedWallet>();

const bridge = (
  wallet: WalletStandardWallet,
  opts: WatchOptions
): StandardWallet => {
  let found = bridged.get(wallet);
  if (!found) {
    found = new BridgedWallet(wallet, opts);
    bridged.set(wallet, found);
  }
  return found;
};

/**
 * Call `onChange` with every usable Solana wallet now, once ConnectorKit's
 * registry is ready, and whenever a wallet registers or unregisters.
 *
 * @returns a function that stops watching
 */
export const watchExternalWallets = (
  onChange: (wallets: StandardWallet[]) => void,
  opts: WatchOptions
): (() => void) => {
  const registry = getWalletsRegistry();
  let stopped = false;
  const publish = () => {
    if (stopped) return;
    onChange(
      registry
        .get()
        .filter(isListed)
        .map((w) => bridge(w, opts))
    );
  };

  publish();
  ready.then(publish, (error: unknown) => {
    log.error(error, { report: true, context: { step: "registry ready" } });
  });
  const offRegister = registry.on("register", publish);
  const offUnregister = registry.on("unregister", publish);

  return () => {
    stopped = true;
    offRegister();
    offUnregister();
  };
};

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll, afterEach } = import.meta.vitest;

  describe("entities/external-wallet/model/bridge", () => {
    let registerFakeWallet: typeof import("../../../test-utils/fake-wallet").registerFakeWallet;
    let FAKE_REJECTION: typeof import("../../../test-utils/fake-wallet").FAKE_REJECTION;
    let Keypair: typeof import("@solana/web3.js").Keypair;
    type FakeWallet = import("../../../test-utils/fake-wallet").FakeWallet;

    const fakes: FakeWallet[] = [];
    const disposers: (() => void)[] = [];

    beforeAll(async () => {
      ({ registerFakeWallet, FAKE_REJECTION } = await import(
        "../../../test-utils/fake-wallet"
      ));
      ({ Keypair } = await import("@solana/web3.js"));
    });

    afterEach(() => {
      fakes.splice(0).forEach((f) => f.unregister());
      disposers.splice(0).forEach((d) => d());
    });

    const fake = (opts: Parameters<typeof registerFakeWallet>[0]) => {
      const f = registerFakeWallet(opts);
      fakes.push(f);
      return f;
    };

    /** The latest list the bridge published */
    const watch = () => {
      const seen: { latest: StandardWallet[] } = { latest: [] };
      disposers.push(
        watchExternalWallets(
          (wallets) => {
            seen.latest = wallets;
          },
          { signingCluster: () => undefined }
        )
      );
      return seen;
    };

    const named = (seen: { latest: StandardWallet[] }, name: string) => {
      const wallet = seen.latest.find((w) => w.name === name);
      if (!wallet) throw new Error(`${name} not listed`);
      return wallet;
    };

    const settle = () => new Promise((r) => setTimeout(r, 0));

    it("lists a Solana wallet with its name and icon", async () => {
      fake({ name: "Phantom", accounts: [Keypair.generate()] });
      const seen = watch();
      await settle();

      const phantom = named(seen, "Phantom");
      expect(phantom.icon).toMatch(/^data:image\//);
      expect(phantom.readyState).toBe("Installed");
      expect(phantom.connected).toBe(false);
      expect(phantom.publicKey).toBeNull();
    });

    it("lists a wallet registered after the first list", async () => {
      const seen = watch();
      await settle();
      fake({ name: "Late", accounts: [Keypair.generate()] });

      expect(seen.latest.map((w) => w.name)).toContain("Late");
    });

    it("does not list a wallet without a solana chain", async () => {
      fake({ name: "EvmOnly", chains: ["eip155:1"], accounts: [] });
      const seen = watch();
      await settle();

      expect(seen.latest.map((w) => w.name)).not.toContain("EvmOnly");
    });

    it("drops a wallet that unregisters", async () => {
      const gone = registerFakeWallet({
        name: "Gone",
        accounts: [Keypair.generate()],
      });
      const seen = watch();
      await settle();
      gone.unregister();

      expect(seen.latest.map((w) => w.name)).not.toContain("Gone");
    });

    it("connects, then reports connected with the first account's public key", async () => {
      const kp = Keypair.generate();
      fake({ name: "Phantom", accounts: [kp] });
      const seen = watch();
      await settle();
      const phantom = named(seen, "Phantom");
      let connectEvents = 0;
      phantom.on("connect", () => connectEvents++);

      await phantom.connect();

      expect(phantom.connected).toBe(true);
      expect(phantom.connecting).toBe(false);
      expect(phantom.publicKey?.toBase58()).toBe(kp.publicKey.toBase58());
      expect(connectEvents).toBe(1);
    });

    it("rejects connect when the wallet declines, and is no longer connecting", async () => {
      fake({
        name: "Phantom",
        accounts: [Keypair.generate()],
        reject: "connect",
      });
      const seen = watch();
      await settle();
      const phantom = named(seen, "Phantom");

      await expect(phantom.connect()).rejects.toThrow(FAKE_REJECTION);

      expect(phantom.connected).toBe(false);
      expect(phantom.connecting).toBe(false);
    });

    it("shares one connect while a connect is in flight", async () => {
      const f = fake({ name: "Phantom", accounts: [Keypair.generate()] });
      const seen = watch();
      await settle();
      const phantom = named(seen, "Phantom");

      await Promise.all([phantom.connect(), phantom.connect()]);

      expect(f.connectCalls()).toBe(1);
    });

    it("fires connect and changes publicKey when the account switches", async () => {
      const first = Keypair.generate();
      const second = Keypair.generate();
      const f = fake({ name: "Phantom", accounts: [first, second] });
      const seen = watch();
      await settle();
      const phantom = named(seen, "Phantom");
      await phantom.connect();
      let connectEvents = 0;
      phantom.on("connect", () => connectEvents++);

      f.switchAccount(1);

      expect(phantom.publicKey?.toBase58()).toBe(second.publicKey.toBase58());
      expect(connectEvents).toBe(1);
    });

    it("disconnects when the wallet drops every account", async () => {
      const f = fake({ name: "Phantom", accounts: [Keypair.generate()] });
      const seen = watch();
      await settle();
      const phantom = named(seen, "Phantom");
      await phantom.connect();
      let disconnectEvents = 0;
      phantom.on("disconnect", () => disconnectEvents++);

      f.revokeAll();

      expect(phantom.connected).toBe(false);
      expect(phantom.publicKey).toBeNull();
      expect(disconnectEvents).toBe(1);
    });

    it("disconnects and fires disconnect", async () => {
      fake({ name: "Phantom", accounts: [Keypair.generate()] });
      const seen = watch();
      await settle();
      const phantom = named(seen, "Phantom");
      await phantom.connect();
      let disconnectEvents = 0;
      phantom.on("disconnect", () => disconnectEvents++);

      await phantom.disconnect();

      expect(phantom.connected).toBe(false);
      expect(disconnectEvents).toBe(1);
    });

    it("connecting a second wallet leaves the first connected", async () => {
      fake({ name: "Phantom", accounts: [Keypair.generate()] });
      fake({ name: "Solflare", accounts: [Keypair.generate()] });
      const seen = watch();
      await settle();

      await named(seen, "Phantom").connect();
      await named(seen, "Solflare").connect();

      expect(named(seen, "Phantom").connected).toBe(true);
      expect(named(seen, "Solflare").connected).toBe(true);
    });

    it("keeps the same object for a wallet across lists", async () => {
      fake({ name: "Phantom", accounts: [Keypair.generate()] });
      const seen = watch();
      await settle();
      const before = named(seen, "Phantom");
      fake({ name: "Other", accounts: [Keypair.generate()] });

      expect(named(seen, "Phantom")).toBe(before);
    });

    it("does not list a wallet that cannot sign transactions", async () => {
      fake({
        name: "SendOnly",
        accounts: [Keypair.generate()],
        withoutSigning: true,
      });
      const seen = watch();
      await settle();

      expect(seen.latest.map((w) => w.name)).not.toContain("SendOnly");
    });

    it("does not list a wallet that cannot report changes", async () => {
      fake({
        name: "Silent",
        accounts: [Keypair.generate()],
        withoutEvents: true,
      });
      const seen = watch();
      await settle();

      expect(seen.latest.map((w) => w.name)).not.toContain("Silent");
    });

    it("skips a malformed wallet and lists the rest", async () => {
      fake({ name: "Phantom", accounts: [Keypair.generate()] });
      let unregister: () => void = () => undefined;
      window.dispatchEvent(
        new CustomEvent("wallet-standard:register-wallet", {
          detail: ({ register }: { register: (w: unknown) => () => void }) => {
            unregister = register({ name: "Broken", features: {} });
          },
        })
      );
      disposers.push(() => unregister());
      const seen = watch();
      await settle();

      expect(seen.latest.map((w) => w.name)).toEqual(["Phantom"]);
    });

    it("connects again after a declined connect", async () => {
      fake({
        name: "Phantom",
        accounts: [Keypair.generate()],
        reject: "connect-once",
      });
      const seen = watch();
      await settle();
      const phantom = named(seen, "Phantom");
      await expect(phantom.connect()).rejects.toThrow(FAKE_REJECTION);

      await phantom.connect();

      expect(phantom.connected).toBe(true);
    });

    it("ignores accounts a wallet reports before the app connected", async () => {
      const f = fake({ name: "Phantom", accounts: [Keypair.generate()] });
      const seen = watch();
      await settle();
      const phantom = named(seen, "Phantom");
      let connectEvents = 0;
      phantom.on("connect", () => connectEvents++);

      f.announceUnasked();

      expect(phantom.connected).toBe(false);
      expect(connectEvents).toBe(0);
    });

    it("publishes nothing once stopped", async () => {
      const seen = watch();
      await settle();
      disposers.splice(0).forEach((d) => d());

      fake({ name: "AfterStop", accounts: [Keypair.generate()] });

      expect(seen.latest.map((w) => w.name)).not.toContain("AfterStop");
    });
  });
}
