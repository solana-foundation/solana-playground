/** `InstructionError`'s unit variants and what solana-sdk 1.18 prints for each (`#[error("...")]`) */
const INSTRUCTION_ERRORS: Record<string, string> = {
  GenericError: "generic instruction error",
  InvalidArgument: "invalid program argument",
  InvalidInstructionData: "invalid instruction data",
  InvalidAccountData: "invalid account data for instruction",
  AccountDataTooSmall: "account data too small for instruction",
  InsufficientFunds: "insufficient funds for instruction",
  IncorrectProgramId: "incorrect program id for instruction",
  MissingRequiredSignature: "missing required signature for instruction",
  AccountAlreadyInitialized: "instruction requires an uninitialized account",
  UninitializedAccount: "instruction requires an initialized account",
  UnbalancedInstruction:
    "sum of account balances before and after instruction do not match",
  ModifiedProgramId:
    "instruction illegally modified the program id of an account",
  ExternalAccountLamportSpend:
    "instruction spent from the balance of an account it does not own",
  ExternalAccountDataModified:
    "instruction modified data of an account it does not own",
  ReadonlyLamportChange:
    "instruction changed the balance of a read-only account",
  ReadonlyDataModified: "instruction modified data of a read-only account",
  DuplicateAccountIndex: "instruction contains duplicate accounts",
  ExecutableModified: "instruction changed executable bit of an account",
  RentEpochModified: "instruction modified rent epoch of an account",
  NotEnoughAccountKeys: "insufficient account keys for instruction",
  AccountDataSizeChanged:
    "program other than the account's owner changed the size of the account data",
  AccountNotExecutable: "instruction expected an executable account",
  AccountBorrowFailed:
    "instruction tries to borrow reference for an account which is already borrowed",
  AccountBorrowOutstanding:
    "instruction left account with an outstanding borrowed reference",
  DuplicateAccountOutOfSync:
    "instruction modifications of multiply-passed account differ",
  InvalidError: "program returned invalid error code",
  ExecutableDataModified: "instruction changed executable accounts data",
  ExecutableLamportChange:
    "instruction changed the balance of an executable account",
  ExecutableAccountNotRentExempt: "executable accounts must be rent exempt",
  UnsupportedProgramId: "Unsupported program id",
  CallDepth: "Cross-program invocation call depth too deep",
  MissingAccount: "An account required by the instruction is missing",
  ReentrancyNotAllowed:
    "Cross-program invocation reentrancy not allowed for this instruction",
  MaxSeedLengthExceeded:
    "Length of the seed is too long for address generation",
  InvalidSeeds: "Provided seeds do not result in a valid address",
  InvalidRealloc: "Failed to reallocate account data",
  ComputationalBudgetExceeded: "Computational budget exceeded",
  PrivilegeEscalation:
    "Cross-program invocation with unauthorized signer or writable account",
  ProgramEnvironmentSetupFailure:
    "Failed to create program execution environment",
  ProgramFailedToComplete: "Program failed to complete",
  ProgramFailedToCompile: "Program failed to compile",
  Immutable: "Account is immutable",
  IncorrectAuthority: "Incorrect authority provided",
  AccountNotRentExempt:
    "An account does not have enough lamports to be rent-exempt",
  InvalidAccountOwner: "Invalid account owner",
  ArithmeticOverflow: "Program arithmetic overflowed",
  UnsupportedSysvar: "Unsupported sysvar",
  IllegalOwner: "Provided owner is not allowed",
  MaxAccountsDataAllocationsExceeded:
    "Accounts data allocations exceeded the maximum allowed per transaction",
  MaxAccountsExceeded: "Max accounts exceeded",
  MaxInstructionTraceLengthExceeded: "Max instruction trace length exceeded",
  BuiltinProgramsMustConsumeComputeUnits:
    "Builtin programs must consume compute units",
};

