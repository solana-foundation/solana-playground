/**
 * What `connect` rejects with while the wallet is `unavailable`: a wallet may
 * be stored but could not be read, so connecting must not open the Setup
 * flow, which would make a new wallet over it
 */
export class WalletUnavailableError extends Error {
  constructor() {
    super(
      "Wallet unavailable: it could not be read. Try again from Get set up."
    );
    this.name = "WalletUnavailableError";
  }
}
