import { createLogger } from "@/shared/lib/logger";

import { Endpoint } from "../../constants";
import {
  PgCommon,
  PgConnection,
  PgView,
  PgWallet,
  SyncOrAsync,
} from "../../utils";

const log = createLogger("connection:helper");

export const connection = () => {
  return PgCommon.batchChanges(async () => {
    if (Object.values(cache).every((v) => v)) return;
    if (!PgWallet.current) return;
    if (PgConnection.cluster === "playnet") return;
    if (PgConnection.isConnected && !PgConnection.isClusterDown) return;

    // Connection failed or the cluster is down. Another cluster has no
    // helper: the status row's network indicator says it is not responding
    // (Spec 08's NET-02 chip, which replaced the "Switch to localnet?" toast)
    if (PgConnection.cluster !== "localnet") return;
    executeOnce("local", async () => {
      const { Local } = await import("./Local");
      await PgView.setModal(Local, {
        surfpool: isSurfpool(PgConnection.current.rpcEndpoint),
      });
    });
  }, [PgConnection.onDidChange, PgWallet.onDidChangeCurrent]);
};

/** Whether the endpoint is the offered Surfpool, which reads as `localnet` */
const isSurfpool = (endpoint: string) => {
  try {
    return new URL(endpoint).href === new URL(Endpoint.SURFPOOL).href;
  } catch {
    // Never the endpoint itself: an RPC URL often holds an API key
    log.info("the endpoint does not parse; not reading it as Surfpool");
    return false;
  }
};

// Only show each helper once to not be annoying with pop-ups
const cache = {
  local: false,
};
const executeOnce = async (kind: keyof typeof cache, cb: () => SyncOrAsync) => {
  if (cache[kind]) return;
  cache[kind] = true;

  try {
    await cb();
  } catch (error) {
    // Asked again on the next connection change
    log.error(error, { report: true, context: { helper: kind } });
    cache[kind] = false;
  }
};
