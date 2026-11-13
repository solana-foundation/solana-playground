/** Why a subcommand ended before any transaction was sent */
export type IdlUploadRefusalReason =
  | "not_found"
  | "invalid"
  | "not_deployed"
  | "authority"
  | "rejected";

/**
 * An upload, or another subcommand of the slice, that ended before any
 * transaction was sent, by a check of its own or by the wallet. `message` is
 * the whole line to show the user.
 */
export class IdlUploadRefusedError extends Error {
  override name = "IdlUploadRefusedError";

  constructor(readonly reason: IdlUploadRefusalReason, message: string) {
    super(message);
  }
}

/** The cluster holds no program at the program id: no account, an account that is not executable, or closed program data */
export class ProgramNotDeployedError extends IdlUploadRefusedError {
  override name = "ProgramNotDeployedError";

  constructor(program: string, cause: unknown) {
    super(
      "not_deployed",
      `Program ${program} is not deployed on the selected network.`
    );
    this.cause = cause;
  }
}

/** What a subcommand does to the account only the upgrade authority may change, as the lines of {@link NotProgramAuthorityError} word it */
export interface AuthorityAct {
  verb: string;
  object: string;
}

/** The wallet is not the program's upgrade authority; `authority` is `undefined` when the program has none */
export class NotProgramAuthorityError extends IdlUploadRefusedError {
  override name = "NotProgramAuthorityError";

  constructor(readonly authority: string | undefined, act: AuthorityAct) {
    super(
      "authority",
      authority
        ? `The program's upgrade authority is ${authority}. Connect that wallet to ${act.verb} the ${act.object}.`
        : `The program has no upgrade authority, so no wallet can ${act.verb} its ${act.object}.`
    );
  }
}
