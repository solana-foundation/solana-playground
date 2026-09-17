/**
 * Whether the backend will accept sync at all.
 *
 * Asked once and remembered, the same way the assistant panel probes
 * `/api/agent` before offering the default backend. A deployment with no
 * database answers "no" and every caller quietly stays local.
 */
export class PgSyncClient {
  static async available(): Promise<boolean> {
    if (PgSyncClient._available === null) {
      PgSyncClient._available = PgSyncClient._probe();
    }
    return PgSyncClient._available;
  }

  /** Test seam: forget the memoised probe */
  static reset() {
    PgSyncClient._available = null;
  }

  private static _available: Promise<boolean> | null = null;

  private static async _probe(): Promise<boolean> {
    try {
      const response = await fetch("/api/sync", { cache: "no-store" });
      if (!response.ok) return false;
      const body = await response.json();
      return body?.enabled === true;
    } catch {
      return false;
    }
  }
}
