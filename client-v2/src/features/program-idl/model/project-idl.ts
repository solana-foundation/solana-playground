import type { Cluster } from "@/entities/cluster";
import { readIdl } from "@/entities/idl";
import { createLogger } from "@/shared/lib/logger";

import { programIdlTelemetry } from "./telemetry";
import {
  type IdlUploadDeps,
  IdlUploadRefusedError,
  type IdlUploadResult,
  uploadIdl,
} from "./upload";

const log = createLogger("program-idl:project-idl");

/** What an upload of the project's IDL takes from its caller */
export interface ProjectIdlUpload {
  /** The IDL as the project holds it, in either Anchor format; `undefined` when it holds none */
  idl: object | undefined;
  /** Base58 */
  programId: string;
  connection: IdlUploadDeps["connection"];
  wallet: IdlUploadDeps["wallet"];
  /** The cluster `connection` talks to, as the events name it */
  cluster: Cluster;
}

/** The JSON an upload sends: the project's IDL as it is, when it is in the Anchor 0.30+ format */
const toUploadJson = (idl: object | undefined) => {
  if (!idl) {
    throw new IdlUploadRefusedError(
      "not_found",
      "The project has no IDL to upload."
    );
  }
  if (readIdl(idl).kind !== "v1") {
    throw new IdlUploadRefusedError(
      "invalid",
      "The project's IDL is not in the Anchor 0.30+ format."
    );
  }
  return JSON.stringify(idl);
};

/**
 * Uploads the IDL the project holds to the program's canonical Program
 * Metadata account and sends the upload's events. Throws an
 * {@link IdlUploadRefusedError}, whose `message` is the line to show, when nothing was sent.
 */
export const uploadProjectIdl = async ({
  idl,
  programId,
  connection,
  wallet,
  cluster,
}: ProjectIdlUpload): Promise<IdlUploadResult> => {
  programIdlTelemetry.track("idl_upload_started", {
    target: "metadata",
    cluster,
  });
  let result: IdlUploadResult;
  try {
    result = await uploadIdl(
      { connection, wallet },
      { program: programId, json: toUploadJson(idl) }
    );
  } catch (error) {
    const refused = error instanceof IdlUploadRefusedError;
    programIdlTelemetry.track("idl_upload_failed", {
      target: "metadata",
      cluster,
      reason: refused ? error.reason : "rpc",
    });
    // A refusal is an answer the user reads as a line; any other failure is logged for whoever looks into it
    if (!refused) log.error(error, { context: { cluster } });
    throw error;
  }
  programIdlTelemetry.track("idl_uploaded", { target: "metadata", cluster });
  return result;
};
