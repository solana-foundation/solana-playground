import {
  PgCommon,
  PgConnection,
  PgView,
  PgWallet,
  SyncOrAsync,
} from "../../utils";
import { createLogger } from "@/shared/lib/logger";

const log = createLogger("connection:helper");

export const connection = () => {
  return PgCommon.batchChanges(async () => {
    if (Object.values(cache).every((v) => v)) return;
    if (!PgWallet.current) return;
    if (PgConnection.cluster === "playnet") return;
    if (PgConnection.isConnected && !PgConnection.isClusterDown) return;

    // Connection failed or the cluster is down. Another cluster has no
    // helper: the footer's cluster row says it is not answering (Spec 08's
    // NET-02 chip, which replaced the "Switch to localnet?" toast)
    if (PgConnection.cluster !== "localnet") return;
    executeOnce("local", async () => {
      const { Local } = await import("./Local");
      await PgView.setModal(Local);
    });
  }, [PgConnection.onDidChange, PgWallet.onDidChangeCurrent]);
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
