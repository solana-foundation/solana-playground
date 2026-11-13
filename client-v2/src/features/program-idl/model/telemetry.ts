import { type Cluster, CLUSTERS, findClusterWith } from "@/entities/cluster";
import { createTracker } from "@/shared/lib/telemetry";

import type { IdlUploadRefusalReason } from "./refusal";

/** Where an upload writes the IDL: a Program Metadata account of the program */
type IdlUploadTarget = "metadata";

/** The cluster of the endpoint a subcommand acts on; `custom` for an endpoint that is not one of the Playground's own */
type IdlCluster = Cluster | "custom";

/**
 * The subcommands that act on a cluster and are not an upload: those of
 * `anchor idl` by name, and those of `anchor legacy-idl` by name after
 * `legacy-`, since both groups have a `fetch` and a `close`
 */
export type IdlCommand =
  | "fetch"
  | "close"
  | "create-buffer"
  | "set-buffer-authority"
  | "write-buffer"
  | "legacy-fetch"
  | "legacy-close";

/** The subcommands the terminal names and does not run */
export type UnsupportedIdlCommand = "build" | "fetch-historical";

/** What sends a transaction, as its events name it: the upload of `init` and `upgrade`, or an {@link IdlCommand} that sends */
export type IdlSend = "upload" | Exclude<IdlCommand, "fetch" | "legacy-fetch">;

/** Why a caller ended a send before its entry ran: it refuses mainnet-beta, and `rpc` is an endpoint whose network it could not read or that changed */
export type IdlSendRefusal = "mainnet" | "rpc";

/** Why an upload or an {@link IdlCommand} failed: a refusal's reason, a caller's `mainnet`, or `rpc` for every other failure */
type IdlFailureReason = IdlUploadRefusalReason | IdlSendRefusal;

type ProgramIdlEvents = {
  /** An upload started, before any of its checks ran; or its caller refused it, see {@link trackRefusedIdlSendFor}. */
  idl_upload_started: { target: IdlUploadTarget; cluster: IdlCluster };
  /** Every transaction of an upload was confirmed on `cluster`. */
  idl_uploaded: { target: IdlUploadTarget; cluster: IdlCluster };
  /**
   * An upload ended without the IDL on chain; `mainnet` is a caller's refusal
   * of mainnet-beta, and `rpc` every failure no other reason names. No
   * address, signature or IDL is sent.
   */
  idl_upload_failed: {
    target: IdlUploadTarget;
    cluster: IdlCluster;
    reason: IdlFailureReason;
  };
  /** An {@link IdlCommand} started, before any of its checks ran; or its caller refused it, see {@link trackRefusedIdlSendFor}. */
  idl_command_started: { command: IdlCommand; cluster: IdlCluster };
  /** An {@link IdlCommand} ended with its IDL read, or with every transaction it sent confirmed on `cluster`. */
  idl_command_succeeded: { command: IdlCommand; cluster: IdlCluster };
  /**
   * An {@link IdlCommand} ended any other way, `mainnet` being a caller's
   * refusal of mainnet-beta and `rpc` every failure no other reason names; or
   * an {@link UnsupportedIdlCommand} was run, which sends this event alone. No
   * address, signature, path or IDL is sent.
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
