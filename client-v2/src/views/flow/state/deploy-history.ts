import {
  PgCommand,
  PgConnection,
  PgExplorer,
  PgGlobal,
  PgProgramInfo,
} from "../../../utils";
import type { Disposable } from "../../../utils";

export interface DeployRecord {
  id: string;
  workspace: string;
  cluster: string;
  programId: string;
  signature: string | null;
  at: number;
}

const KEY = "flow.deploys";
// `localStorage` is user-editable and shared across every workspace this
// browser has ever opened -- keep the list from growing without bound.
const MAX_RECORDS = 50;

/** Whether `r` has every field a `DeployRecord` needs, with the right
 * types. Guards against hand-edited or corrupted `localStorage`. */
const isDeployRecord = (r: unknown): r is DeployRecord => {
  if (!r || typeof r !== "object") return false;
  const rec = r as Record<string, unknown>;
  return (
    typeof rec.id === "string" &&
    typeof rec.workspace === "string" &&
    typeof rec.cluster === "string" &&
    typeof rec.programId === "string" &&
    (rec.signature === null || typeof rec.signature === "string") &&
    typeof rec.at === "number"
  );
};

/** Every deploy this browser has made, newest first, keyed by
 * workspace. */
export class PgDeployHistory {
  static list(workspace: string): DeployRecord[] {
    return PgDeployHistory._all().filter((r) => r.workspace === workspace);
  }

  static latest(workspace: string): DeployRecord | null {
    return PgDeployHistory.list(workspace)[0] ?? null;
  }

  static add(r: Omit<DeployRecord, "id" | "at">): DeployRecord {
    const record: DeployRecord = {
      ...r,
      id: `${r.programId}-${Date.now()}`,
      at: Date.now(),
    };
    const all = [record, ...PgDeployHistory._all()].slice(0, MAX_RECORDS);
    localStorage.setItem(KEY, JSON.stringify(all));
    for (const cb of PgDeployHistory._listeners) cb();
    return record;
  }

  static onDidChange(cb: () => void): Disposable {
    PgDeployHistory._listeners.add(cb);
    cb();
    return { dispose: () => PgDeployHistory._listeners.delete(cb) };
  }

  /** Record real deploys as they finish. Call once from the Flow
   * layout. */
  static init(): Disposable {
    return PgCommand.deploy.onDidFinish((result) => {
      // A second click on Deploy while one is already running pauses or
      // resumes it and resolves immediately with `ok: undefined`; that is
      // not a completed deploy. `PgGlobal.deployState` is only "ready"
      // again once the deploy command has actually finished, successfully
      // or not.
      if (PgGlobal.deployState !== "ready") return;
      if ("err" in result) return; // Ignore deploy errors

      const programId = PgProgramInfo.getPkStr();
      const workspace = PgExplorer.currentWorkspaceName;
      const cluster = PgConnection.cluster;
      if (!programId || !workspace || !cluster) return;

      // Deploy command returns void, so signature is always null.
      // A later task can populate this from elsewhere if needed.
      PgDeployHistory.add({
        workspace,
        cluster,
        programId,
        signature: null,
      });
    });
  }

  private static _all(): DeployRecord[] {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isDeployRecord);
    } catch {
      return [];
    }
  }

  private static readonly _listeners = new Set<() => void>();
}
