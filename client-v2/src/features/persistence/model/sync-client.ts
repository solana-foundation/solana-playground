import { LOCKED_REQUEST_MS } from "./sync-lock";
import { timeoutSignal } from "@/shared/lib/timeout-signal";

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
      const probe: Promise<boolean> = PgSyncClient._probe().then((answer) => {
        // No answer is not a "no". Remembered, a request that timed out or
        // met a dead connection would turn sync off for the life of the tab.
        if (answer === null && PgSyncClient._available === probe) {
          PgSyncClient._available = null;
        }
        return answer === true;
      });
      PgSyncClient._available = probe;
    }
    return PgSyncClient._available;
  }

  /** Test seam: forget the memoised probe */
  static reset() {
    PgSyncClient._available = null;
  }

  private static _available: Promise<boolean> | null = null;

  /**
   * @returns the backend's answer, or `null` when there is none to remember
   */
  private static async _probe(): Promise<boolean | null> {
    let response: Response;
    try {
      // Time-limited: this runs inside the sync lock, as the first thing a
      // reconcile asks, and every other tab's sync waits behind it
      response = await fetch("/api/sync", {
        cache: "no-store",
        signal: timeoutSignal(LOCKED_REQUEST_MS),
      });
    } catch {
      return null;
    }

    // Only a definite answer is remembered. No `/api` route at all is one;
    // a server error is not, and may be gone on the next ask.
    if (response.status === 404) return false;
    if (!response.ok) return null;
    try {
      const body = await response.json();
      return body?.enabled === true;
    } catch (e) {
      // A body that is not JSON is an answer: a deployment that serves the
      // app for every path, with no `/api` behind it. Anything else -- the
      // body cut off by the timeout or a dropped connection -- is not.
      return e instanceof SyntaxError ? false : null;
    }
  }
}

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeEach } = import.meta.vitest;
  type Mock = import("vitest").Mock;
  describe("features/persistence/model/sync-client", () => {
    const answer = (body: unknown, status = 200) =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      } as unknown as Response);

    let fetchMock: Mock;

    beforeEach(() => {
      PgSyncClient.reset();
      fetchMock = vi.fn();
      vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock);
    });

    describe("PgSyncClient.available", () => {
      it("asks once and remembers a yes", async () => {
        fetchMock.mockResolvedValue(answer({ enabled: true }));

        expect(await PgSyncClient.available()).toBe(true);
        expect(await PgSyncClient.available()).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      it("remembers a no", async () => {
        fetchMock.mockResolvedValue(answer({ enabled: false }));

        expect(await PgSyncClient.available()).toBe(false);
        expect(await PgSyncClient.available()).toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      it("remembers a body that is not JSON as a no", async () => {
        // A deployment that answers every path with the app itself
        fetchMock.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError("Unexpected token '<'");
          },
        });

        expect(await PgSyncClient.available()).toBe(false);
        await PgSyncClient.available();
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      it("asks again after a request that failed or timed out", async () => {
        // It runs inside the sync lock, so it is time-limited -- and a timeout
        // remembered as a no would turn sync off until the tab was reloaded
        const timeout = new Error("signal timed out");
        timeout.name = "TimeoutError";
        fetchMock
          .mockRejectedValueOnce(timeout)
          .mockResolvedValueOnce(answer({ enabled: true }));

        expect(await PgSyncClient.available()).toBe(false);
        expect(await PgSyncClient.available()).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
      });

      it("remembers a missing route as a no", async () => {
        fetchMock.mockResolvedValue(answer({ error: "not found" }, 404));

        expect(await PgSyncClient.available()).toBe(false);
        await PgSyncClient.available();
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      it("asks again after a server error", async () => {
        fetchMock
          .mockResolvedValueOnce(answer({}, 503))
          .mockResolvedValueOnce(answer({ enabled: true }));

        expect(await PgSyncClient.available()).toBe(false);
        expect(await PgSyncClient.available()).toBe(true);
      });

      it("asks again after a body cut off part-way", async () => {
        fetchMock
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => {
              throw new TypeError("network error");
            },
          })
          .mockResolvedValueOnce(answer({ enabled: true }));

        expect(await PgSyncClient.available()).toBe(false);
        expect(await PgSyncClient.available()).toBe(true);
      });

      it("sends the probe with a signal that gives up", async () => {
        fetchMock.mockResolvedValue(answer({ enabled: true }));

        await PgSyncClient.available();

        const [, init] = fetchMock.mock.calls[0];
        // jsdom may lack `AbortSignal.timeout`, in which case there is none
        if (typeof AbortSignal.timeout === "function") {
          expect(init.signal).toBeInstanceOf(AbortSignal);
        } else {
          expect(init).toHaveProperty("signal");
        }
      });
    });
  });
}
