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
import * as reportModule from "@/shared/lib/report-button-failure";
// The class itself, which the slice entry exports as a type only
import { AiTurnError } from "@/shared/lib/ai/run-turn";
import { PgSession } from "@/features/auth";
import { PgAssistant } from "../../../views/sidebar/assistant/store";
import { createProvider } from "../../../views/sidebar/assistant/model";
import type { Provider } from "../../../views/sidebar/assistant/model/types";
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
import { PgChatStorage } from "@/features/persistence/model/chat-storage";
import { resetDefaultBackendProbe } from "./default-backend";
import { useTurn } from "./use-turn";
import type { ConnectOpener } from "./use-turn";

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
    json: async () => ({ configured, model: "z-ai/glm-5.3-flash:US" }),
  } as Response);

/** A provider whose turn runs until its signal aborts, then rejects */
const untilAborted = (_: string, signal?: AbortSignal) =>
  new Promise<void>((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(new Error("aborted")));
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
  });

  it("sends the next message without the open file once it is left out, then with it again", async () => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    vi.spyOn(PgExplorer, "currentFilePath", "get").mockReturnValue(
      "/src/lib.rs"
    );
    const { result } = renderHook(() => useTestTurn());

    act(() => result.current.leaveOutOpenFile("/src/lib.rs"));
    expect(result.current.openFileLeftOut).toBe("/src/lib.rs");
    await act(() => result.current.send("first"));
    expect(provider.send.mock.calls[0][2]).toEqual({ openFile: false });
    expect(result.current.openFileLeftOut).toBeNull();

    await act(() => result.current.send("second"));
    expect(provider.send.mock.calls[1][2]).toEqual({ openFile: true });
  });

  it("leaves nothing out with no file open and nothing left out", async () => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    vi.spyOn(PgExplorer, "currentFilePath", "get").mockReturnValue(null);
    const { result } = renderHook(() => useTestTurn());

    await act(() => result.current.send("hi"));

    expect(provider.send.mock.calls[0][2]).toEqual({ openFile: true });
  });

  it("sends a file the user switched to in full, though another was left out", async () => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    const current = vi
      .spyOn(PgExplorer, "currentFilePath", "get")
      .mockReturnValue("/src/lib.rs");
    const { result } = renderHook(() => useTestTurn());

    act(() => result.current.leaveOutOpenFile("/src/lib.rs"));
    current.mockReturnValue("/src/other.rs");
    await act(() => result.current.send("first"));

    expect(provider.send.mock.calls[0][2]).toEqual({ openFile: true });
  });

  it("keeps the open file left out when a send opens Connect instead of starting a turn", async () => {
    const { result } = renderHook(() => useTestTurn());

    act(() => result.current.leaveOutOpenFile("/src/lib.rs"));
    await act(() => result.current.send("hi"));

    expect(open).toHaveBeenCalled();
    expect(provider.send).not.toHaveBeenCalled();
    expect(result.current.openFileLeftOut).toBe("/src/lib.rs");
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
        json: async () => ({ configured: true, model: null }),
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
    const signal: AbortSignal = provider.send.mock.calls[0][1];
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
    expect(eventNames()).toContainEqual(["assistant_turn_stopped", {}]);
    await waitFor(() => expect(result.current.busy).toBe(false));
  });

  it("names the backend and offers its key again on a 401", async () => {
    const own: Connection = {
      id: "openai",
      apiKey: "sk-test",
      endpoint: { baseUrl: "https://api.example.test/v1", model: "gpt-x" },
    };
    PgAssistant.connect(own);
    provider.send.mockRejectedValue(
      new AiTurnError("Unauthorized", { status: 401 })
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
    ["a 403, which a valid key without access gets too", 403],
    ["a 500", 500],
  ])("keeps the provider's error for %s", async (_, status) => {
    PgAssistant.connect({ id: "anthropic", apiKey: "sk-test" });
    provider.send.mockRejectedValue(
      new AiTurnError("Provider says no", { status })
    );
    const { result } = renderHook(() => useTestTurn());

    await act(() => result.current.send("hi"));

    const error = PgAssistant.items.at(-1);
    expect(error).toMatchObject({ kind: "error", text: "Provider says no" });
    expect(error).not.toHaveProperty("recover");
    expect(eventNames().map(([name]) => name)).not.toContain(
      "assistant_key_rejected"
    );
  });

  it("keeps the ordinary error for a 401 from the default", async () => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    provider.send.mockRejectedValue(
      new AiTurnError("Unauthorized", { status: 401 })
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
          json: async () => ({ configured: true, model: null }),
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

/** A probe held until the test answers it, `configured` with no model */
const heldProbe = () => {
  let release!: (configured: boolean) => void;
  vi.spyOn(globalThis, "fetch").mockReturnValue(
    new Promise<Response>((resolve) => {
      release = (configured) =>
        resolve({
          ok: true,
          status: 200,
          json: async () => ({ configured, model: null }),
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

      const reply = PgAssistant.items.find((i) => i.kind === "assistant")!;
      expect(reply).toMatchObject({ text: "The program", state: "cut-off" });
      expect(PgAssistant.isCutOff(reply)).toBe(true);
      expect(PgAssistant.items.some((i) => i.kind === "error")).toBe(false);
      expect(eventNames()).toContainEqual([
        "assistant_reply_failed",
        { reason: "interrupted" },
      ]);
      expect(logged()).toContainEqual(["assistant:turn", "warn", false]);
    });

    it("shows a network error before any text as an error", async () => {
      PgAssistant.connect({ id: "default", apiKey: "" });
      failAfter("", new TypeError("network error"));
      const { result } = renderHook(() => useTestTurn());

      await act(() => result.current.send("hi"));

      expect(PgAssistant.items.at(-1)).toMatchObject({
        kind: "error",
        text: "network error",
      });
    });

    it("shows a programming TypeError after text as an error, not a cut-off", async () => {
      PgAssistant.connect({ id: "default", apiKey: "" });
      failAfter(
        "The program",
        new TypeError("Cannot read properties of undefined (reading 'x')")
      );
      const { result } = renderHook(() => useTestTurn());

      await act(() => result.current.send("hi"));

      const reply = PgAssistant.items.find((i) => i.kind === "assistant")!;
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

      const reply = PgAssistant.items.find((i) => i.kind === "assistant")!;
      expect(PgAssistant.isCutOff(reply)).toBe(false);
      expect(PgAssistant.items.at(-1)).toMatchObject({
        kind: "error",
        text: "Failed to fetch",
      });
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

      const reply = PgAssistant.items.find((i) => i.kind === "assistant")!;
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

      const reply = PgAssistant.items.find((i) => i.kind === "assistant")!;
      expect(PgAssistant.isCutOff(reply)).toBe(false);
      expect(PgAssistant.items.at(-1)).toMatchObject({ kind: "error" });
    });

    it("shows a TypeError that only mentions fetch as an error", async () => {
      PgAssistant.connect({ id: "default", apiKey: "" });
      failAfter("The program", new TypeError("x.fetch is not a function"));
      const { result } = renderHook(() => useTestTurn());

      await act(() => result.current.send("hi"));

      const reply = PgAssistant.items.find((i) => i.kind === "assistant")!;
      expect(PgAssistant.isCutOff(reply)).toBe(false);
      expect(PgAssistant.items.at(-1)).toMatchObject({ kind: "error" });
    });

    it("shows any other failure after text as an error", async () => {
      PgAssistant.connect({ id: "default", apiKey: "" });
      failAfter("The program", new Error("The model refused"));
      const { result } = renderHook(() => useTestTurn());

      await act(() => result.current.send("hi"));

      const reply = PgAssistant.items.find((i) => i.kind === "assistant")!;
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
      (_: string, signal?: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
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
        (_text: string, signal: AbortSignal) =>
          new Promise<void>((finish) => started({ signal, finish }))
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
