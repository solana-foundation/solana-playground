import { renderHook, waitFor } from "@testing-library/react";
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
  it("is present with the deployment's model", async () => {
    answer({ configured: true, model: "z-ai/glm-5.3-flash:US" });
    expect(await probeDefaultBackend()).toEqual({
      state: "present",
      model: "z-ai/glm-5.3-flash:US",
    });
    expect(logs.entries).toEqual([]);
  });

  it("is absent when the server has no key", async () => {
    answer({ configured: false, model: null });
    expect(await probeDefaultBackend()).toEqual({ state: "absent" });
    expect(logs.entries).toEqual([]);
  });

  it("is unreachable and reported when the request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    expect(await probeDefaultBackend()).toEqual({ state: "unreachable" });
    expectFailure("network");
  });

  it("is unreachable and reported when the agent answers a 5xx", async () => {
    answer({}, 503);
    expect(await probeDefaultBackend()).toEqual({ state: "unreachable" });
    expectFailure("status");
  });

  it("is absent, warned of and not reported on a deployment without the agent", async () => {
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

  it("is unreachable and reported on a body without configured", async () => {
    answer({ model: "x" });
    expect(await probeDefaultBackend()).toEqual({ state: "unreachable" });
    expectFailure("body");
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
    answer({ configured: true, model: 42 });
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
        json: async () => ({ configured: true, model: null }),
      } as Response);
    expect(await probeDefaultBackend()).toEqual({ state: "unreachable" });
    expect(await probeDefaultBackend()).toEqual({
      state: "present",
      model: null,
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("keeps a deployment without the agent for the page", async () => {
    const spy = answer({}, 404);
    await probeDefaultBackend();
    await probeDefaultBackend();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("asks once per page", async () => {
    const spy = answer({ configured: true, model: null });
    await probeDefaultBackend();
    await probeDefaultBackend();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("useDefaultBackend", () => {
  it("starts checking, then settles", async () => {
    answer({ configured: true, model: null });
    const { result } = renderHook(() => useDefaultBackend());
    expect(result.current).toEqual({ state: "checking" });
    await waitFor(() =>
      expect(result.current).toEqual({ state: "present", model: null })
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
