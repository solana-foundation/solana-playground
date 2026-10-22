import { act, render, screen, within } from "@testing-library/react";
import { ThemeProvider, type DefaultTheme } from "styled-components";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as memoryLog,
  resetLogger,
} from "../../../shared/lib/logger";
import {
  initTelemetry,
  memoryProvider as memoryTelemetry,
  resetTelemetry,
} from "../../../shared/lib/telemetry";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { PgView } from "@/utils/view";
import { PgSession } from "../../../features/auth";
import { PgAssistant } from "../../../views/sidebar/assistant/store";
import { ModalHost } from "../../overlays";
import type { Connection } from "../../../views/sidebar/assistant/store";
import type { DefaultBackend } from "../model/default-backend";
import { useTurn } from "../model/use-turn";
import { AssistantComposer } from "./AssistantComposer";
import { openConnectDialog } from "./ConnectDialog";

// The probe is the deployment's; a test says what it answered
let backend: DefaultBackend;
vi.mock("../model/default-backend", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../model/default-backend")
  >();
  return {
    probeDefaultBackend: original.probeDefaultBackend,
    resetDefaultBackendProbe: original.resetDefaultBackendProbe,
    useDefaultBackend: () => backend,
  };
});
// Connect a model's footer link reaches the utils barrel, which needs the
// build's globals; the dialog is not drawn here
vi.mock("../../../components/Link", () => ({ default: () => null }));
// Reaches the explorer and the account; a turn's end only has to ask for it
vi.mock("../../../effects/chat-thread/push-thread", () => ({
  pushThread: vi.fn(() => Promise.resolve()),
}));

// What the chips read: the workspace, the bridge and the lesson. The real ones
// reach the utils barrel, which needs the build's globals
vi.mock("../../../utils/explorer/explorer", () => ({
  PgExplorer: {
    currentFilePath: "src/lib.rs",
    getItemNameFromPath: (path: string) => path.split("/").pop(),
  },
}));
vi.mock("../../../utils/program-info", () => ({
  PgProgramInfo: { idl: null },
}));
vi.mock("../../../views/sidebar/assistant/bridge/playground-bridge", () => ({
  realBridge: {
    listFiles: () => ["src/lib.rs"],
    listOpenFiles: () => ["src/lib.rs"],
  },
}));
vi.mock("../../../views/sidebar/assistant/bridge/build-output", () => ({
  PgBuildOutput: { latest: null },
}));
vi.mock("../../../views/flow/lessons", () => ({
  INITIAL_LESSON_STATE: { path: null, record: [] },
  PgLesson: { onDidChange: () => ({ dispose: () => {} }) },
}));

/**
 * A theme that answers every key: Connect a model's form reads deep theme
 * keys for its styles, and the real theme needs the utils barrel
 */
const anyTheme: DefaultTheme = new Proxy(
  {},
  {
    get: (_, key) =>
      key === Symbol.toPrimitive || key === "toString"
        ? () => "inherit"
        : anyTheme,
  }
) as unknown as DefaultTheme;

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let events: ReturnType<typeof memoryTelemetry>;
let logs: ReturnType<typeof memoryLog>;

const anthropic: Connection = {
  id: "anthropic",
  apiKey: "sk-ant-fake",
  settings: { model: "claude-opus-5-5", effort: "medium" },
};

/** The composer with the turn held by its parent, as the widget holds it */
function Harness() {
  const turn = useTurn({ open: openConnectDialog });
  return (
    <TooltipProvider>
      <AssistantComposer turn={turn} />
    </TooltipProvider>
  );
}

const tracked = () => events.events.map((e) => [e.name, e.params]);

const openMenu = async (name: RegExp) => {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name }));
  return user;
};

beforeEach(() => {
  events = memoryTelemetry();
  logs = memoryLog();
  initTelemetry({ providers: [events] });
  initLogger({ providers: [logs] });
  backend = { state: "present", model: "z-ai/glm-5.3-flash:US" };
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ configured: false }),
  } as Response);
  PgAssistant.disconnect();
  PgAssistant.connect(anthropic);
  PgAssistant.addUserMessage("keep me");
});

afterEach(() => {
  vi.unstubAllGlobals();
  // A dialog a test opened would otherwise show in the next test's host
  act(() => {
    while (PgView.getOpenModals().length) PgView.closeTopModal();
  });
  PgAssistant.disconnect();
  PgSession.reset();
  resetTelemetry();
  resetLogger();
  vi.restoreAllMocks();
});

