/**
 * What `connect` rejects with when the wallet is still `unavailable` after
 * reading it again: a wallet may be stored but could not be read, so
 * connecting must not open the Setup flow, which would make a new wallet
 * over it
 */
export class WalletUnavailableError extends Error {
  constructor() {
    super(
      "Wallet unavailable: it could not be read. Run connect to try again."
    );
    this.name = "WalletUnavailableError";
  }
}
