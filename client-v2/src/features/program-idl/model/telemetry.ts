import type { Cluster } from "@/entities/cluster";
import { createTracker } from "@/shared/lib/telemetry";

import type { IdlUploadRefusalReason } from "./upload";

/** Where an upload writes the IDL: the program's canonical Program Metadata account */
type IdlUploadTarget = "metadata";

type ProgramIdlEvents = {
  /** An upload started, before any of its checks ran. */
  idl_upload_started: { target: IdlUploadTarget; cluster: Cluster };
  /** Every transaction of an upload was confirmed on `cluster`. */
  idl_uploaded: { target: IdlUploadTarget; cluster: Cluster };
  /**
   * An upload ended without the IDL on chain; `rpc` is every failure a
   * refusal does not name. No address, signature or IDL is sent.
   */
  idl_upload_failed: {
    target: IdlUploadTarget;
    cluster: Cluster;
    reason: IdlUploadRefusalReason | "rpc";
  };
};

export const programIdlTelemetry = createTracker<ProgramIdlEvents>();