describe("AssistantComposer, connected", () => {
  it("tunes to another model of the connected backend and keeps the thread", async () => {
    render(<Harness />);
    const user = await openMenu(/Opus 5.5/);
    await user.click(screen.getByRole("menuitemradio", { name: /Sonnet 5.5/ }));

    expect(PgAssistant.items.length).toBe(1);
    expect(PgAssistant.connection?.settings?.model).toBe("claude-sonnet-5-5");
    expect(tracked()).toEqual([
      ["assistant_model_picked", { provider: "anthropic", via: "menu" }],
    ]);
  });

  it("opens Connect for a model of a backend that is not connected", async () => {
    const pick = vi.spyOn(PgAssistant, "pickBackend");
    render(<Harness />);
    const user = await openMenu(/Opus 5.5/);
    const other = screen
      .getAllByRole("menuitemradio")
      .find((item) => /Gemini/.test(item.textContent ?? ""));
    expect(other).toBeTruthy();
    await user.click(other!);

    expect(pick).toHaveBeenCalledTimes(1);
    expect(tracked()).toEqual([["assistant_connect_opened", { via: "model" }]]);
    expect(PgAssistant.connection).toEqual(anthropic);
    expect(PgAssistant.items.length).toBe(1);
  });

  it("opens Connect a model on the backend of the model picked", async () => {
    vi.stubGlobal("ResizeObserver", NoopResizeObserver);
    render(
      <ThemeProvider theme={anyTheme}>
        <ModalHost />
        <Harness />
      </ThemeProvider>
    );
    const user = await openMenu(/Opus 5.5/);
    const other = screen
      .getAllByRole("menuitemradio")
      .find((item) => /Gemini/.test(item.textContent ?? ""));
    await user.click(other!);

    const dialog = await screen.findByRole("dialog", {
      name: "Connect a model",
    });
    const gemini = within(dialog).getByRole("radio", { name: /Gemini/ });
    expect(gemini.getAttribute("aria-checked")).toBe("true");
    await act(async () => PgView.closeTopModal());
  });

  it("connects the default from a keyed backend and clears the thread", async () => {
    await PgSession.refreshWith({
      id: "u1",
      name: null,
      image: null,
      login: null,
    });
    render(<Harness />);
    const user = await openMenu(/Opus 5.5/);
    await user.click(
      screen.getByRole("menuitemradio", { name: /GLM 5.3 Flash/ })
    );

    expect(PgAssistant.connection?.id).toBe("default");
    expect(PgAssistant.items.length).toBe(0);
    expect(tracked()).toEqual([
      ["assistant_model_picked", { provider: "default", via: "menu" }],
    ]);
  });

  it("opens Connect a model on the default instead of connecting it, signed out", async () => {
    await PgSession.refreshWith(null);
    const open = vi.spyOn(PgView, "setModal");
    render(<Harness />);
    const user = await openMenu(/Opus 5.5/);
    await user.click(
      screen.getByRole("menuitemradio", { name: /GLM 5.3 Flash/ })
    );

    expect(PgAssistant.connection?.id).toBe("anthropic");
    expect(PgAssistant.items.length).toBe(1);
    expect(open).toHaveBeenCalledWith(expect.anything(), {
      preset: { provider: "default" },
    });
    expect(tracked()).toEqual([["assistant_connect_opened", { via: "model" }]]);
  });

  it("tracks nothing when the effort picked is the one set", async () => {
    render(<Harness />);
    const user = await openMenu(/Medium/);
    await user.click(screen.getByRole("menuitemradio", { name: "Medium" }));

    expect(tracked()).toEqual([]);
    expect(PgAssistant.connection).toEqual(anthropic);
  });

  it("tunes to another effort and tracks it", async () => {
    render(<Harness />);
    const user = await openMenu(/Medium/);
    await user.click(screen.getByRole("menuitemradio", { name: "High" }));

    expect(PgAssistant.connection?.settings).toEqual({
      model: "claude-opus-5-5",
      effort: "high",
    });
    expect(tracked()).toEqual([
      ["assistant_effort_changed", { effort: "high" }],
    ]);
  });

  it("reports a tune the store refuses and tracks nothing", async () => {
    vi.spyOn(PgAssistant, "canTune").mockReturnValue(false);
    const tune = vi.spyOn(PgAssistant, "tune");
    render(<Harness />);
    const user = await openMenu(/Medium/);
    await user.click(screen.getByRole("menuitemradio", { name: "High" }));

    expect(tune).not.toHaveBeenCalled();
    expect(tracked()).toEqual([]);
    expect(logs.entries.map((e) => [e.ns, e.level, e.report])).toEqual([
      ["assistant:composer", "error", true],
    ]);
  });

  it("tracks a tune that went through, even when a listener then throws", async () => {
    // The change is made; what throws is something reacting to it, which is
    // not a refusal
    vi.spyOn(PgAssistant, "tune").mockImplementation(() => {
      throw new Error("a listener broke");
    });
    const swallow = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener("error", swallow);
    try {
      render(<Harness />);
      const user = await openMenu(/Medium/);
      await user.click(screen.getByRole("menuitemradio", { name: "High" }));
    } finally {
      window.removeEventListener("error", swallow);
    }

    expect(tracked()).toEqual([
      ["assistant_effort_changed", { effort: "high" }],
    ]);
    expect(logs.entries.filter((e) => e.ns === "assistant:composer")).toEqual(
      []
    );
  });
});

