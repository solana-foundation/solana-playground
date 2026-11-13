import { createLogger } from "@/shared/lib/logger";

import { IdlCommandRefusedError } from "./refusal";
import { DEFAULT_PRIORITY_FEE, type IdlSendDeps } from "./send";
import {
  getEventCluster,
  getFailureReason,
  programIdlTelemetry,
} from "./telemetry";
import {
  type IdlSource,
  type IdlUploadResult,
  toUploadJson,
  uploadIdlWith,
  uploadNonCanonicalIdlWith,
} from "./upload";

const log = createLogger("program-idl:project-idl");

/** What an upload takes from its caller */
export interface ProjectIdlUpload {
  source: IdlSource;
  /** Base58; not read when there is no IDL to upload */
  programId: string;
  /** Its `rpcEndpoint` also names the events' `cluster` */
  connection: IdlSendDeps["connection"];
  wallet: IdlSendDeps["wallet"];
}

const trackUploadFor =
  (uploadWith: typeof uploadIdlWith) =>
  (priorityFee: bigint) =>
  async ({
    source,
    programId,
    connection,
    wallet,
  }: ProjectIdlUpload): Promise<IdlUploadResult> => {
    const cluster = getEventCluster(connection.rpcEndpoint);
    programIdlTelemetry.track("idl_upload_started", {
      target: "metadata",
      cluster,
    });
    let result: IdlUploadResult;
    try {
      // Checked before the program id is read: a caller whose IDL file is missing may have no program id
      const json = toUploadJson(source);
      result = await uploadWith(priorityFee)(
        { connection, wallet },
        { program: programId, json }
      );
    } catch (error) {
      programIdlTelemetry.track("idl_upload_failed", {
        target: "metadata",
        cluster,
        reason: getFailureReason(error),
      });
      // A refusal is an answer the user reads as a line; any other failure is logged for whoever looks into it
      if (!(error instanceof IdlCommandRefusedError)) {
        log.error(error, { context: { cluster } });
      }
      throw error;
    }
    programIdlTelemetry.track("idl_uploaded", { target: "metadata", cluster });
    return result;
  };

/**
 * Uploads the IDL to the program's canonical Program Metadata account, at
 * `priorityFee` micro-lamports per compute unit, and sends the upload's events. Throws as
 * {@link uploadIdlWith} does: an {@link IdlCommandRefusedError} while nothing was sent, then an {@link UnfinishedIdlUploadError} or an {@link IdlSendFailedError}.
 */
export const uploadProjectIdlWith = trackUploadFor(uploadIdlWith);

/** As {@link uploadProjectIdlWith}, to the connected wallet's own account of the program; refuses the upgrade authority, whose IDL goes to the canonical account */
export const uploadNonCanonicalProjectIdlWith = trackUploadFor(
  uploadNonCanonicalIdlWith
);

/** {@link uploadProjectIdlWith} at {@link DEFAULT_PRIORITY_FEE} */
export const uploadProjectIdl = uploadProjectIdlWith(DEFAULT_PRIORITY_FEE);
