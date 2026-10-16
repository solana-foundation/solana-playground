import { isMissing, report } from "./diagnostics";
// Deep imports, not the `utils` barrel, for the reason `snapshot.ts` gives
import { PgFs } from "../../../utils/explorer/fs";
import { PgWorkspace } from "../../../utils/explorer/workspace";

/**
 * The workspaces the store records, name to id.
 *
 * Read the way the explorer reads it, migration included, so a config still
 * in the pre-id shape compares as what the explorer made of it.
 *
 * @returns the map; `"missing"` when there is no config to read, which is not
 * evidence of anything -- a browser that has never initialized has none --
 * so callers treat it as "cannot tell", not as "nothing is registered"; or
 * `"unreadable"` when there is one and it could not be read or parsed
 */
const onDisk = async (): Promise<
  Map<string, string> | "missing" | "unreadable"
> => {
  let raw: string;
  try {
    raw = await PgFs.readToString(PgWorkspace.WORKSPACES_CONFIG_PATH);
  } catch (e) {
    if (isMissing(e)) return "missing";
    report("read workspace registry", e);
    return "unreadable";
  }

  try {
    const { workspaces } = PgWorkspace.migrate(JSON.parse(raw));
    return new Map(workspaces.map((w) => [w.name, w.id]));
  } catch (e) {
    report("parse workspace registry", e);
    return "unreadable";
  }
};

/**
 * The list of workspaces as the store records it.
 *
 * Each tab holds its own copy in memory, re-read at the start of every
 * reload and whenever a neighbour writes it -- but a neighbour can still
 * rename or delete a workspace in the moment before this tab hears of it.
 * An upload has to ask the store, not memory, whether its workspace still
 * exists.
 */
export const PgWorkspaceRegistry = {
  /**
   * Whether the store's registry still has `name` under `id`.
   *
   * `true` when there is no registry to ask. Not when there is one that
   * cannot be read: a config caught half-written, or corrupted, says
   * nothing about whether the workspace is still there, and the callers
   * are about to upload -- a push that waits loses nothing, while one sent
   * over a renamed workspace puts its leftovers on the account.
   */
  async has(name: string, id: string): Promise<boolean> {
    const disk = await onDisk();
    if (disk === "missing") return true;
    if (disk === "unreadable") return false;
    return disk.get(name) === id;
  },

  /**
   * Whether the store's registry has `id` under any name.
   *
   * @returns `null` when there is no registry to ask, or it cannot be read:
   * the callers are about to delete, and "cannot tell" must not read as
   * "not there"
   */
  async lists(id: string): Promise<boolean | null> {
    const disk = await onDisk();
    if (disk === "missing" || disk === "unreadable") return null;
    return [...disk.values()].includes(id);
  },
};