describe("AssistantComposer, re-picking and busy", () => {
  it("sends nothing for a re-pick of the connected model", async () => {
    const tune = vi.spyOn(PgAssistant, "tune");
    render(<Harness />);
    const user = await openMenu(/Opus 5.5/);
    await user.click(screen.getByRole("menuitemradio", { name: /Opus 5.5/ }));

    expect(tune).not.toHaveBeenCalled();
    expect(tracked()).toEqual([]);
    expect(PgAssistant.connection).toEqual(anthropic);
  });

  it("sends nothing for a re-pick of the connected default", async () => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    const connect = vi.spyOn(PgAssistant, "connect");
    render(<Harness />);
    const user = await openMenu(/GLM 5.3 Flash/);
    await user.click(
      screen.getByRole("menuitemradio", { name: /GLM 5.3 Flash/ })
    );

    expect(connect).not.toHaveBeenCalled();
    expect(tracked()).toEqual([]);
  });

  it("disables the model and effort menus during a turn", () => {
    render(<Harness />);
    act(() => PgAssistant.setStatus("running"));

    expect(
      screen.getByRole("button", { name: /Opus 5.5/ }).hasAttribute("disabled")
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: /Medium/ }).hasAttribute("disabled")
    ).toBe(true);
    expect(
      screen
        .getByRole("textbox", { name: "Message the assistant" })
        .getAttribute("placeholder")
    ).toBe("Working…");
    act(() => PgAssistant.setStatus("idle"));
  });
});

describe("AssistantComposer, nothing connected", () => {
  const typeIn = async () => {
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: "Message the assistant" }),
      "hello"
    );
  };
  /** Send refuses a message, natively or by `aria-disabled` */
  const sendBlocked = () => {
    const send = screen.getByRole("button", { name: "Send" });
    return (
      send.hasAttribute("disabled") ||
      send.getAttribute("aria-disabled") === "true"
    );
  };

  it("disables Send where the deployment serves no default", async () => {
    PgAssistant.disconnect();
    backend = { state: "absent" };
    render(<Harness />);
    await typeIn();
    expect(sendBlocked()).toBe(true);
  });

  it.each([
    ["could not be reached, so a send asks again", { state: "unreachable" }],
    ["is still being asked about", { state: "checking" }],
    ["is served, for a signed-out user", { state: "present", model: null }],
  ] as const)(
    "keeps Send where the default %s",
    async (_, answer: DefaultBackend) => {
      PgAssistant.disconnect();
      backend = answer;
      render(<Harness />);
      await typeIn();
      expect(sendBlocked()).toBe(false);
    }
  );

  it("enables Send once a backend is connected", async () => {
    PgAssistant.disconnect();
    backend = { state: "absent" };
    render(<Harness />);
    await typeIn();
    act(() => PgAssistant.connect(anthropic));
    expect(sendBlocked()).toBe(false);
  });

  it("says a requested prompt is waiting, in an info callout", async () => {
    PgAssistant.disconnect();
    render(<Harness />);

    act(() => PgAssistant.requestPrompt("Explain this error"));

    const hint = await screen.findByRole("status");
    expect(hint.getAttribute("data-slot")).toBe("callout");
    expect(hint.getAttribute("data-variant")).toBe("info");
    expect(hint.textContent).toBe(
      "Connect a backend, or sign in for the default one, to send this to the assistant. Your prompt is waiting in the composer."
    );
  });

  it("names no sign-in in the waiting notice where there is no default", async () => {
    PgAssistant.disconnect();
    backend = { state: "absent" };
    render(<Harness />);

    act(() => PgAssistant.requestPrompt("Explain this error"));

    expect((await screen.findByRole("status")).textContent).toBe(
      "Connect a model to send this to the assistant. Your prompt is waiting in the composer."
    );
  });
});
