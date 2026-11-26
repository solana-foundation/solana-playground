/** The refusal of a change of account while a deploy runs */
export class AccountsHeldError extends Error {
  /** A refusal the person reads as it is, not a failure to report */
  readonly isPlain = true;

  constructor() {
    super("A deploy is running: accounts cannot change until it ends.");
    this.name = "AccountsHeldError";
  }
}