/** `TransactionError`'s unit variants and what solana-sdk 1.18 prints for each */
const TRANSACTION_ERRORS: Record<string, string> = {
  AccountInUse: "Account in use",
  AccountLoadedTwice: "Account loaded twice",
  AccountNotFound:
    "Attempt to debit an account but found no record of a prior credit.",
  ProgramAccountNotFound: "Attempt to load a program that does not exist",
  InsufficientFundsForFee: "Insufficient funds for fee",
  InvalidAccountForFee: "This account may not be used to pay transaction fees",
  AlreadyProcessed: "This transaction has already been processed",
  BlockhashNotFound: "Blockhash not found",
  CallChainTooDeep: "Loader call chain is too deep",
  MissingSignatureForFee:
    "Transaction requires a fee but has no signature present",
  InvalidAccountIndex: "Transaction contains an invalid account reference",
  SignatureFailure: "Transaction did not pass signature verification",
  InvalidProgramForExecution:
    "This program may not be used for executing instructions",
  SanitizeFailure: "Transaction failed to sanitize accounts offsets correctly",
  ClusterMaintenance:
    "Transactions are currently disabled due to cluster maintenance",
  AccountBorrowOutstanding:
    "Transaction processing left an account with an outstanding borrowed reference",
  WouldExceedMaxBlockCostLimit: "Transaction would exceed max Block Cost Limit",
  UnsupportedVersion: "Transaction version is unsupported",
  InvalidWritableAccount:
    "Transaction loads a writable account that cannot be written",
  WouldExceedMaxAccountCostLimit:
    "Transaction would exceed max account limit within the block",
  WouldExceedAccountDataBlockLimit:
    "Transaction would exceed account data limit within the block",
  TooManyAccountLocks: "Transaction locked too many accounts",
  AddressLookupTableNotFound:
    "Transaction loads an address table account that doesn't exist",
  InvalidAddressLookupTableOwner:
    "Transaction loads an address table account with an invalid owner",
  InvalidAddressLookupTableData:
    "Transaction loads an address table account with invalid data",
  InvalidAddressLookupTableIndex:
    "Transaction address table lookup uses an invalid index",
  InvalidRentPayingAccount:
    "Transaction leaves an account with a lower balance than rent-exempt minimum",
  WouldExceedMaxVoteCostLimit: "Transaction would exceed max Vote Cost Limit",
  WouldExceedAccountDataTotalLimit:
    "Transaction would exceed total account data limit",
  MaxLoadedAccountsDataSizeExceeded:
    "Transaction exceeded max loaded accounts data size cap",
  InvalidLoadedAccountsDataSizeLimit:
    "LoadedAccountsDataSizeLimit set for transaction must be greater than 0.",
  ResanitizationNeeded: "ResanitizationNeeded",
  UnbalancedTransaction:
    "Sum of account balances before and after transaction do not match",
};

/** A JSON number, which kit's transport may hand over as a `bigint` */
const isIntegerLike = (value: unknown): value is number | bigint =>
  typeof value === "number" || typeof value === "bigint";

/** The one `[variant, payload]` pair of a serde externally tagged enum, or `undefined` for anything else */
const toVariant = (value: unknown): [string, unknown] | undefined => {
  if (typeof value !== "object" || value === undefined || value === null) {
    return undefined;
  }
  const entries = Object.entries(value);
  return entries.length === 1 ? entries[0] : undefined;
};

/** What Rust's `{0:#x}` prints for a custom program error code: `0x` and lowercase hex */
const toHex = (code: number | bigint) => `0x${code.toString(16)}`;

/** `InstructionError`'s `Display` (solana-program 1.18) */
const formatInstructionError = (error: unknown) => {
  if (typeof error === "string") {
    return Object.hasOwn(INSTRUCTION_ERRORS, error)
      ? INSTRUCTION_ERRORS[error]
      : error;
  }

  const variant = toVariant(error);
  if (variant) {
    const [name, payload] = variant;
    if (name === "Custom" && isIntegerLike(payload)) {
      return `custom program error: ${toHex(payload)}`;
    }
    if (name === "BorshIoError") {
      return `Failed to serialize or deserialize account data: ${String(
        payload
      )}`;
    }
  }

  return JSON.stringify(error, (_, v) =>
    typeof v === "bigint" ? v.toString() : v
  );
};

/**
 * What solana-sdk 1.18's `Display` of a `TransactionError` prints, the text
 * the Rust CLI wrote after "Transaction failed: " and "Status: ", from the
 * error's JSON-RPC form (`err` of `getSignatureStatuses` and `getTransaction`).
 * A string variant this table does not know is printed as it is, and any other
 * error it does not know as its JSON.
 *
 * @param error the `err` value of a failed transaction
 * @returns the error's text
 */
export const formatTransactionError = (error: unknown): string => {
  if (typeof error === "string") {
    return Object.hasOwn(TRANSACTION_ERRORS, error)
      ? TRANSACTION_ERRORS[error]
      : error;
  }

  const variant = toVariant(error);
  if (variant) {
    const [name, payload] = variant;
    if (name === "InstructionError" && Array.isArray(payload)) {
      const [index, instructionError] = payload;
      return `Error processing Instruction ${index}: ${formatInstructionError(
        instructionError
      )}`;
    }
    if (name === "DuplicateInstruction" && isIntegerLike(payload)) {
      return `Transaction contains a duplicate instruction (${payload}) that is not allowed`;
    }

    const accountIndex = toVariant(payload);
    const index =
      payload && typeof payload === "object" && "account_index" in payload
        ? (payload as { account_index: unknown }).account_index
        : accountIndex?.[1];
    if (name === "InsufficientFundsForRent" && isIntegerLike(index)) {
      return `Transaction results in an account (${index}) with insufficient funds for rent`;
    }
    if (
      name === "ProgramExecutionTemporarilyRestricted" &&
      isIntegerLike(index)
    ) {
      return `Execution of the program referenced by account at index ${index} is temporarily restricted.`;
    }
  }

  return JSON.stringify(error, (_, v) =>
    typeof v === "bigint" ? v.toString() : v
  );
};
