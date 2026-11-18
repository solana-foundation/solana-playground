import { type Cluster, CLUSTERS, findClusterWith } from "@/entities/cluster";
import { createTracker } from "@/shared/lib/telemetry";

import {
  type IdlCommandRefusalReason,
  IdlCommandRefusedError,
} from "./refusal";
import { IdlSendFailedError } from "./send";
import { UnfinishedIdlUploadError } from "./upload";

/** Where an upload writes the IDL: a Program Metadata account of the program */
type IdlUploadTarget = "metadata";

/** The cluster of the endpoint a subcommand acts on; `custom` for an endpoint that is not one of the Playground's own */
type IdlCluster = Cluster | "custom";

/** The subcommands of `anchor idl` that act on a cluster and are not an upload */
export type IdlCommand =
  | "fetch"
  | "close"
  | "create-buffer"
  | "set-buffer-authority"
  | "write-buffer";

/** The subcommands of `anchor idl`, and the `anchor legacy-idl` group, that the terminal names and does not run */
export type UnsupportedIdlCommand =
  | "build"
  | "fetch-historical"
  | "convert"
  | "type"
  | "legacy-idl";

/** What sends a transaction, as its events name it: the upload of `init` and `upgrade`, or an {@link IdlCommand} that sends */
export type IdlSend = "upload" | Exclude<IdlCommand, "fetch">;

/** Why a caller ended a send before its entry ran: it refuses mainnet, and `rpc` is an endpoint whose network it could not read or that changed */
export type IdlSendRefusal = "mainnet" | "rpc";

/**
 * Why a send failed once its first transaction went to the cluster: `unfinished`
 * when it left a buffer the terminal names ({@link UnfinishedIdlUploadError}),
 * `send_failed` when it left none or none could be read ({@link IdlSendFailedError}).
 */
type IdlSendFailure = "unfinished" | "send_failed";

/** Why an upload or an {@link IdlCommand} failed: a refusal's reason, a caller's `mainnet`, a failure after the first send, or `rpc` for every other failure before it */
type IdlFailureReason =
  | IdlCommandRefusalReason
  | IdlSendRefusal
  | IdlSendFailure;

/** The `reason` of the failure event for what an entry of the slice threw */
export const getFailureReason = (error: unknown): IdlFailureReason => {
  if (error instanceof IdlCommandRefusedError) return error.reason;
  if (error instanceof UnfinishedIdlUploadError) return "unfinished";
  if (error instanceof IdlSendFailedError) return "send_failed";
  return "rpc";
};

type ProgramIdlEvents = {
  /** The slice's upload entry ran, before any of its checks; or its caller refused the upload, see {@link trackRefusedIdlSendFor}. A caller's exit before either, such as a declined wallet question, sends nothing. */
  idl_upload_started: { target: IdlUploadTarget; cluster: IdlCluster };
  /** Every transaction of an upload was confirmed on `cluster`. */
  idl_uploaded: { target: IdlUploadTarget; cluster: IdlCluster };
  /**
   * An upload ended without the IDL on chain, for the {@link IdlFailureReason}
   * {@link getFailureReason} reads. No address, signature or IDL is sent.
   */
  idl_upload_failed: {
    target: IdlUploadTarget;
    cluster: IdlCluster;
    reason: IdlFailureReason;
  };
  /** The slice's entry of an {@link IdlCommand} ran, before any of its checks; or its caller refused it, see {@link trackRefusedIdlSendFor}. A caller's exit before either sends nothing. */
  idl_command_started: { command: IdlCommand; cluster: IdlCluster };
  /** An {@link IdlCommand} ended with its IDL read, or with every transaction it sent confirmed on `cluster`. */
  idl_command_succeeded: { command: IdlCommand; cluster: IdlCluster };
  /**
   * An {@link IdlCommand} ended any other way, for the {@link IdlFailureReason}
   * {@link getFailureReason} reads; or an {@link UnsupportedIdlCommand} was run,
   * which sends this event alone. No address, signature, path or IDL is sent.
   */
  idl_command_failed:
    | {
        command: IdlCommand;
        cluster: IdlCluster;
        reason: IdlFailureReason;
      }
    | {
        command: UnsupportedIdlCommand;
        cluster: IdlCluster;
        reason: "unsupported";
      };
};

export const programIdlTelemetry = createTracker<ProgramIdlEvents>();

const findCluster = findClusterWith(CLUSTERS);

/** The `cluster` of an event, read from the endpoint here so that every caller's events name a cluster the same way */
export const getEventCluster = (rpcEndpoint: string): IdlCluster =>
  findCluster(rpcEndpoint) ?? "custom";

/**
 * Sends the two events of a send that its caller ended before the entry ran:
 * the start, then the failure, as the entry orders them. A send that reaches
 * its entry is recorded there, and must not be recorded here too.
 */
export const trackRefusedIdlSendFor =
  (send: IdlSend) => (rpcEndpoint: string, reason: IdlSendRefusal) => {
    const cluster = getEventCluster(rpcEndpoint);
    if (send === "upload") {
      const target = "metadata";
      programIdlTelemetry.track("idl_upload_started", { target, cluster });
      programIdlTelemetry.track("idl_upload_failed", {
        target,
        cluster,
        reason,
      });
      return;
    }
    programIdlTelemetry.track("idl_command_started", {
      command: send,
      cluster,
    });
    programIdlTelemetry.track("idl_command_failed", {
      command: send,
      cluster,
      reason,
    });
  };
