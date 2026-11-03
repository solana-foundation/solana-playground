import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as memoryLog,
  resetLogger,
} from "@/shared/lib/logger";
import {
  initTelemetry,
  memoryProvider as memoryTelemetry,
  resetTelemetry,
} from "@/shared/lib/telemetry";

import {
  probeDefaultBackend,
  resetDefaultBackendProbe,
  retryDefaultBackend,
  useDefaultBackend,
} from "./default-backend";
import { assistantTelemetry } from "./telemetry";

let events: ReturnType<typeof memoryTelemetry>;
let logs: ReturnType<typeof memoryLog>;

beforeEach(() => {
  events = memoryTelemetry();
  logs = memoryLog();
  initTelemetry({ providers: [events] });
  initLogger({ providers: [logs] });
  resetDefaultBackendProbe();
});

afterEach(() => {
  resetTelemetry();
  resetLogger();
  vi.restoreAllMocks();
});

/* eslint-disable unicorn/no-null -- `GET /api/ai/status` bodies: `null` is on the wire */
/** The body's `model` and `reason` when there is none */
const NONE = null;
/** `GET /api/ai/status`'s answer for a deployment with no hosted key */
const own = { available: false, key: "own", reason: null, model: null };
/* eslint-enable unicorn/no-null */

/** `GET /api/ai/status`'s answer for a deployment that offers a hosted key */
const hostedWith = (reason: string | null) => (model: unknown) => ({
  available: reason === NONE,
  key: "hosted",
  reason,
  model,
});
/** Offered, though not to this caller: signed out */
const hosted = hostedWith("signed-out");
/** Offered to this caller */
const served = hostedWith(NONE);

/** The probe's answer: this body, with this status */
const answer = (body: unknown, status = 200) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);

const expectFailure = (reason: string) => {
  expect(logs.entries.map((e) => [e.ns, e.report])).toEqual([
    ["assistant:connect", true],
  ]);
  expect(events.events.map((e) => [e.name, e.params])).toEqual([
    ["assistant_default_probe_failed", { reason }],
  ]);
};

