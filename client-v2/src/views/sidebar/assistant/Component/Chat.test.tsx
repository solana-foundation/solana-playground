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
vi.mock("../model", () => ({
  createProvider: () => ({ label: "Test backend", send: async () => {} }),
}));
vi.mock("../../../../effects/chat-thread/push-thread", () => ({
  pushThread: async () => true,
}));

import { act, render, screen } from "@testing-library/react";
import { ThemeProvider, type DefaultTheme } from "styled-components";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import Chat from "./Chat";
import { PgSession } from "../../../../features/auth";
import { PgAssistant, type Connection } from "../store";

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
