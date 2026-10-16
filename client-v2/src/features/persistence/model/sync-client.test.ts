import type { Mock } from "vitest";
import { PgSyncClient } from "./sync-client";

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
  Object.defineProperty(globalThis, "fetch", {
    value: fetchMock,
    configurable: true,
    writable: true,
  });
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
