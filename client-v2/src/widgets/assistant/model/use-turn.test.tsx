import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PgSession } from "@/features/auth";
import { PgChatStorage } from "@/features/persistence/model/chat-storage";
import {
  initLogger,
  memoryProvider as memoryLog,
  resetLogger,
} from "@/shared/lib/logger";
import * as reportModule from "@/shared/lib/report-button-failure";
import {
  initTelemetry,
  memoryProvider as memoryTelemetry,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import * as reportModule from "@/shared/lib/report-button-failure";
// The class itself, which the slice entry exports as a type only
import { AiTurnError } from "@/shared/lib/ai/run-turn";
import { PgSession } from "@/features/auth";
import {
  PgAssistant,
  isConnectionLost,
} from "../../../views/sidebar/assistant/store";
import { createProvider } from "../../../views/sidebar/assistant/model";
import { ModelBusyError } from "../../../views/sidebar/assistant/model/model-busy";
import {
  TurnFailure,
  type Provider,
} from "../../../views/sidebar/assistant/model/types";
import type {
  BackendParams,
  Connection,
} from "../../../views/sidebar/assistant/store";
import {
  REMEMBERED_BACKEND_KEY,
  rememberBackend,
} from "../../../views/sidebar/assistant/model/remembered-backend";
import { pushThread } from "../../../effects/chat-thread/push-thread";
import { PgExplorer } from "../../../utils/explorer/explorer";
import { PgFs } from "../../../utils/explorer/fs";
import { createProvider } from "../../../views/sidebar/assistant/model";
import { ModelBusyError } from "../../../views/sidebar/assistant/model/model-busy";
import { rememberBackend } from "../../../views/sidebar/assistant/model/remembered-backend";
import type { Provider } from "../../../views/sidebar/assistant/model/types";
import { TurnFailure } from "../../../views/sidebar/assistant/model/types";
import type { Connection } from "../../../views/sidebar/assistant/store";
import { PgAssistant } from "../../../views/sidebar/assistant/store";
import { resetDefaultBackendProbe } from "./default-backend";
import type { ConnectOpener } from "./use-turn";
import { useTurn } from "./use-turn";

// The real providers stream from the network; a turn here is whatever the
// stub's `send` does
vi.mock("../../../views/sidebar/assistant/model", () => ({
  createProvider: vi.fn(),
}));
// Reaches the explorer and the account; a turn's end only has to ask for it
vi.mock("../../../effects/chat-thread/push-thread", () => ({
  pushThread: vi.fn(() => Promise.resolve()),
}));

/**
 * Stands in for `openConnectDialog`, the opener the app hands in: marks
 * Connect a model open, unless it is already, and draws nothing
 */
const open = vi.fn<ConnectOpener>(() => {
  if (!PgAssistant.isPickingBackend) PgAssistant.pickBackend();
});
const useTestTurn = () => useTurn({ open });

let events: ReturnType<typeof memoryTelemetry>;
let provider: { id: "default"; label: string; send: ReturnType<typeof vi.fn> };

const defaultBackend = (configured: boolean) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({
      key: configured ? "hosted" : "own",
      /* eslint-disable unicorn/no-null -- a `GET /api/ai/status` body: `null` is on the wire */
      reason: null,
      model: configured ? "z-ai/glm-5.3-flash:US" : null,
      /* eslint-enable unicorn/no-null */
    }),
  } as Response);

/** What `Provider.send` is handed with the text: the signal */
type SendTurn = Parameters<Provider["send"]>[1];

/** A provider whose turn runs until its signal aborts, then rejects */
const untilAborted = (_: string, turn: SendTurn) =>
  new Promise<void>((_resolve, reject) => {
    turn?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  });

const USER = { id: "u1", name: null, image: null, login: null };

beforeEach(() => {
  // The default backend answers only a signed-in user; a test about the
  // signed-out case ends the session itself
  void PgSession.refreshWith(USER);
  open.mockClear();
  events = memoryTelemetry();
  initTelemetry({ providers: [events] });
  resetDefaultBackendProbe();
  // Every mount probes; a test about the default answers again before it
  defaultBackend(false);
  PgAssistant.disconnect();
  provider = {
    id: "default",
    label: "stub",
    send: vi.fn(() => Promise.resolve()),
  };
  vi.mocked(createProvider).mockImplementation(
    () => provider as unknown as Provider
  );
});

afterEach(() => {
  // The hook is still mounted here: RTL's own cleanup runs after this hook
  act(() => PgAssistant.disconnect());
  PgSession.reset();
  resetTelemetry();
  vi.restoreAllMocks();
});

const eventNames = () => events.events.map((e) => [e.name, e.params]);
/** The turn's own events, in the order sent, without the rest of the panel's */
const turnEvents = () =>
  events.events
    .filter((e) => e.name.startsWith("assistant_turn_"))
    .map((e) => [e.name, e.params]);
const SENT_ON_DEFAULT = ["assistant_turn_sent", { provider: "default" }];

/** The thread's first reply; none fails the test */
const firstReply = () => {
  const reply = PgAssistant.items.find((i) => i.kind === "assistant");
  if (!reply) throw new Error("the thread holds no reply");
  return reply;
};

/** The thread's last item; an empty thread fails the test */
const lastItem = () => {
  const last = PgAssistant.items.at(-1);
  if (!last) throw new Error("the thread is empty");
  return last;
};