describe("probeDefaultBackend", () => {
  it("asks the status route, and nothing else", async () => {
    const spy = answer(hosted(NONE));
    await probeDefaultBackend();
    expect(spy.mock.calls.map(([url]) => url)).toEqual(["/api/ai/status"]);
  });

  it("is present with the deployment's model, signed out", async () => {
    answer(hosted("z-ai/glm-5.3-flash:US"));
    expect(await probeDefaultBackend()).toEqual({
      state: "present",
      model: "z-ai/glm-5.3-flash:US",
    });
    expect(logs.entries).toEqual([]);
  });

  it("is present with the deployment's model, signed in", async () => {
    answer(served("z-ai/glm-5.3-flash:US"));
    expect(await probeDefaultBackend()).toEqual({
      state: "present",
      model: "z-ai/glm-5.3-flash:US",
    });
  });

  it("is absent when the server has no hosted key", async () => {
    answer(own);
    expect(await probeDefaultBackend()).toEqual({ state: "absent" });
    expect(logs.entries).toEqual([]);
  });

  it("is unreachable, warned of and counted when the server could not read the session", async () => {
    answer(hostedWith("unavailable")("m"));
    expect(await probeDefaultBackend()).toEqual({ state: "unreachable" });
    // The route has logged its own failure; this is the client's view of it
    expect(logs.entries.map((e) => [e.ns, e.level, e.report])).toEqual([
      ["assistant:connect", "warn", false],
    ]);
    expect(events.events.map((e) => [e.name, e.params])).toEqual([
      ["assistant_default_probe_failed", { reason: "session" }],
    ]);
  });

  it("asks again after the server could not read the session", async () => {
    const spy = answer(hostedWith("unavailable")("m"));
    await probeDefaultBackend();
    spy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => served("m"),
    } as Response);
    expect(await probeDefaultBackend()).toEqual({
      state: "present",
      model: "m",
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("is unreachable and reported when the request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    expect(await probeDefaultBackend()).toEqual({ state: "unreachable" });
    expectFailure("network");
  });

  it("is unreachable and reported when the route answers a 5xx", async () => {
    answer({}, 503);
    expect(await probeDefaultBackend()).toEqual({ state: "unreachable" });
    expectFailure("status");
  });

  it("is absent, warned of and not reported on a deployment without the route", async () => {
    answer({}, 404);
    expect(await probeDefaultBackend()).toEqual({ state: "absent" });
    expect(logs.entries.map((e) => [e.ns, e.level, e.report])).toEqual([
      ["assistant:connect", "warn", false],
    ]);
    expect(events.events).toEqual([]);
  });

  it("is unreachable and reported on a null body", async () => {
    answer(null);
    expect(await probeDefaultBackend()).toEqual({ state: "unreachable" });
    expectFailure("body");
  });

  it("is unreachable and reported on a body without a known key", async () => {
    answer({ model: "x" });
    expect(await probeDefaultBackend()).toEqual({ state: "unreachable" });
    expectFailure("body");
  });

  it("offers a hosted key whose reason it does not know", async () => {
    // A reason a later server adds still names a key the deployment holds;
    // only `unavailable` says the server could not tell
    answer(hostedWith("sleeping")("m"));
    expect(await probeDefaultBackend()).toEqual({
      state: "present",
      model: "m",
    });
    expect(logs.entries).toEqual([]);
  });

  it("is unreachable and reported when the body is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError("Unexpected token <")),
    } as Response);
    expect(await probeDefaultBackend()).toEqual({ state: "unreachable" });
    expectFailure("body");
  });

  it("is present with no model, and warned of, when the model is not a string", async () => {
    answer(hosted(42));
    expect(await probeDefaultBackend()).toEqual({
      state: "present",
      model: null,
    });
    expect(logs.entries.map((e) => [e.ns, e.level, e.report])).toEqual([
      ["assistant:connect", "warn", false],
    ]);
  });

  it("asks again after a failed probe", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => hosted(NONE),
      } as Response);
    expect(await probeDefaultBackend()).toEqual({ state: "unreachable" });
    expect(await probeDefaultBackend()).toEqual({
      state: "present",
      model: null,
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("keeps a deployment without the route for the page", async () => {
    const spy = answer({}, 404);
    await probeDefaultBackend();
    await probeDefaultBackend();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("asks once per page", async () => {
    const spy = answer(hosted(NONE));
    await probeDefaultBackend();
    await probeDefaultBackend();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("asks again on a retry, and counts it", async () => {
    const spy = answer(own);
    await probeDefaultBackend();
    expect(await retryDefaultBackend()).toEqual({ state: "absent" });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(events.events.map((e) => e.name)).toEqual([
      "assistant_default_probe_retried",
    ]);
  });
});

describe("retryDefaultBackend", () => {
  /** A fetch whose answers the test hands out one by one, in any order */
  const heldFetch = () => {
    const pending: ((body: unknown) => void)[] = [];
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          pending.push((body) =>
            resolve({
              ok: true,
              status: 200,
              json: async () => body,
            } as Response)
          );
        })
    );
    return { spy, pending };
  };

  it("lets no earlier answer overwrite the retry's", async () => {
    const { pending } = heldFetch();
    const { result } = renderHook(() => useDefaultBackend());
    const retried = retryDefaultBackend();
    await waitFor(() => expect(pending).toHaveLength(2));
    // The retry answers first, then the page's first request, late
    pending[1](hosted("m"));
    await retried;
    await waitFor(() =>
      expect(result.current).toEqual({ state: "present", model: "m" })
    );
    await act(async () => {
      pending[0](own);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current).toEqual({ state: "present", model: "m" });
    expect(await probeDefaultBackend()).toEqual({
      state: "present",
      model: "m",
    });
  });

  it("joins a retry already under way rather than asking twice", async () => {
    const { spy, pending } = heldFetch();
    const first = retryDefaultBackend();
    const second = retryDefaultBackend();
    expect(spy).toHaveBeenCalledTimes(1);
    pending[0](own);
    expect(await first).toEqual({ state: "absent" });
    expect(await second).toEqual({ state: "absent" });
  });

  it("tells every reader the default is unreachable when the asking throws", async () => {
    answer(own);
    const { result } = renderHook(() => useDefaultBackend());
    await waitFor(() => expect(result.current).toEqual({ state: "absent" }));
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    vi.spyOn(assistantTelemetry, "track").mockImplementation((name) => {
      if (name === "assistant_default_probe_failed") {
        throw new Error("telemetry is broken");
      }
    });
    await expect(retryDefaultBackend()).rejects.toThrow("telemetry is broken");
    await waitFor(() =>
      expect(result.current).toEqual({ state: "unreachable" })
    );
  });
});

describe("useDefaultBackend", () => {
  it("starts checking, then settles", async () => {
    answer(hosted(NONE));
    const { result } = renderHook(() => useDefaultBackend());
    expect(result.current).toEqual({ state: "checking" });
    await waitFor(() =>
      expect(result.current).toEqual({ state: "present", model: null })
    );
  });

  it("follows a retry's answer", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useDefaultBackend());
    await waitFor(() =>
      expect(result.current).toEqual({ state: "unreachable" })
    );
    spy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => hosted("m"),
    } as Response);
    void retryDefaultBackend();
    await waitFor(() =>
      expect(result.current).toEqual({ state: "present", model: "m" })
    );
  });

  it("settles unreachable and logs when the probe rejects", async () => {
    // The probe answers its own failures; this is a throw past them, such as
    // a log provider that fails while reporting one
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    vi.spyOn(assistantTelemetry, "track").mockImplementation(() => {
      throw new Error("telemetry is broken");
    });
    const { result } = renderHook(() => useDefaultBackend());
    await waitFor(() =>
      expect(result.current).toEqual({ state: "unreachable" })
    );
    expect(logs.entries.map((e) => [e.ns, e.level, e.report])).toEqual([
      // The probe's own report, then the hook's
      ["assistant:connect", "error", true],
      ["assistant:connect", "error", true],
    ]);
  });
});
