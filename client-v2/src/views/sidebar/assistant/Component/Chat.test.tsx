// Chat's legacy imports reach the utils barrel, whose generated globals exist
// only once the app has booted; what is under test is only which view shows.
vi.mock("../../../../components/GradientButton", () => ({
  default: (props: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={props.onClick}>{props.children}</button>
  ),
}));
vi.mock("../../../../components/Input", () => ({
  default: (props: { id?: string }) => <input id={props.id} />,
}));
vi.mock("../../../../components/Link", () => ({
  default: (props: { children: React.ReactNode }) => (
    <span>{props.children}</span>
  ),
}));
vi.mock("../../../../components/Select", () => ({ default: () => null }));
vi.mock("../../../../components/Button", () => ({
  default: (props: { children: React.ReactNode }) => (
    <button>{props.children}</button>
  ),
}));
vi.mock("../../../../components/Loading/ThreeDots", () => ({
  ThreeDots: () => null,
}));
vi.mock("./ChatItem", () => ({ default: () => null }));
vi.mock("../../../../utils", () => ({
  PgCommand: {},
  PgExplorer: { currentFilePath: null, getItemNameFromPath: () => "" },
  PgProgramInfo: { idl: null },
}));
vi.mock("../../../../hooks", async () => ({
  useRenderOnChange: (
    await vi.importActual<typeof import("../../../../hooks/useRenderOnChange")>(
      "../../../../hooks/useRenderOnChange"
    )
  ).useRenderOnChange,
}));
vi.mock("../../../flow/lessons", () => ({
  attempted: () => false,
  cursorStep: () => null,
  foldRecord: () => null,
  INITIAL_LESSON_STATE: { path: null, record: [] },
  PgLesson: {
    onDidChange: () => ({ dispose: () => {} }),
    canPass: () => false,
  },
  verifyingStage: () => null,
}));
vi.mock("../bridge/lesson-context", () => ({ describeLesson: () => null }));
vi.mock("../bridge/playground-bridge", () => ({
  realBridge: { listFiles: () => [], listOpenFiles: () => [] },
}));
/** The provider's `send`, which a test may replace to hold a turn open */
const provider = vi.hoisted(() => ({
  send: async (_text: string, _signal: AbortSignal) => {},
}));
vi.mock("../model", () => ({
  createProvider: () => ({
    label: "Test backend",
    send: (text: string, signal: AbortSignal) => provider.send(text, signal),
  }),
}));
vi.mock("../../../../effects/chat-thread/push-thread", () => ({
  pushThread: async () => true,
}));

import { act, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, type DefaultTheme } from "styled-components";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import Chat from "./Chat";
import { PgSession } from "../../../../features/auth";
import { PgChatStorage } from "../../../../features/persistence/model/chat-storage";
import { PgAssistant, type Connection } from "../store";
import { PgFs } from "../../../../utils/explorer/fs";

/** A theme that answers every key; see `Connect.test.tsx` */
const anyTheme: DefaultTheme = new Proxy(
  {},
  {
    get: (_, key) =>
      key === Symbol.toPrimitive || key === "toString"
        ? () => "inherit"
        : anyTheme,
  }
) as unknown as DefaultTheme;

const USER = { id: "u1", name: null, image: null, login: null };

const DEFAULT: Connection = { id: "default", apiKey: "" };
const OWN: Connection = {
  id: "openai",
  apiKey: "sk-test-chat-0123456789",
  endpoint: { baseUrl: "https://api.example.test/v1", model: "gpt-x" },
};

const renderChat = () =>
  render(
    <ThemeProvider theme={anyTheme}>
      <Chat />
    </ThemeProvider>
  );

describe("Chat when the session ends", () => {
  beforeEach(() => {
    PgAssistant.disconnect();
    localStorage.clear();
    sessionStorage.clear();
    // jsdom has no layout, so the chat's follow-the-bottom scroll is missing
    Element.prototype.scrollIntoView = vi.fn();
    void PgSession.refreshWith(USER);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ configured: true }), {
        status: 200,
        headers: { "content-type": "json" },
      })
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    void PgSession.refreshWith(null);
  });

  it("returns a default-backend user to the picker, which offers sign-in", async () => {
    PgAssistant.connect(DEFAULT);
    renderChat();
    expect(screen.getByLabelText("Message the assistant")).toBeTruthy();

    // An expiry or another tab's sign-out: no `relinquish`, only a null session
    await act(() => PgSession.refreshWith(null));
    expect(
      await screen.findByRole("button", { name: "Sign in with GitHub" })
    ).toBeTruthy();
    expect(screen.queryByLabelText("Message the assistant")).toBeNull();
  });

  it("keeps a key-based backend in chat, since it needs no sign-in", async () => {
    PgAssistant.connect(OWN);
    renderChat();

    await act(() => PgSession.refreshWith(null));

    expect(screen.getByLabelText("Message the assistant")).toBeTruthy();
    expect(PgAssistant.isPickingBackend).toBe(false);
  });

  it("offers no way back to chat while the default backend has no session", async () => {
    PgAssistant.connect(DEFAULT);
    renderChat();

    await act(() => PgSession.refreshWith(null));

    expect(
      await screen.findByRole("button", { name: "Sign in with GitHub" })
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back to chat" })).toBeNull();
  });

  it("offers the way back to chat for a key-based backend with no session", async () => {
    PgAssistant.connect(OWN);
    renderChat();
    await act(() => PgSession.refreshWith(null));

    act(() => PgAssistant.pickBackend());

    expect(screen.getByRole("button", { name: "Back to chat" })).toBeTruthy();
  });
});

/**
 * Sign-out's teardown and a workspace switch both close the open thread. A
 * turn still running then belongs to a thread that is gone, and nothing it
 * does afterwards may land in the one that opens next.
 */
describe("Chat when the thread closes mid-turn", () => {
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
    Element.prototype.scrollIntoView = vi.fn();
    PgAssistant.connect(OWN);
    await PgAssistant.loadThread("before");

    held = new Promise((started) => {
      provider.send = (_text, signal) =>
        new Promise<void>((finish) => started({ signal, finish }));
    });
  });
  afterEach(async () => {
    provider.send = async () => {};
    PgAssistant.closeThread();
    PgAssistant.disconnect();
    await PgAssistant.whenPersisted();
  });

  /** Send a prompt and wait until the provider has it */
  const startTurn = async () => {
    renderChat();
    const input = screen.getByLabelText("Message the assistant");
    fireEvent.change(input, { target: { value: "build it" } });
    fireEvent.keyDown(input, { key: "Enter" });
    return held;
  };

  it("stops the turn when its thread closes", async () => {
    const turn = await startTurn();

    act(() => PgAssistant.closeThread());

    expect(turn.signal.aborted).toBe(true);
    await act(async () => turn.finish());
  });

  it("writes nothing from the stopped turn into the thread opened next", async () => {
    const turn = await startTurn();

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
    await PgAssistant.whenPersisted();
    expect(await PgChatStorage.read("after")).toEqual([]);
  });

  it("lets the next turn write to the thread opened next", async () => {
    const turn = await startTurn();
    act(() => PgAssistant.closeThread());
    await act(() => PgAssistant.loadThread("after"));
    await act(async () => turn.finish());

    provider.send = async () => {
      PgAssistant.addToolCall("read src/lib.rs");
    };
    const input = screen.getByLabelText("Message the assistant");
    fireEvent.change(input, { target: { value: "again" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(PgAssistant.items.map((i) => i.kind)).toEqual(["user", "tool"]);
  });
});