describe("useTurn", () => {
  it("connects the default and sends when nothing is connected", async () => {
    defaultBackend(true);
    const { result } = renderHook(() => useTestTurn());

    await act(() => result.current.send("hi"));

    expect(PgAssistant.connection?.id).toBe("default");
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(provider.send.mock.calls[0][0]).toBe("hi");
    expect(result.current.input).toBe("");
  });

  it("keeps the typed text and reports when the message cannot be added", async () => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    const failure = new Error("store is broken");
    vi.spyOn(PgAssistant, "addUserMessage").mockImplementation(() => {
      throw failure;
    });
    const report = vi.fn();
    const reportFor = vi
      .spyOn(reportModule, "reportButtonFailure")
      .mockReturnValue(report);
    const { result } = renderHook(() => useTestTurn());
    act(() => result.current.setInput("hello"));

    await act(() => result.current.send("hello"));

    expect(report).toHaveBeenCalledWith(failure);
    expect(reportFor).toHaveBeenCalledWith("send your message");
    expect(result.current.input).toBe("hello");
    expect(result.current.busy).toBe(false);
    expect(provider.send).not.toHaveBeenCalled();
    expect(turnEvents()).toEqual([]);
  });

  it("opens Connect and keeps the text when there is no default", async () => {
    defaultBackend(false);
    const pick = vi.spyOn(PgAssistant, "pickBackend");
    const { result } = renderHook(() => useTestTurn());

    await act(() => result.current.send("hi"));

    expect(createProvider).not.toHaveBeenCalled();
    expect(pick).toHaveBeenCalledTimes(1);
    expect(result.current.input).toBe("hi");
    expect(PgAssistant.items.length).toBe(0);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("send", undefined);
    expect(turnEvents()).toEqual([]);
  });

  it("starts one turn for two sends in the same tick", async () => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    provider.send.mockImplementation(untilAborted);
    const { result } = renderHook(() => useTestTurn());

    act(() => {
      void result.current.send("first");
      void result.current.send("second");
    });

    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(provider.send.mock.calls[0][0]).toBe("first");
    act(() => result.current.stop());
    await waitFor(() => expect(result.current.busy).toBe(false));
    // The refused second send reported nothing
    expect(turnEvents()).toEqual([
      SENT_ON_DEFAULT,
      ["assistant_turn_stopped", {}],
    ]);
  });

  it("reports a stopped turn only as stopped when its provider resolves after Stop", async () => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    provider.send.mockImplementation(
      (_: string, signal?: AbortSignal) =>
        new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => resolve());
        })
    );
    const { result } = renderHook(() => useTestTurn());
    act(() => {
      void result.current.send("hi");
    });

    act(() => result.current.stop());
    await waitFor(() => expect(result.current.busy).toBe(false));

    expect(turnEvents()).toEqual([
      SENT_ON_DEFAULT,
      ["assistant_turn_stopped", {}],
    ]);
  });

  it("sends the text and the signal only: the context is the store's, not the turn's", async () => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    const { result } = renderHook(() => useTestTurn());

    await act(() => result.current.send("hi"));

    const [text, turn] = provider.send.mock.calls[0];
    expect(text).toBe("hi");
    expect(turn).toEqual({ signal: expect.any(AbortSignal) });
  });

  it("says Stopped once for two Stops before the turn unwinds", async () => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    let unwind!: () => void;
    // Rejects only when the test says, so the turn stays busy after the abort
    provider.send.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          unwind = () => reject(new Error("aborted"));
        })
    );
    const { result } = renderHook(() => useTestTurn());

    act(() => {
      void result.current.send("hi");
    });
    act(() => result.current.stop());
    expect(result.current.busy).toBe(true);
    act(() => result.current.stop());

    const stopped = PgAssistant.items.filter(
      (item) => item.kind === "notice" && item.text === "Stopped."
    );
    expect(stopped.length).toBe(1);
    expect(
      eventNames().filter(([name]) => name === "assistant_turn_stopped").length
    ).toBe(1);
    await act(async () => unwind());
    await waitFor(() => expect(result.current.busy).toBe(false));
  });

  it("names the turn's phase: running, awaiting, stopping, idle", async () => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    let unwind!: () => void;
    provider.send.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          unwind = () =>
            reject(new DOMException("The user aborted", "AbortError"));
        })
    );
    const { result } = renderHook(() => useTestTurn());
    expect(result.current.phase).toBe("idle");

    act(() => {
      void result.current.send("hi");
    });
    expect(result.current.phase).toBe("running");
    act(() => PgAssistant.setStatus("awaiting"));
    expect(result.current.phase).toBe("awaiting");
    // `cancelPending` drops the status to idle before the turn unwinds
    act(() => result.current.stop());
    expect(result.current.phase).toBe("stopping");
    expect(result.current.busy).toBe(true);

    await act(async () => unwind());
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    expect(result.current.busy).toBe(false);
  });

  it("keeps a requested prompt that arrives during a turn", async () => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    provider.send.mockImplementation(untilAborted);
    const { result } = renderHook(() => useTestTurn());

    act(() => {
      void result.current.send("first");
    });
    act(() => PgAssistant.requestPrompt("Explain this error"));

    await waitFor(() =>
      expect(result.current.input).toBe("Explain this error")
    );
    expect(provider.send).toHaveBeenCalledTimes(1);
    act(() => result.current.stop());
    await waitFor(() => expect(result.current.busy).toBe(false));
  });

  it("keeps a requested prompt that arrives while the default is probed", async () => {
    let answer!: (res: Response) => void;
    vi.spyOn(globalThis, "fetch").mockReturnValue(
      new Promise<Response>((resolve) => {
        answer = resolve;
      })
    );
    provider.send.mockImplementation(untilAborted);
    const { result } = renderHook(() => useTestTurn());

    act(() => {
      void result.current.send("first");
    });
    act(() => PgAssistant.requestPrompt("Explain this error"));
    await act(async () =>
      answer({
        ok: true,
        // eslint-disable-next-line unicorn/no-null -- a `GET /api/ai/status` body: `null` is on the wire
        json: async () => ({ key: "hosted", reason: null, model: null }),
      } as Response)
    );

    await waitFor(() =>
      expect(result.current.input).toBe("Explain this error")
    );
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(provider.send.mock.calls[0][0]).toBe("first");
    act(() => result.current.stop());
    await waitFor(() => expect(result.current.busy).toBe(false));
  });

  it("starts one turn for two sends while the default is probed", async () => {
    defaultBackend(true);
    const { result } = renderHook(() => useTestTurn());

    await act(async () => {
      await Promise.all([
        result.current.send("first"),
        result.current.send("second"),
      ]);
    });

    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(provider.send.mock.calls[0][0]).toBe("first");
  });

  it("stops a turn: aborts, denies what is pending, says so", async () => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    provider.send.mockImplementation(untilAborted);
    const { result } = renderHook(() => useTestTurn());

    act(() => {
      void result.current.send("hi");
    });
    expect(result.current.busy).toBe(true);
    const signal: AbortSignal = provider.send.mock.calls[0][1].signal;
    let answer!: Promise<{ allowed: boolean }>;
    act(() => {
      answer = PgAssistant.requestApproval({
        type: "command",
        name: "build",
        effect: "Builds the program",
      });
    });

    act(() => result.current.stop());
    expect(signal.aborted).toBe(true);
    // Async: the aborted provider rejects and the turn unwinds in a microtask
    await act(async () => {});
    expect((await answer).allowed).toBe(false);
    const kinds = PgAssistant.items.map((item) => item.kind);
    expect(kinds).toContain("notice");
    expect(kinds).not.toContain("error");
    expect(
      PgAssistant.items.some(
        (item) => item.kind === "notice" && item.text === "Stopped."
      )
    ).toBe(true);
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(turnEvents()).toEqual([
      SENT_ON_DEFAULT,
      ["assistant_turn_stopped", {}],
    ]);
  });

  it.each([
    ["a 401", 401],
    ["Gemini's 400", 400],
  ])("names the backend and offers its key again on %s", async (_, status) => {
    const own: Connection = {
      id: "openai",
      apiKey: "sk-test",
      endpoint: { baseUrl: "https://api.example.test/v1", model: "gpt-x" },
    };
    PgAssistant.connect(own);
    // As the provider rejects: the SDK's error kept as the cause
    provider.send.mockRejectedValue(
      new TurnFailure("Unauthorized", {
        reason: "provider",
        status,
        cause: new AiTurnError("Unauthorized", { kind: "key-refused", status }),
      })
    );
    const { result } = renderHook(() => useTestTurn());

    await act(() => result.current.send("hi"));

    expect(PgAssistant.items.at(-1)).toMatchObject({
      kind: "error",
      text: "OpenAI-compatible did not accept this key. Check it and enter it again, or pick another model.",
      recover: {
        provider: "openai",
        model: "gpt-x",
        baseUrl: "https://api.example.test/v1",
      },
    });
    expect(JSON.stringify(PgAssistant.items)).not.toContain("sk-test");
    expect(eventNames()).toContainEqual([
      "assistant_key_rejected",
      { provider: "openai" },
    ]);
  });

  it.each([
    ["a 403, which a valid key without access gets too", "forbidden", 403],
    ["a 500", "provider", 500],
  ] as const)(
    "shows the turn's own words for %s",
    // eslint-disable-next-line max-params -- `it.each` spreads each row of the table into the callback
    async (_, kind, status) => {
      PgAssistant.connect({ id: "anthropic", apiKey: "sk-test" });
      provider.send.mockRejectedValue(
        new TurnFailure("Provider says no", {
          reason: "provider",
          status,
          cause: new AiTurnError("Provider says no", { kind, status }),
        })
      );
      const { result } = renderHook(() => useTestTurn());

      await act(() => result.current.send("hi"));

      const error = PgAssistant.items.at(-1);
      expect(error).toMatchObject({ kind: "error", text: "Provider says no" });
      expect(error).not.toHaveProperty("recover");
      expect(eventNames().map(([name]) => name)).not.toContain(
        "assistant_key_rejected"
      );
    }
  );

  it("keeps the ordinary error for a 401 from the default", async () => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    provider.send.mockRejectedValue(
      new TurnFailure("Unauthorized", {
        reason: "provider",
        status: 401,
        cause: new AiTurnError("Unauthorized", {
          kind: "key-refused",
          status: 401,
        }),
      })
    );
    const { result } = renderHook(() => useTestTurn());

    await act(() => result.current.send("hi"));

    expect(PgAssistant.items.at(-1)).not.toHaveProperty("recover");
  });

  it("reports a failed turn as an error item", async () => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    provider.send.mockRejectedValue(new Error("quota"));
    const { result } = renderHook(() => useTestTurn());

    await act(() => result.current.send("hi"));

    expect(
      PgAssistant.items.some(
        (item) => item.kind === "error" && item.text === "quota"
      )
    ).toBe(true);
    expect(result.current.busy).toBe(false);
  });

  it("reports a turn as sent, then answered, on the connection's backend", async () => {
    PgAssistant.connect({ id: "openai", apiKey: "sk-test" });
    const { result } = renderHook(() => useTestTurn());

    await act(() => result.current.send("hi"));

    expect(turnEvents()).toEqual([
      ["assistant_turn_sent", { provider: "openai" }],
      ["assistant_turn_answered", { provider: "openai" }],
    ]);
  });

  it.each([
    {
      ends: "with the backend's error status",
      error: new TurnFailure("down", { reason: "provider", status: 500 }),
      outcome: [
        "assistant_turn_failed",
        { provider: "default", reason: "provider", status: 500 },
      ],
    },
    {
      ends: "with the model's refusal",
      error: new TurnFailure("no", { reason: "refusal" }),
      outcome: [
        "assistant_turn_failed",
        { provider: "default", reason: "refusal" },
      ],
    },
    {
      ends: "on this side",
      error: new Error("still calling tools"),
      outcome: [
        "assistant_turn_failed",
        { provider: "default", reason: "other" },
      ],
    },
    {
      ends: "under the cost gate",
      error: new TurnFailure("capped", { reason: "capped", status: 429 }),
      outcome: ["assistant_turn_capped", { provider: "default" }],
    },
    {
      ends: "with an upstream rate limit",
      error: new TurnFailure("busy", { reason: "provider", status: 429 }),
      outcome: [
        "assistant_turn_failed",
        { provider: "default", reason: "provider", status: 429 },
      ],
    },
  ])("reports a turn that ends $ends", async ({ error, outcome }) => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    provider.send.mockRejectedValue(error);
    const { result } = renderHook(() => useTestTurn());

    await act(() => result.current.send("hi"));

    expect(turnEvents()).toStrictEqual([SENT_ON_DEFAULT, outcome]);
  });

  it("keeps the prompt out of every event, even when the failure quotes it", async () => {
    const prompt = "Explain the lib.rs build error";
    PgAssistant.connect({ id: "default", apiKey: "" });
    provider.send.mockRejectedValue(
      new TurnFailure(`Could not answer "${prompt}"`, {
        reason: "provider",
        status: 500,
      })
    );
    const { result } = renderHook(() => useTestTurn());

    await act(() => result.current.send(prompt));

    expect(turnEvents().length).toBe(2);
    expect(JSON.stringify(events.events)).not.toContain(prompt);
  });

  describe("a busy model (Spec 08 AI-03)", () => {
    const BUSY = "The model is busy.";
    const LATER = "The model is busy. Send your message again in a minute.";
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      PgAssistant.connect({ id: "default", apiKey: "" });
    });
    afterEach(() => vi.useRealTimers());

    const userMessages = () =>
      PgAssistant.items.filter((item) => item.kind === "user").length;
    const errors = () =>
      PgAssistant.items.filter((item) => item.kind === "error");

    it("counts down from 10 s, then sends the same message again", async () => {
      provider.send
        .mockRejectedValueOnce(new ModelBusyError(undefined, BUSY))
        .mockResolvedValueOnce(undefined);
      const { result } = renderHook(() => useTestTurn());

      await act(() => result.current.send("hi"));

      expect(result.current.retry).toEqual({
        secondsLeft: 10,
        canTryNow: true,
      });
      expect(result.current.busy).toBe(true);
      expect(errors()).toEqual([]);

      await act(() => vi.advanceTimersByTimeAsync(4_000));
      expect(result.current.retry?.secondsLeft).toBe(6);

      await act(() => vi.advanceTimersByTimeAsync(6_000));
      await waitFor(() => expect(provider.send).toHaveBeenCalledTimes(2));
      expect(provider.send.mock.calls[1][0]).toBe("hi");
      await waitFor(() => expect(result.current.retry).toBeNull());
      expect(userMessages()).toBe(1);
      expect(errors()).toEqual([]);
      // One turn: sent once, and the busy answer it was sent again for is no outcome
      expect(turnEvents()).toEqual([
        SENT_ON_DEFAULT,
        ["assistant_turn_answered", { provider: "default" }],
      ]);
    });

    it("waits as long as the server says, with Try now off", async () => {
      provider.send.mockRejectedValueOnce(new ModelBusyError(30, BUSY));
      const { result } = renderHook(() => useTestTurn());

      await act(() => result.current.send("hi"));

      expect(result.current.retry).toEqual({
        secondsLeft: 30,
        canTryNow: false,
      });
    });

    it("Try now sends at once", async () => {
      provider.send
        .mockRejectedValueOnce(new ModelBusyError(undefined, BUSY))
        .mockResolvedValueOnce(undefined);
      const { result } = renderHook(() => useTestTurn());
      await act(() => result.current.send("hi"));

      await act(() => result.current.tryNow());

      expect(provider.send).toHaveBeenCalledTimes(2);
      expect(result.current.retry).toBeNull();
    });

    it("Stop ends the wait and leaves the message where it is", async () => {
      provider.send.mockRejectedValueOnce(new ModelBusyError(undefined, BUSY));
      const { result } = renderHook(() => useTestTurn());
      await act(() => result.current.send("hi"));

      act(() => result.current.stop());
      await act(() => vi.advanceTimersByTimeAsync(15_000));

      expect(result.current.retry).toBeNull();
      expect(result.current.busy).toBe(false);
      // In the thread once, not handed back to be sent a second time
      expect(userMessages()).toBe(1);
      expect(result.current.input).toBe("");
      expect(provider.send).toHaveBeenCalledTimes(1);
      expect(turnEvents()).toEqual([
        SENT_ON_DEFAULT,
        ["assistant_turn_stopped", {}],
      ]);
    });

    it("ends the wait as stopped when the panel closes, sending nothing", async () => {
      provider.send.mockRejectedValueOnce(new ModelBusyError(undefined, BUSY));
      const { result, unmount } = renderHook(() => useTestTurn());
      await act(() => result.current.send("hi"));

      unmount();
      await act(() => vi.advanceTimersByTimeAsync(15_000));

      expect(provider.send).toHaveBeenCalledTimes(1);
      expect(
        PgAssistant.items.filter(
          (item) => item.kind === "notice" && item.text === "Stopped."
        )
      ).toHaveLength(1);
      expect(turnEvents()).toEqual([
        SENT_ON_DEFAULT,
        ["assistant_turn_stopped", {}],
      ]);
    });

    it("starts no other turn while a message waits", async () => {
      provider.send.mockRejectedValueOnce(new ModelBusyError(undefined, BUSY));
      const { result } = renderHook(() => useTestTurn());
      await act(() => result.current.send("hi"));

      await act(() => result.current.send("something else"));

      expect(provider.send).toHaveBeenCalledTimes(1);
      expect(userMessages()).toBe(1);
    });

    it("Try now does nothing while the server's wait runs", async () => {
      provider.send.mockRejectedValueOnce(new ModelBusyError(30, BUSY));
      const { result } = renderHook(() => useTestTurn());
      await act(() => result.current.send("hi"));

      await act(() => result.current.tryNow());

      expect(provider.send).toHaveBeenCalledTimes(1);
      expect(result.current.retry?.canTryNow).toBe(false);
    });

    it("counts no wait longer than a minute down; it says to come back", async () => {
      provider.send.mockRejectedValueOnce(new ModelBusyError(3600, BUSY));
      const { result } = renderHook(() => useTestTurn());

      await act(() => result.current.send("hi"));

      expect(result.current.retry).toBeNull();
      expect(
        errors().map((item) => item.kind === "error" && item.text)
      ).toEqual([LATER]);
      expect(turnEvents()).toStrictEqual([
        SENT_ON_DEFAULT,
        ["assistant_turn_failed", { provider: "default", reason: "provider" }],
      ]);
    });

    it("drops the wait when the conversation changes, sending nothing", async () => {
      provider.send.mockRejectedValueOnce(new ModelBusyError(undefined, BUSY));
      const { result } = renderHook(() => useTestTurn());
      await act(() => result.current.send("hi"));

      act(() => PgAssistant.clear());
      await act(() => vi.advanceTimersByTimeAsync(15_000));

      expect(result.current.retry).toBeNull();
      expect(provider.send).toHaveBeenCalledTimes(1);
      // The conversation left the turn, as the store's cut-off does: no outcome
      expect(turnEvents()).toEqual([SENT_ON_DEFAULT]);
    });

    it("reports a waiting message not sent again for a changed model as failed", async () => {
      PgAssistant.connect({
        id: "anthropic",
        apiKey: "k",
        settings: { model: "claude-sonnet-5-5", effort: "high" },
      });
      provider.send.mockRejectedValueOnce(new ModelBusyError(undefined, BUSY));
      const { result } = renderHook(() => useTestTurn());
      await act(() => result.current.send("hi"));

      act(() =>
        PgAssistant.tune({
          id: "anthropic",
          apiKey: "k",
          settings: { model: "claude-sonnet-5-5", effort: "low" },
        })
      );
      await act(() => vi.advanceTimersByTimeAsync(15_000));

      expect(provider.send).toHaveBeenCalledTimes(1);
      expect(turnEvents()).toStrictEqual([
        ["assistant_turn_sent", { provider: "anthropic" }],
        ["assistant_turn_failed", { provider: "anthropic", reason: "other" }],
      ]);
    });

    it("gives up with one line after three busy answers in a row", async () => {
      provider.send.mockRejectedValue(
        new ModelBusyError(1, BUSY, { status: 429 })
      );
      const { result } = renderHook(() => useTestTurn());

      await act(() => result.current.send("hi"));
      for (let i = 0; i < 3; i++) {
        await act(() => vi.advanceTimersByTimeAsync(1_000));
      }

      await waitFor(() => expect(provider.send).toHaveBeenCalledTimes(4));
      await waitFor(() => expect(result.current.retry).toBeNull());
      expect(
        errors().map((item) => item.kind === "error" && item.text)
      ).toEqual([LATER]);
      // The last busy answer ends the turn; the three sent again did not
      expect(turnEvents()).toStrictEqual([
        SENT_ON_DEFAULT,
        [
          "assistant_turn_failed",
          { provider: "default", reason: "provider", status: 429 },
        ],
      ]);
    });
  });

  it("rebuilds the provider when the connection changes", async () => {
    PgAssistant.connect({
      id: "anthropic",
      apiKey: "k",
      settings: { model: "claude-sonnet-5-5", effort: "high" },
    });
    const { result } = renderHook(() => useTestTurn());

    await act(() => result.current.send("one"));
    act(() =>
      PgAssistant.tune({
        id: "anthropic",
        apiKey: "k",
        settings: { model: "claude-sonnet-5-5", effort: "low" },
      })
    );
    await act(() => result.current.send("two"));

    expect(createProvider).toHaveBeenCalledTimes(2);
    // Seeded from what is rendered: the first exchange is on screen
    const seed = vi.mocked(createProvider).mock.calls[1][1];
    expect(seed?.length).toBeGreaterThan(0);
  });

  it("rebuilds the provider once what is rendered is dropped, with no thread open", async () => {
    // Sign-out with no thread open: `threadId` stays null and a key-based
    // connection survives, so only `clear` says the conversation is gone
    PgAssistant.closeThread();
    PgAssistant.connect({ id: "default", apiKey: "" });
    const { result } = renderHook(() => useTestTurn());
    await act(() => result.current.send("from the last account"));

    act(() => PgAssistant.clear());
    await act(() => result.current.send("from the next one"));

    expect(createProvider).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createProvider).mock.calls[1][1]).toEqual([]);
  });

  it("puts a requested prompt in the composer without sending", async () => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    const { result } = renderHook(() => useTestTurn());

    act(() => PgAssistant.requestPrompt("Explain this error", { send: false }));

    expect(result.current.input).toBe("Explain this error");
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("puts a requested prompt in the composer and focuses it, with nothing connected", async () => {
    const { result } = renderHook(() => useTestTurn());
    const before = result.current.focusRequest;

    act(() => PgAssistant.requestPrompt("Explain this error", { send: false }));

    await waitFor(() =>
      expect(result.current.input).toBe("Explain this error")
    );
    expect(result.current.focusRequest).toBeGreaterThan(before);
    // Nothing is to be sent, so nothing asks for a backend
    expect(open).not.toHaveBeenCalled();
    expect(result.current.promptWaiting).toBe(false);
  });

  it("sends a requested prompt when connected", async () => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    renderHook(() => useTestTurn());

    act(() => PgAssistant.requestPrompt("Explain this error"));

    await waitFor(() => expect(provider.send).toHaveBeenCalledTimes(1));
    expect(provider.send.mock.calls[0][0]).toBe("Explain this error");
  });

  it("keeps a requested prompt and reports when the message cannot be added", async () => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    const failure = new Error("store is broken");
    vi.spyOn(PgAssistant, "addUserMessage").mockImplementation(() => {
      throw failure;
    });
    const report = vi.fn();
    const reportFor = vi
      .spyOn(reportModule, "reportButtonFailure")
      .mockReturnValue(report);
    const { result } = renderHook(() => useTestTurn());

    act(() => PgAssistant.requestPrompt("Explain this error"));

    await waitFor(() => expect(report).toHaveBeenCalledWith(failure));
    expect(reportFor).toHaveBeenCalledWith("send the prompt");
    expect(result.current.input).toBe("Explain this error");
  });

  it("connects the default for a requested prompt and sends it", async () => {
    defaultBackend(true);
    renderHook(() => useTestTurn());

    act(() => PgAssistant.requestPrompt("Explain this error"));

    await waitFor(() => expect(provider.send).toHaveBeenCalledTimes(1));
    expect(PgAssistant.connection?.id).toBe("default");
  });

  it("reconnects a remembered default on mount", async () => {
    defaultBackend(true);
    rememberBackend({ id: "default", apiKey: "" });

    renderHook(() => useTestTurn());

    await waitFor(() => expect(PgAssistant.connection?.id).toBe("default"));
  });

  it("reconnects this tab's kept key over a remembered default, with one probe", async () => {
    const own: Connection = {
      id: "openai",
      apiKey: "sk-test-turn-0123456789",
      endpoint: { baseUrl: "https://api.example.test/v1", model: "gpt-x" },
    };
    rememberBackend({ id: "default", apiKey: "" });
    sessionStorage.setItem("assistant.connection", JSON.stringify(own));
    const probe = defaultBackend(true);

    renderHook(() => useTestTurn());

    expect(PgAssistant.connection).toMatchObject({
      id: "openai",
      apiKey: own.apiKey,
    });
    await waitFor(() => expect(probe).toHaveBeenCalledTimes(1));
    await act(() => Promise.resolve());
    expect(PgAssistant.connection?.id).toBe("openai");
  });

  it("does not reconnect a kept key while Connect a model is open", () => {
    sessionStorage.setItem(
      "assistant.connection",
      JSON.stringify({ id: "anthropic", apiKey: "sk-ant-kept" })
    );
    PgAssistant.pickBackend();

    renderHook(() => useTestTurn());

    expect(PgAssistant.connection).toBeNull();
  });

  it("does not connect the default for a send while Connect a model is open", async () => {
    defaultBackend(true);
    const { result } = renderHook(() => useTestTurn());
    act(() => result.current.openConnect("menu"));

    await act(() => result.current.send("hi"));

    expect(PgAssistant.connection).toBeNull();
    expect(PgAssistant.isPickingBackend).toBe(true);
    expect(result.current.input).toBe("hi");
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("does not connect the default for a requested prompt while Connect a model is open", async () => {
    const probe = defaultBackend(true);
    const { result } = renderHook(() => useTestTurn());
    act(() => result.current.openConnect("menu"));

    act(() => PgAssistant.requestPrompt("Explain this error"));

    await waitFor(() => expect(result.current.promptWaiting).toBe(true));
    expect(probe).toHaveBeenCalled();
    expect(PgAssistant.connection).toBeNull();
    expect(result.current.input).toBe("Explain this error");
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("does not connect a default the user never picked", async () => {
    const probe = defaultBackend(true);

    renderHook(() => useTestTurn());

    await waitFor(() => expect(probe).toHaveBeenCalled());
    await act(() => Promise.resolve());
    expect(PgAssistant.connection).toBeNull();
  });

  it("keeps a requested prompt waiting when there is no default", async () => {
    defaultBackend(false);
    const pick = vi.spyOn(PgAssistant, "pickBackend");
    const { result } = renderHook(() => useTestTurn());

    act(() => PgAssistant.requestPrompt("Explain this error"));

    await waitFor(() => expect(result.current.promptWaiting).toBe(true));
    expect(result.current.input).toBe("Explain this error");
    expect(pick).toHaveBeenCalledTimes(1);
    expect(provider.send).not.toHaveBeenCalled();

    act(() => PgAssistant.connect({ id: "default", apiKey: "" }));
    expect(result.current.promptWaiting).toBe(false);
    expect(result.current.input).toBe("Explain this error");
  });
});

describe("useTurn when the key is gone", () => {
  afterEach(() => localStorage.clear());
  const OPENAI = {
    provider: "openai" as const,
    model: "gpt-x",
    baseUrl: "https://api.example.test/v1",
  };
  /** The open thread, last answered by `origin`, as a new tab finds it */
  const threadAnsweredBy = (origin: BackendParams) =>
    vi.spyOn(PgAssistant, "items", "get").mockReturnValue([
      {
        kind: "user",
        id: "u",
        createdAt: "2026-10-28T00:00:00.000Z",
        text: "q",
      },
      {
        kind: "assistant",
        id: "a",
        createdAt: "2026-10-28T00:00:01.000Z",
        text: "r",
        origin,
      },
    ]);

  it("opens Connect from the off row's Add a key on the thread's own backend", () => {
    defaultBackend(false);
    threadAnsweredBy(OPENAI);
    const { result } = renderHook(() => useTestTurn());

    act(() => result.current.addKey());

    expect(open).toHaveBeenCalledWith("ai-off", OPENAI);
  });

  it("opens Connect plain from Add a key on a thread no key-based backend answered", () => {
    defaultBackend(false);
    const { result } = renderHook(() => useTestTurn());

    act(() => result.current.addKey());

    expect(open).toHaveBeenCalledWith("ai-off", undefined);
  });

  it("opens Connect on the thread's own backend instead of the default", async () => {
    defaultBackend(true);
    threadAnsweredBy(OPENAI);
    const { result } = renderHook(() => useTestTurn());

    await act(() => result.current.send("hi"));

    expect(PgAssistant.connection).toBeNull();
    expect(open).toHaveBeenCalledWith("thread", OPENAI);
    expect(result.current.input).toBe("hi");
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("opens Connect on the thread's own backend over a default the reload reconnected", async () => {
    defaultBackend(true);
    rememberBackend({ id: "default", apiKey: "" });
    threadAnsweredBy(OPENAI);
    const { result } = renderHook(() => useTestTurn());
    await waitFor(() => expect(PgAssistant.connection?.id).toBe("default"));

    await act(() => result.current.send("hi"));

    expect(open).toHaveBeenCalledWith("thread", OPENAI);
    expect(result.current.input).toBe("hi");
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("sends to the default the user picked for a thread another backend answered", async () => {
    defaultBackend(true);
    threadAnsweredBy(OPENAI);
    const { result } = renderHook(() => useTestTurn());
    act(() => PgAssistant.connect({ id: "default", apiKey: "" }));

    await act(() => result.current.send("hi"));

    expect(open).not.toHaveBeenCalled();
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it("connects the default for a thread the default answered", async () => {
    defaultBackend(true);
    threadAnsweredBy({ provider: "default" });
    const { result } = renderHook(() => useTestTurn());

    await act(() => result.current.send("hi"));

    expect(PgAssistant.connection?.id).toBe("default");
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it("opens Connect on the last chosen backend for a thread with no reply", async () => {
    defaultBackend(true);
    localStorage.setItem(REMEMBERED_BACKEND_KEY, JSON.stringify(OPENAI));
    const { result } = renderHook(() => useTestTurn());

    await act(() => result.current.send("hi"));

    expect(PgAssistant.connection).toBeNull();
    expect(open).toHaveBeenCalledWith("send", OPENAI);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("keeps a requested prompt waiting on the thread's own backend", async () => {
    defaultBackend(true);
    threadAnsweredBy(OPENAI);
    const { result } = renderHook(() => useTestTurn());

    act(() => PgAssistant.requestPrompt("Explain this error"));

    await waitFor(() => expect(open).toHaveBeenCalledWith("thread", OPENAI));
    expect(PgAssistant.connection).toBeNull();
    expect(result.current.input).toBe("Explain this error");
    expect(provider.send).not.toHaveBeenCalled();
  });
});

describe("useTurn without a session", () => {
  beforeEach(() => PgSession.refreshWith(null));

  it("opens Connect and keeps the text for a send the default cannot take", async () => {
    defaultBackend(true);
    const { result } = renderHook(() => useTestTurn());

    await act(() => result.current.send("hi"));

    expect(PgAssistant.connection).toBeNull();
    expect(open).toHaveBeenCalledWith("send", undefined);
    expect(result.current.input).toBe("hi");
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("waits for the page's session read before a send decides", async () => {
    PgSession.reset();
    let answer!: () => void;
    const reads = vi.fn();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (!String(input).includes("/api/auth/get-session")) {
        return {
          ok: true,
          // eslint-disable-next-line unicorn/no-null -- a `GET /api/ai/status` body: `null` is on the wire
          json: async () => ({ key: "hosted", reason: null, model: null }),
        } as Response;
      }
      reads();
      await new Promise<void>((resolve) => (answer = resolve));
      return { ok: true, json: async () => ({ user: USER }) } as Response;
    });
    // The page's own read, still out when the first send comes
    const read = PgSession.refresh();
    const { result } = renderHook(() => useTestTurn());

    const sent = act(() => result.current.send("hi"));
    await waitFor(() => expect(reads).toHaveBeenCalled());
    answer();
    await Promise.all([read, sent]);

    expect(reads).toHaveBeenCalledTimes(1);
    expect(PgAssistant.connection?.id).toBe("default");
    expect(open).not.toHaveBeenCalled();
  });

  it("does not read the session again once a read found nobody", async () => {
    defaultBackend(true);
    const { result } = renderHook(() => useTestTurn());

    await act(() => result.current.send("hi"));

    const reads = vi
      .mocked(globalThis.fetch)
      .mock.calls.filter(([input]) =>
        String(input).includes("/api/auth/get-session")
      );
    expect(reads).toHaveLength(0);
    expect(open).toHaveBeenCalledWith("send", undefined);
  });

  it("opens Connect for a send on the default once the session has ended", async () => {
    await PgSession.refreshWith(USER);
    PgAssistant.connect({ id: "default", apiKey: "" });
    const { result } = renderHook(() => useTestTurn());
    await act(() => PgSession.refreshWith(null));

    await act(() => result.current.send("hi"));

    expect(open).toHaveBeenCalledWith("send", undefined);
    expect(result.current.input).toBe("hi");
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("keeps a requested prompt waiting while the default has no session", async () => {
    defaultBackend(true);
    const { result } = renderHook(() => useTestTurn());

    act(() => PgAssistant.requestPrompt("Explain this error"));

    await waitFor(() => expect(result.current.promptWaiting).toBe(true));
    expect(result.current.input).toBe("Explain this error");
    expect(open).toHaveBeenCalledWith("send", undefined);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("sends on a key-based backend", async () => {
    PgAssistant.connect({ id: "openai", apiKey: "sk-test" });
    const { result } = renderHook(() => useTestTurn());

    await act(() => result.current.send("hi"));

    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it("sends a requested prompt on a key-based backend", async () => {
    PgAssistant.connect({ id: "openai", apiKey: "sk-test" });
    renderHook(() => useTestTurn());

    act(() => PgAssistant.requestPrompt("Explain this error", { send: true }));

    await waitFor(() => expect(provider.send).toHaveBeenCalledTimes(1));
    expect(open).not.toHaveBeenCalled();
  });

  it("reconnects nothing for a panel that is gone", async () => {
    defaultBackend(true);
    rememberBackend({ id: "default", apiKey: "" });
    const { unmount } = renderHook(() => useTestTurn());
    await act(async () => {});
    unmount();

    await act(() => PgSession.refreshWith(USER));

    expect(PgAssistant.connection).toBeNull();
  });

  it("reconnects a remembered default only once signed in", async () => {
    defaultBackend(true);
    rememberBackend({ id: "default", apiKey: "" });

    renderHook(() => useTestTurn());
    await act(async () => {});
    expect(PgAssistant.connection).toBeNull();

    await act(() => PgSession.refreshWith(USER));

    await waitFor(() => expect(PgAssistant.connection?.id).toBe("default"));
  });
});

/** A probe held until the test answers it: a hosted key with no model, or none */
const heldProbe = () => {
  let release!: (configured: boolean) => void;
  vi.spyOn(globalThis, "fetch").mockReturnValue(
    new Promise<Response>((resolve) => {
      release = (configured) =>
        resolve({
          ok: true,
          status: 200,
          json: async () => ({
            key: configured ? "hosted" : "own",
            /* eslint-disable unicorn/no-null -- a `GET /api/ai/status` body: `null` is on the wire */
            reason: null,
            model: null,
            /* eslint-enable unicorn/no-null */
          }),
        } as Response);
    })
  );
  return (configured: boolean) => act(async () => release(configured));
};

describe("useTurn across a project switch", () => {
  /** The open project, as the test switches it while the probe is out */
  const inProject = (id: string) =>
    vi.spyOn(PgExplorer, "currentWorkspaceId", "get").mockReturnValue(id);

  it("sends nothing to a project opened while a send waited on the probe", async () => {
    const release = heldProbe();
    const project = inProject("a");
    const { result } = renderHook(() => useTestTurn());
    // Typed into the composer, as a send from it always is
    act(() => result.current.setInput("about project a"));

    let sent!: Promise<void>;
    act(() => {
      sent = result.current.send("about project a");
    });
    project.mockReturnValue("b");
    await release(true);
    await act(() => sent);

    expect(provider.send).not.toHaveBeenCalled();
    expect(PgAssistant.items).toEqual([]);
    // Left where the user can send it to the project now open, or not
    expect(result.current.input).toBe("about project a");
  });

  it("sends no requested prompt to a project opened while it waited on the probe", async () => {
    const release = heldProbe();
    const project = inProject("a");
    const { result } = renderHook(() => useTestTurn());

    act(() => PgAssistant.requestPrompt("Explain this error in a"));
    project.mockReturnValue("b");
    await release(true);

    await waitFor(() =>
      expect(result.current.input).toBe("Explain this error in a")
    );
    expect(provider.send).not.toHaveBeenCalled();
    expect(PgAssistant.items).toEqual([]);
  });

  it("starts the model afresh in the conversation of a project opened later", async () => {
    PgAssistant.connect({ id: "openai", apiKey: "sk-test" });
    const thread = vi
      .spyOn(PgAssistant, "threadId", "get")
      .mockReturnValue("thread-a");
    const { result } = renderHook(() => useTestTurn());
    await act(() => result.current.send("about a"));

    thread.mockReturnValue("thread-b");
    await act(() => result.current.send("about b"));

    // One provider per conversation: b's must not carry a's history
    expect(vi.mocked(createProvider)).toHaveBeenCalledTimes(2);
  });

  it("still sends when the project stays the same", async () => {
    const release = heldProbe();
    inProject("a");
    const { result } = renderHook(() => useTestTurn());

    let sent!: Promise<void>;
    act(() => {
      sent = result.current.send("about project a");
    });
    await release(true);
    await act(() => sent);

    expect(provider.send).toHaveBeenCalledTimes(1);
  });
});

describe("useTurn's failures and races", () => {
  let logs: ReturnType<typeof memoryLog>;

  beforeEach(() => {
    logs = memoryLog();
    initLogger({ providers: [logs] });
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    resetLogger();
  });

  const logged = () => logs.entries.map((e) => [e.ns, e.level, e.report]);

  it("keeps a requested prompt and reports when connecting the default throws", async () => {
    defaultBackend(true);
    const failure = new Error("connect is broken");
    vi.spyOn(PgAssistant, "connect").mockImplementation(() => {
      throw failure;
    });
    const report = vi.fn();
    const reportFor = vi
      .spyOn(reportModule, "reportButtonFailure")
      .mockReturnValue(report);
    const { result } = renderHook(() => useTestTurn());

    act(() => PgAssistant.requestPrompt("Explain this error"));

    await waitFor(() => expect(report).toHaveBeenCalledWith(failure));
    expect(reportFor).toHaveBeenCalledWith("send the prompt");
    expect(result.current.input).toBe("Explain this error");
  });

  it("keeps a requested prompt and reports when opening Connect throws", async () => {
    defaultBackend(false);
    const failure = new Error("the dialog host is gone");
    open.mockImplementationOnce(() => {
      throw failure;
    });
    const report = vi.fn();
    const reportFor = vi
      .spyOn(reportModule, "reportButtonFailure")
      .mockReturnValue(report);
    const { result } = renderHook(() => useTestTurn());

    act(() => PgAssistant.requestPrompt("Explain this error"));

    await waitFor(() => expect(report).toHaveBeenCalledWith(failure));
    expect(reportFor).toHaveBeenCalledWith("send the prompt");
    expect(result.current.input).toBe("Explain this error");
  });

  describe("a reply cut off mid-stream", () => {
    const failAfter = (text: string, error: unknown) =>
      provider.send.mockImplementation(async () => {
        if (text) {
          const id = PgAssistant.startAssistantMessage();
          PgAssistant.appendToAssistantMessage(id, text);
        }
        throw error;
      });

    it("keeps the text and marks the reply cut off on a network error", async () => {
      PgAssistant.connect({ id: "default", apiKey: "" });
      failAfter("The program", new TypeError("network error"));
      const { result } = renderHook(() => useTestTurn());

      await act(() => result.current.send("What does this program do?"));

      const reply = firstReply();
      expect(reply).toMatchObject({ text: "The program", state: "cut-off" });
      expect(PgAssistant.isCutOff(reply)).toBe(true);
      expect(PgAssistant.items.some((i) => i.kind === "error")).toBe(false);
      expect(eventNames()).toContainEqual([
        "assistant_reply_failed",
        { reason: "interrupted" },
      ]);
      expect(logged()).toContainEqual(["assistant:turn", "warn", false]);
    });

    it("marks the reply cut off on the network failure runTurn reports", async () => {
      PgAssistant.connect({ id: "default", apiKey: "" });
      failAfter(
        "The program",
        new TurnFailure("network error", {
          reason: "provider",
          cause: new AiTurnError("network error", { kind: "network" }),
        })
      );
      const { result } = renderHook(() => useTestTurn());

      await act(() => result.current.send("What does this program do?"));

      const reply = firstReply();
      expect(reply).toMatchObject({ text: "The program", state: "cut-off" });
      expect(PgAssistant.items.some((i) => i.kind === "error")).toBe(false);
    });

    it("says the connection dropped, in words, when it drops before any text", async () => {
      PgAssistant.connect({ id: "default", apiKey: "" });
      failAfter("", new TypeError("Load failed"));
      const { result } = renderHook(() => useTestTurn());

      await act(() => result.current.send("hi"));

      const last = lastItem();
      expect(last.kind).toBe("error");
      expect(isConnectionLost(last)).toBe(true);
      expect(PgAssistant.items.some((i) => i.kind === "assistant")).toBe(false);
      expect(eventNames()).toContainEqual([
        "assistant_reply_failed",
        { reason: "connection-lost" },
      ]);
      expect(logged()).toContainEqual(["assistant:turn", "warn", false]);
    });

    it("shows a programming TypeError after text as an error, not a cut-off", async () => {
      PgAssistant.connect({ id: "default", apiKey: "" });
      failAfter(
        "The program",
        new TypeError("Cannot read properties of undefined (reading 'x')")
      );
      const { result } = renderHook(() => useTestTurn());

      await act(() => result.current.send("hi"));

      const reply = firstReply();
      expect(PgAssistant.isCutOff(reply)).toBe(false);
      expect(PgAssistant.items.at(-1)).toMatchObject({ kind: "error" });
    });

    it("cuts off nothing when the request drops after a finished reply and a tool", async () => {
      PgAssistant.connect({ id: "default", apiKey: "" });
      provider.send.mockImplementation(async () => {
        const id = PgAssistant.startAssistantMessage();
        PgAssistant.appendToAssistantMessage(id, "Let me read it.");
        PgAssistant.addToolCall("read src/lib.rs");
        throw new TypeError("Failed to fetch");
      });
      const { result } = renderHook(() => useTestTurn());

      await act(() => result.current.send("hi"));

      const reply = firstReply();
      expect(PgAssistant.isCutOff(reply)).toBe(false);
      expect(isConnectionLost(lastItem())).toBe(true);
    });

    it.each([
      "Failed to fetch",
      "fetch failed",
      "network error",
      "NetworkError when attempting to fetch resource.",
      "Error in input stream",
      "Load failed",
      "The network connection was lost.",
      "terminated",
    ])("reads %j after text as a cut-off reply", async (message) => {
      PgAssistant.connect({ id: "default", apiKey: "" });
      failAfter("The program", new TypeError(message));
      const { result } = renderHook(() => useTestTurn());

      await act(() => result.current.send("hi"));

      const reply = firstReply();
      expect(PgAssistant.isCutOff(reply)).toBe(true);
    });

    it.each([
      [
        "a TypeError that only contains a network message",
        new TypeError("prefix failed to fetch"),
      ],
      [
        "a network message that is not a TypeError",
        new Error("Failed to fetch"),
      ],
      [
        "a network message with more after it",
        new TypeError("Failed to fetch: x"),
      ],
    ])("shows %s after text as an error", async (_, error) => {
      PgAssistant.connect({ id: "default", apiKey: "" });
      failAfter("The program", error);
      const { result } = renderHook(() => useTestTurn());

      await act(() => result.current.send("hi"));

      const reply = firstReply();
      expect(PgAssistant.isCutOff(reply)).toBe(false);
      expect(PgAssistant.items.at(-1)).toMatchObject({ kind: "error" });
    });

    it("shows a TypeError that only mentions fetch as an error", async () => {
      PgAssistant.connect({ id: "default", apiKey: "" });
      failAfter("The program", new TypeError("x.fetch is not a function"));
      const { result } = renderHook(() => useTestTurn());

      await act(() => result.current.send("hi"));

      const reply = firstReply();
      expect(PgAssistant.isCutOff(reply)).toBe(false);
      expect(PgAssistant.items.at(-1)).toMatchObject({ kind: "error" });
    });

    it("shows any other failure after text as an error", async () => {
      PgAssistant.connect({ id: "default", apiKey: "" });
      failAfter("The program", new Error("The model refused"));
      const { result } = renderHook(() => useTestTurn());

      await act(() => result.current.send("hi"));

      const reply = firstReply();
      expect(PgAssistant.isCutOff(reply)).toBe(false);
      expect(PgAssistant.items.at(-1)).toMatchObject({
        kind: "error",
        text: "The model refused",
      });
    });
  });

  it("logs, and reports, an error a stopped turn ends with", async () => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    let fail!: (error: unknown) => void;
    provider.send.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject;
        })
    );
    const { result } = renderHook(() => useTestTurn());
    act(() => {
      void result.current.send("hi");
    });
    act(() => result.current.stop());

    await act(async () => fail(new Error("the stream broke")));

    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(logged()).toEqual([["assistant:turn", "error", true]]);
    // Stopping is the user's own doing: nothing more on screen than Stopped.
    expect(PgAssistant.items.map((item) => item.kind)).not.toContain("error");
  });

  it("logs the abort a stopped turn ends with at debug only", async () => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    provider.send.mockImplementation(
      (_: string, turn: SendTurn) =>
        new Promise<void>((_resolve, reject) => {
          turn?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The user aborted", "AbortError"))
          );
        })
    );
    const { result } = renderHook(() => useTestTurn());
    act(() => {
      void result.current.send("hi");
    });

    act(() => result.current.stop());

    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(logged()).toEqual([["assistant:turn", "debug", false]]);
  });

  it("logs a failed reconnect of the remembered default", async () => {
    defaultBackend(true);
    rememberBackend({ id: "default", apiKey: "" });
    vi.spyOn(PgAssistant, "connect").mockImplementation(() => {
      throw new Error("connect is broken");
    });

    renderHook(() => useTestTurn());

    await waitFor(() =>
      expect(logged()).toEqual([["assistant:connect", "error", true]])
    );
  });

  it("does not reconnect a remembered default once Connect a model opened during the probe", async () => {
    rememberBackend({ id: "default", apiKey: "" });
    const release = heldProbe();
    renderHook(() => useTestTurn());

    act(() => PgAssistant.pickBackend());
    await release(true);

    expect(PgAssistant.connection).toBeNull();
    expect(PgAssistant.isPickingBackend).toBe(true);
  });

  it("does not reconnect a remembered default after the panel unmounts", async () => {
    rememberBackend({ id: "default", apiKey: "" });
    const release = heldProbe();
    const { unmount } = renderHook(() => useTestTurn());

    unmount();
    await release(true);

    expect(PgAssistant.connection).toBeNull();
  });

  it("sends nothing, and opens nothing, for a whitespace-only send", async () => {
    const { result } = renderHook(() => useTestTurn());

    await act(() => result.current.send("   "));

    expect(provider.send).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(PgAssistant.items.length).toBe(0);
  });

  it("sends to what was connected while the default was probed, not the default", async () => {
    const release = heldProbe();
    const { result } = renderHook(() => useTestTurn());
    let sent!: Promise<void>;
    act(() => {
      sent = result.current.send("hi");
    });

    act(() => PgAssistant.connect({ id: "anthropic", apiKey: "sk-ant-mid" }));
    await release(true);
    await act(() => sent);

    expect(PgAssistant.connection?.id).toBe("anthropic");
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createProvider).mock.calls[0][0]).toMatchObject({
      id: "anthropic",
    });
  });

  it("pushes the thread at the end of a turn", async () => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    vi.spyOn(PgAssistant, "threadId", "get").mockReturnValue("thread-1");
    vi.mocked(pushThread).mockClear();
    const { result } = renderHook(() => useTestTurn());

    await act(() => result.current.send("hi"));

    expect(pushThread).toHaveBeenCalledTimes(1);
    expect(pushThread).toHaveBeenCalledWith("thread-1");
  });
});

/**
 * Sign-out's teardown and a workspace switch both close the open thread. A
 * turn still running then belongs to a thread that is gone, and nothing it
 * does afterwards may land in the one that opens next.
 */
describe("useTurn when the thread closes mid-turn", () => {
  /** What the turn sees: its signal, and a way to let it finish */
  interface HeldTurn {
    signal: AbortSignal;
    finish: () => void;
  }

  let held: Promise<HeldTurn>;

  beforeEach(async () => {
    (PgFs as unknown as { __files: Map<string, string> }).__files.clear();
    PgAssistant.closeThread();
    PgAssistant.clear();
    PgAssistant.connect({ id: "default", apiKey: "" });
    await PgAssistant.loadThread("before");
    vi.mocked(pushThread).mockClear();

    held = new Promise((started) => {
      provider.send.mockImplementation(
        (_text: string, turn: SendTurn) =>
          new Promise<void>((finish) => {
            if (!turn?.signal) throw new Error("the turn has no signal");
            started({ signal: turn.signal, finish });
          })
      );
    });
  });
  afterEach(async () => {
    act(() => PgAssistant.closeThread());
    await PgAssistant.whenPersisted();
  });

  /** Send a prompt and wait until the provider has it */
  const startTurn = async () => {
    const hook = renderHook(() => useTestTurn());
    act(() => {
      void hook.result.current.send("build it");
    });
    return { hook, turn: await held };
  };

  it("stops the turn when its thread closes", async () => {
    const { turn } = await startTurn();

    act(() => PgAssistant.closeThread());

    expect(turn.signal.aborted).toBe(true);
    await act(async () => turn.finish());
  });

  it("writes nothing from the stopped turn into the thread opened next", async () => {
    const { turn } = await startTurn();

    act(() => PgAssistant.closeThread());
    await act(() => PgAssistant.loadThread("after"));

    // What a provider still unwinding does: its tools report, its reply
    // streams, its gated tool asks, and the request fails
    let approval: Promise<{ allowed: boolean }> | undefined;
    act(() => {
      PgAssistant.addToolCall("read src/lib.rs");
      const reply = PgAssistant.startAssistantMessage();
      PgAssistant.appendToAssistantMessage(reply, "Half a rep");
      approval = PgAssistant.requestApproval({
        type: "command",
        name: "build",
        effect: "builds",
      });
      PgAssistant.addError("request failed");
    });
    await act(async () => turn.finish());

    expect(PgAssistant.items).toEqual([]);
    expect(PgAssistant.status).toBe("idle");
    await expect(approval).resolves.toMatchObject({ allowed: false });
    expect(pushThread).not.toHaveBeenCalled();
    await PgAssistant.whenPersisted();
    expect(await PgChatStorage.read("after")).toEqual([]);
  });

  it("lets the next turn write to the thread opened next", async () => {
    const { hook, turn } = await startTurn();
    act(() => PgAssistant.closeThread());
    await act(() => PgAssistant.loadThread("after"));
    await act(async () => turn.finish());

    provider.send.mockImplementation(async () => {
      PgAssistant.addToolCall("read src/lib.rs");
    });
    await act(() => hook.result.current.send("again"));

    expect(PgAssistant.items.map((i) => i.kind)).toEqual(["user", "tool"]);
  });

  it("starts no turn over the stopped one, even from a remounted panel", async () => {
    const { hook, turn } = await startTurn();
    act(() => PgAssistant.closeThread());
    await act(() => PgAssistant.loadThread("after"));

    // Leaving for another view and back loses the hook's own controller
    hook.unmount();
    const { result } = renderHook(() => useTestTurn());
    expect(result.current.phase).toBe("stopping");
    await act(() => result.current.send("again"));
    act(() => PgAssistant.addNotice("the old tool reports late"));

    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(PgAssistant.items).toEqual([]);
    await act(async () => turn.finish());
    await waitFor(() => expect(result.current.phase).toBe("idle"));
  });
});

describe("useTurn's turn events", () => {
  const PROMPT = "please refactor my secret-sauce program";
  const BUSY = "The model is busy.";
  /** The `assistant_turn_*` events, in order, with their parameters */
  const turnEvents = () =>
    events.events
      .filter((e) => e.name.startsWith("assistant_turn_"))
      .map((e) => [e.name, e.params]);
  const sent = ["assistant_turn_sent", { provider: "default" }];
  const failed = (reason: string) => [
    "assistant_turn_failed",
    { provider: "default", reason },
  ];
  /** As `failed`, for a failure the backend answered with HTTP `status` */
  const failedWith = (status: number) => (reason: string) =>
    ["assistant_turn_failed", { provider: "default", reason, status }];

  beforeEach(() => PgAssistant.connect({ id: "default", apiKey: "" }));

  it("reports an answered turn as sent, then answered", async () => {
    const { result } = renderHook(() => useTestTurn());

    await act(() => result.current.send(PROMPT));

    expect(turnEvents()).toStrictEqual([
      sent,
      ["assistant_turn_answered", { provider: "default" }],
    ]);
  });

  it("names the connection's backend", async () => {
    PgAssistant.connect({ id: "anthropic", apiKey: "sk-test" });
    const { result } = renderHook(() => useTestTurn());

    await act(() => result.current.send(PROMPT));

    expect(turnEvents()).toStrictEqual([
      ["assistant_turn_sent", { provider: "anthropic" }],
      ["assistant_turn_answered", { provider: "anthropic" }],
    ]);
  });

  it("reports nothing for a send with no backend", async () => {
    PgAssistant.disconnect();
    const { result } = renderHook(() => useTestTurn());

    await act(() => result.current.send(PROMPT));

    expect(provider.send).not.toHaveBeenCalled();
    expect(turnEvents()).toStrictEqual([]);
  });

  it("reports nothing for a send refused while a turn runs", async () => {
    provider.send.mockImplementation(untilAborted);
    const { result } = renderHook(() => useTestTurn());
    act(() => {
      void result.current.send(PROMPT);
    });

    await act(() => result.current.send("second"));

    expect(turnEvents()).toStrictEqual([sent]);
  });

  it("ends a stopped turn with stopped alone", async () => {
    provider.send.mockImplementation(untilAborted);
    const { result } = renderHook(() => useTestTurn());
    act(() => {
      void result.current.send(PROMPT);
    });

    act(() => result.current.stop());
    await waitFor(() => expect(result.current.busy).toBe(false));

    expect(turnEvents()).toStrictEqual([sent, ["assistant_turn_stopped", {}]]);
  });

  it.each([
    [
      "a provider error with its status",
      new TurnFailure("Provider says no", { reason: "provider", status: 500 }),
      failedWith(500)("provider"),
    ],
    [
      "a refusal, with no status",
      new TurnFailure("Refused. Rephrase it.", { reason: "refusal" }),
      failed("refusal"),
    ],
    [
      "a turn that kept pausing",
      new TurnFailure("Paused too often.", { reason: "paused" }),
      failed("paused"),
    ],
    [
      "an upstream 429 that is not a cap",
      new TurnFailure("Rate limited.", { reason: "provider", status: 429 }),
      failedWith(429)("provider"),
    ],
    [
      "a key the backend rejects",
      new TurnFailure("Unauthorized", {
        reason: "provider",
        status: 401,
        cause: new AiTurnError("Unauthorized", {
          kind: "key-refused",
          status: 401,
        }),
      }),
      failedWith(401)("provider"),
    ],
    [
      "a failure raised on this side, such as the step limit",
      new Error("The model was still calling tools after 25 rounds."),
      failed("other"),
    ],
    [
      "a connection that drops before the reply",
      new TypeError("Failed to fetch"),
      failed("provider"),
    ],
    // eslint-disable-next-line max-params -- `it.each` spreads each row of the table into the callback
  ])("reports %s as failed", async (_, error, expected) => {
    provider.send.mockRejectedValue(error);
    const { result } = renderHook(() => useTestTurn());

    await act(() => result.current.send(PROMPT));

    expect(turnEvents()).toStrictEqual([sent, expected]);
  });

  it.each([
    ["the daily cap's 429", 429],
    ["the exhausted pool's 503", 503],
  ])(
    "reports the cost gate's refusal by %s as capped, not failed",
    async (_, status) => {
      provider.send.mockRejectedValue(
        new TurnFailure("You have used today's messages.", {
          reason: "capped",
          status,
        })
      );
      const { result } = renderHook(() => useTestTurn());

      await act(() => result.current.send(PROMPT));

      expect(turnEvents()).toStrictEqual([
        sent,
        ["assistant_turn_capped", { provider: "default" }],
      ]);
    }
  );

  it("reports a key a key-based backend rejects once as failed, beside key_rejected", async () => {
    PgAssistant.connect({ id: "anthropic", apiKey: "sk-test" });
    provider.send.mockRejectedValue(
      new TurnFailure("Unauthorized", {
        reason: "provider",
        status: 401,
        cause: new AiTurnError("Unauthorized", {
          kind: "key-refused",
          status: 401,
        }),
      })
    );
    const { result } = renderHook(() => useTestTurn());

    await act(() => result.current.send(PROMPT));

    expect(turnEvents()).toStrictEqual([
      ["assistant_turn_sent", { provider: "anthropic" }],
      [
        "assistant_turn_failed",
        { provider: "anthropic", reason: "provider", status: 401 },
      ],
    ]);
    expect(eventNames()).toContainEqual([
      "assistant_key_rejected",
      { provider: "anthropic" },
    ]);
  });

  it("reports a turn that resolves after a Stop as stopped alone", async () => {
    let finish!: () => void;
    // A provider that ignores the abort and completes anyway
    provider.send.mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve))
    );
    const { result } = renderHook(() => useTestTurn());
    act(() => {
      void result.current.send(PROMPT);
    });

    act(() => result.current.stop());
    await act(async () => finish());
    await waitFor(() => expect(result.current.busy).toBe(false));

    expect(turnEvents()).toStrictEqual([sent, ["assistant_turn_stopped", {}]]);
  });

  it("reports nothing more for a turn a backend change cuts off", async () => {
    provider.send.mockImplementation(untilAborted);
    const { result } = renderHook(() => useTestTurn());
    act(() => {
      void result.current.send(PROMPT);
    });

    act(() => PgAssistant.connect({ id: "anthropic", apiKey: "sk-test" }));
    await waitFor(() => expect(result.current.busy).toBe(false));

    expect(turnEvents()).toStrictEqual([sent]);
  });

  it.each([
    [
      "an answer",
      () => {
        // answered: the default stub resolves
      },
    ],
    [
      "a failure that quotes the prompt",
      () =>
        provider.send.mockRejectedValue(
          new TurnFailure(`The model refused: "${PROMPT}"`, {
            reason: "refusal",
          })
        ),
    ],
  ])("puts no part of the prompt in any event after %s", async (_, arrange) => {
    arrange();
    const { result } = renderHook(() => useTestTurn());

    await act(() => result.current.send(PROMPT));

    expect(turnEvents()).toHaveLength(2);
    expect(JSON.stringify(events.events)).not.toContain("secret-sauce");
  });

  it("puts no part of the prompt in any event after a Stop", async () => {
    provider.send.mockImplementation(untilAborted);
    const { result } = renderHook(() => useTestTurn());
    act(() => {
      void result.current.send(PROMPT);
    });

    act(() => result.current.stop());
    await waitFor(() => expect(result.current.busy).toBe(false));

    expect(turnEvents()).toHaveLength(2);
    expect(JSON.stringify(events.events)).not.toContain("secret-sauce");
  });

  describe("across a busy model's resend", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => vi.useRealTimers());

    const busy = () => new ModelBusyError(1, BUSY, { status: 429 });

    it("reports one sent and one answered", async () => {
      provider.send
        .mockRejectedValueOnce(busy())
        .mockResolvedValueOnce(undefined);
      const { result } = renderHook(() => useTestTurn());

      await act(() => result.current.send(PROMPT));
      await act(() => vi.advanceTimersByTimeAsync(1_000));
      await waitFor(() => expect(provider.send).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(result.current.busy).toBe(false));

      expect(turnEvents()).toStrictEqual([
        sent,
        ["assistant_turn_answered", { provider: "default" }],
      ]);
    });

    it("reports failed with the busy status once it gives up", async () => {
      provider.send.mockRejectedValue(busy());
      const { result } = renderHook(() => useTestTurn());

      await act(() => result.current.send(PROMPT));
      for (let i = 0; i < 3; i++) {
        await act(() => vi.advanceTimersByTimeAsync(1_000));
      }
      await waitFor(() => expect(provider.send).toHaveBeenCalledTimes(4));
      await waitFor(() => expect(result.current.busy).toBe(false));

      expect(turnEvents()).toStrictEqual([sent, failedWith(429)("provider")]);
    });

    it("reports a Stop during the countdown as stopped", async () => {
      provider.send.mockRejectedValueOnce(busy());
      const { result } = renderHook(() => useTestTurn());
      await act(() => result.current.send(PROMPT));

      act(() => result.current.stop());
      await act(() => vi.advanceTimersByTimeAsync(5_000));

      expect(turnEvents()).toStrictEqual([
        sent,
        ["assistant_turn_stopped", {}],
      ]);
    });

    it("reports a resend refused for a changed model as failed, other", async () => {
      provider.send.mockRejectedValueOnce(busy());
      const { result } = renderHook(() => useTestTurn());
      await act(() => result.current.send(PROMPT));

      act(() => PgAssistant.connect({ id: "anthropic", apiKey: "sk-test" }));
      await act(() => vi.advanceTimersByTimeAsync(1_000));
      await waitFor(() => expect(result.current.retry).toBeNull());

      expect(provider.send).toHaveBeenCalledTimes(1);
      // Named after the backend the turn was sent to, not the one picked since
      expect(turnEvents()).toStrictEqual([sent, failed("other")]);
    });

    it("reports nothing more for a wait a sign-out drops", async () => {
      provider.send.mockRejectedValueOnce(busy());
      const { result } = renderHook(() => useTestTurn());
      await act(() => result.current.send(PROMPT));

      act(() => PgAssistant.disconnect());
      await act(() => vi.advanceTimersByTimeAsync(1_000));
      await waitFor(() => expect(result.current.retry).toBeNull());

      expect(turnEvents()).toStrictEqual([sent]);
    });

    it("reports a resend that fails for another reason once, with one sent", async () => {
      provider.send.mockRejectedValueOnce(busy()).mockRejectedValueOnce(
        new TurnFailure("Provider says no", {
          reason: "provider",
          status: 500,
        })
      );
      const { result } = renderHook(() => useTestTurn());

      await act(() => result.current.send(PROMPT));
      await act(() => vi.advanceTimersByTimeAsync(1_000));
      await waitFor(() => expect(provider.send).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(result.current.busy).toBe(false));

      expect(turnEvents()).toStrictEqual([sent, failedWith(500)("provider")]);
    });

    it("reports a wait longer than it counts down as failed at once", async () => {
      provider.send.mockRejectedValueOnce(
        new ModelBusyError(3600, BUSY, { status: 429 })
      );
      const { result } = renderHook(() => useTestTurn());

      await act(() => result.current.send(PROMPT));

      expect(turnEvents()).toStrictEqual([sent, failedWith(429)("provider")]);
    });
  });
});
