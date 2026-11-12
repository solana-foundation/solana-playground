import type { PgWeb3 } from "../web3";

/** Wallet state */
export interface WalletState {
  /** Wallet connection state */
  state: "setup" | "disconnected" | "pg" | "sol";
  /** All accounts */
  accounts: WalletAccount[];
  /** Current wallet index */
  currentIndex: number;
  /** Whether to show the `Wallet` component */
  show: boolean;
  /** Wallet Standard wallets */
  standardWallets: StandardWallet[];
  /** Name of the standard wallet */
  standardName: string | null;
}

/** Playground wallet accounts (with keypair) */
export interface WalletAccount {
  /**
   * ed25519 keypair of the account.
   *
   * First 32 bytes are the private key, last 32 bytes are the public key.
   */
  kp: number[];
  /** Name of the account */
  name: string;
}

/** Serialized wallet that's used in storage */
export type SerializedWalletState = Pick<
  WalletState,
  "state" | "accounts" | "currentIndex" | "standardName"
>;

/** Legacy or versioned transaction */
export type AnyTransaction = PgWeb3.Transaction | PgWeb3.VersionedTransaction;

/**
 * The current wallet which can be a Playground Wallet or a Wallet Standard
 * Wallet.
 *
 * **NOTE:** If this is a Standard Wallet, it should always have its `publicKey`
 * field defined (non-nullable).
 */
export type Wallet = PgWallet | StandardWallet<true>;

/** Playground Wallet props */
type PgWallet = {
  /** The wallet is Playground Wallet */
  isPg: true;
  /** Keypair of the Playground Wallet account */
  keypair: PgWeb3.Keypair;
  /** Name of the account */
  name: string;
} & NonNullablePublicKeyProp &
  SignerWalletProps;

/** Events a Wallet Standard wallet emits to the app */
export interface StandardWalletEvents {
  /** Connected, or the selected account changed while connected */
  connect(): void;
  /** Disconnected, by the app or from inside the wallet */
  disconnect(): void;
}

/**
 * What the app reads from a Wallet Standard wallet: the members wallet-adapter's
 * `StandardWalletAdapter` had and the app used, so the call sites did not
 * change when discovery moved to ConnectorKit (`entities/external-wallet`).
 */
export interface StandardWalletAdapter {
  /** Wallet Standard name, also the key `PgWallet.standardName` stores */
  readonly name: string;
  /** Data URI */
  readonly icon: string;
  /** A registered wallet is installed */
  readonly readyState: "Installed";
  readonly connected: boolean;
  readonly connecting: boolean;
  /** The selected Solana account; `null` while not connected */
  readonly publicKey: PgWeb3.PublicKey | null;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Absent when the wallet cannot sign transactions */
  signTransaction?<T extends AnyTransaction>(tx: T): Promise<T>;
  /** Absent when the wallet cannot sign transactions */
  signAllTransactions?<T extends AnyTransaction>(txs: T[]): Promise<T[]>;
  /** Absent when the wallet cannot sign messages */
  signMessage?(message: Uint8Array): Promise<Uint8Array>;
  on<E extends keyof StandardWalletEvents>(
    event: E,
    fn: StandardWalletEvents[E]
  ): void;
  off<E extends keyof StandardWalletEvents>(
    event: E,
    fn: StandardWalletEvents[E]
  ): void;
}

/** All wallets other than Playground Wallet */
export type StandardWallet<C extends boolean = false> = {
  /** The wallet is not Playground Wallet */
  isPg?: false;
} & (C extends true
  ? Omit<StandardWalletAdapter, "publicKey"> &
      NonNullablePublicKeyProp &
      SignerWalletProps
  : StandardWalletAdapter);

/** Non-nullable public key property (connected state) */
interface NonNullablePublicKeyProp {
  /** Public key of the account */
  publicKey: PgWeb3.PublicKey;
}

/** Signer methods */
interface SignerWalletProps {
  signTransaction<T extends AnyTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends AnyTransaction>(txs: T[]): Promise<T[]>;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

/** Optional `wallet` prop */
export interface WalletOption {
  /** Wallet to use */
  wallet?: Wallet;
}
