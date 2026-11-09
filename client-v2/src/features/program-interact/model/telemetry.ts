import type { Cluster } from "@/entities/cluster";
import { createTracker } from "@/shared/lib/telemetry";

/** The cluster a call went to, `custom` when the endpoint names none */
export type InteractCluster = Cluster | "custom";

/** Where a call stopped: no signature came back (`send`), or one did and the transaction failed or its confirmation is unknown (`confirm`) */
export type InteractFailedPhase = "send" | "confirm";

type InteractEvents = {
  /** An instruction call's transaction went out: a signature came back. Never the instruction, program, address or signature. */
  interact_sent: { cluster: InteractCluster };
  /** That transaction confirmed without an error. */
  interact_succeeded: { cluster: InteractCluster };
  /** The user declined to sign an instruction call in their wallet, so nothing went out. Not a failure: `interact_failed` never counts it. */
  interact_cancelled: { cluster: InteractCluster };
  /** An instruction call did not succeed, stopping at `phase`. A wallet the user said no to is `interact_cancelled` instead. */
  interact_failed: { cluster: InteractCluster; phase: InteractFailedPhase };
};

export const interactTelemetry = createTracker<InteractEvents>();
