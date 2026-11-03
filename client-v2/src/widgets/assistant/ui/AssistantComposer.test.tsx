import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PgSession } from "@/features/auth";
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
import { TooltipProvider } from "@/shared/ui/tooltip";
import { requireFor } from "@/test-utils/require-for";

import type { Connection } from "../../../views/sidebar/assistant/store";
import { PgAssistant } from "../../../views/sidebar/assistant/store";
import type { DefaultBackend } from "../model/default-backend";
import { useTurn } from "../model/use-turn";
import { AssistantComposer } from "./AssistantComposer";

// The probe is the deployment's; a test says what it answered
let backend: DefaultBackend;
vi.mock("../model/default-backend", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../model/default-backend")
  >();
  return {
    probeDefaultBackend: original.probeDefaultBackend,
    resetDefaultBackendProbe: original.resetDefaultBackendProbe,
    retryDefaultBackend: vi.fn(() => Promise.resolve(backend)),
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
const { noEvent } = vi.hoisted(() => ({
  noEvent: () => ({ dispose: () => {} }),
}));
vi.mock("../../../utils/explorer/explorer", () => ({
  PgExplorer: {
    currentFilePath: "src/lib.rs",
    // Each test gets its own, so one test's context choice is not another's
    currentWorkspaceId: "w0",
    getItemNameFromPath: (path: string) => path.split("/").pop(),
    onDidSetTabs: noEvent,
    onDidCreateItem: noEvent,
    onDidDeleteItem: noEvent,
    onDidRenameItem: noEvent,
    onDidSwitchWorkspace: noEvent,
  },
}));
vi.mock("../../../utils/program-info", () => ({
  PgProgramInfo: { idl: null },
}));
// The bridge's context from the real store, over a fixed project
const FILES = ["src/lib.rs", "tests/anchor.test.ts", "secret/other.rs"];
vi.mock(
  "../../../views/sidebar/assistant/bridge/playground-bridge",
  async () => {
    const { contextPathsWith, PgAssistantContext } = await import(
      "@/entities/assistant-context"
    );
    const { PgExplorer } = await import("../../../utils/explorer/explorer");
    return {
      realBridge: {
        listFiles: () => FILES,
        listOpenFiles: () => ["src/lib.rs"],
        listContextFiles: () =>
          contextPathsWith((path) => FILES.includes(path))(
            ["src/lib.rs"],
            PgAssistantContext.choice(PgExplorer.currentWorkspaceId)
          ),
      },
    };
  }
);
vi.mock("../../../views/sidebar/assistant/bridge/build-output", () => ({
  PgBuildOutput: { latest: null },
}));
vi.mock("../../../views/flow/lessons", () => ({
  INITIAL_LESSON_STATE: { path: null, record: [] },
  PgLesson: { onDidChange: () => ({ dispose: () => {} }) },
}));

let events: ReturnType<typeof memoryTelemetry>;
let logs: ReturnType<typeof memoryLog>;

const anthropic: Connection = {
  id: "anthropic",
  apiKey: "sk-ant-fake",
  settings: { model: "claude-opus-5-5", effort: "medium" },
};

/**
 * Stands in for Connect a model, which the app hands the panel: what the
 * dialog opens on is `ConnectDialog`'s to test
 */
const openConnect = vi.fn();
const openSources = vi.fn();

/** The composer with the turn held by its parent, as the widget holds it */
function Harness() {
  const turn = useTurn({ open: openConnect });
  return (
    <TooltipProvider>
      <AssistantComposer
        turn={turn}
        onSources={openSources}
        focusPicked={() => false}
      />
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
    // `GET /api/ai/status` for a deployment with no hosted key; the session
    // read finds no user in it
    json: async () => ({
      available: false,
      key: "own",
      /* eslint-disable unicorn/no-null -- a `GET /api/ai/status` body: `null` is on the wire */
      reason: null,
      model: null,
      /* eslint-enable unicorn/no-null */
    }),
  } as Response);
  PgAssistant.disconnect();
  PgAssistant.connect(anthropic);
  PgAssistant.addUserMessage("keep me");
});

afterEach(() => {
  vi.unstubAllGlobals();
  openConnect.mockReset();
  openSources.mockReset();
  // The harness is still mounted here: RTL's own cleanup runs after this hook
  act(() => PgAssistant.disconnect());
  PgSession.reset();
  resetTelemetry();
  resetLogger();
  vi.restoreAllMocks();
});

/**
 * Opens + › Add a file from the keyboard, as the submenu's own focus: jsdom
 * has no pointer geometry for Radix's grace area, so a click into the
 * submenu closes it first
 */
const openAddFile = async (user: ReturnType<typeof userEvent.setup>) => {
  screen.getByRole("menuitem", { name: "Add a file" }).focus();
  await user.keyboard("{ArrowRight}");
};

/** Picks a file in the open Add a file submenu */
const pickFile = async (
  user: ReturnType<typeof userEvent.setup>,
  path: string
) => {
  screen.getByRole("menuitem", { name: path }).focus();
  await user.keyboard("{Enter}");
};

// A fresh workspace per test: the context store outlives a render
let workspaces = 0;
beforeEach(async () => {
  const { PgExplorer } = await import("../../../utils/explorer/explorer");
  (
    PgExplorer as { currentWorkspaceId: string }
  ).currentWorkspaceId = `w${++workspaces}`;
});

describe("AssistantComposer, context chips", () => {
  // Removing a chip focuses it first, and its tooltip watches its size
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });

  it("names a chip per file in the context, and none for the rest of the project", () => {
    render(<Harness />);
    expect(
      screen.getByText("Sent with this message: lib.rs, in full")
    ).toBeTruthy();
    expect(screen.queryByText(/the paths? of/)).toBeNull();
    expect(screen.queryByText("other.rs")).toBeNull();
  });

  it("keeps a removed file out until it is added back, and reports it", async () => {
    const send = vi.fn(() => Promise.resolve());
    vi.spyOn(
      await import("../../../views/sidebar/assistant/model"),
      "createProvider"
    ).mockReturnValue({ id: "anthropic", label: "stub", send });
    render(<Harness />);
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "Remove lib.rs from the context" })
    );
    expect(screen.queryByText("lib.rs")).toBeNull();
    expect(tracked()).toContainEqual(["assistant_file_chip_removed", {}]);

    await user.type(
      screen.getByRole("textbox", { name: "Message the assistant" }),
      "hi{Enter}"
    );
    // The send starts after the default backend's probe; slow under load
    await waitFor(() => expect(send).toHaveBeenCalled(), { timeout: 5_000 });
    // Not "the next message only": the chip stays gone after the send
    expect(screen.queryByText("lib.rs")).toBeNull();
  });

  it("adds a file from + › Add a file, and reports it", async () => {
    render(<Harness />);
    const user = await openMenu(/Add context/);

    await openAddFile(user);
    await pickFile(user, "tests/anchor.test.ts");

    expect(
      await screen.findByText("Sent with this message: anchor.test.ts, in full")
    ).toBeTruthy();
    expect(tracked()).toContainEqual([
      "assistant_context_file_added",
      { via: "menu" },
    ]);
  });

  it("offers a removed tab under Add a file, and brings its chip back", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Remove lib.rs from the context" })
    );

    await user.click(screen.getByRole("button", { name: /Add context/ }));
    await openAddFile(user);
    await pickFile(user, "src/lib.rs");

    expect(
      await screen.findByText("Sent with this message: lib.rs, in full")
    ).toBeTruthy();
  });
});

describe("AssistantComposer, the + menu", () => {
  it("opens Sources and tools", async () => {
    render(<Harness />);
    const user = await openMenu(/Add context/);
    await user.click(
      screen.getByRole("menuitem", { name: /Sources and tools/ })
    );
    expect(openSources).toHaveBeenCalledTimes(1);
  });

  it("offers Connection and key… once connected, and opens Connect from +", async () => {
    render(<Harness />);
    const user = await openMenu(/Add context/);
    await user.click(
      screen.getByRole("menuitem", { name: /Connection and key…/ })
    );
    expect(openConnect).toHaveBeenCalledWith("add", undefined);
  });

  it("offers Connect a model… with nothing connected", async () => {
    PgAssistant.disconnect();
    render(<Harness />);
    await openMenu(/Add context/);
    expect(
      screen.getByRole("menuitem", { name: /Connect a model…/ })
    ).toBeTruthy();
  });
});

describe("AssistantComposer, chip order", () => {
  it("names the files in tab order, then the added ones", async () => {
    render(<Harness />);
    const user = await openMenu(/Add context/);
    await openAddFile(user);
    await pickFile(user, "tests/anchor.test.ts");
    // Each chip is its tooltip's trigger, which takes over its data-slot
    const chips = Array.from(
      document.querySelectorAll('[data-slot="composer-context"] > *')
    ).map(
      // The short label; the chip also carries its spoken name for a reader
      (chip) => chip.querySelector('[aria-hidden="true"]')?.textContent
    );
    expect(chips).toEqual(["lib.rs", "anchor.test.ts"]);
  });
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

  it("opens Connect a model on the backend of the model picked, not connected", async () => {
    render(<Harness />);
    const user = await openMenu(/Opus 5.5/);
    const other = screen
      .getAllByRole("menuitemradio")
      .find((item) => /Gemini/.test(item.textContent ?? ""));
    await user.click(requireFor("the Gemini menu item")(other));

    expect(openConnect).toHaveBeenCalledTimes(1);
    expect(openConnect).toHaveBeenCalledWith("model", {
      provider: "gemini",
      model: "gemini-3.6-flash",
    });
    expect(tracked()).toEqual([]);
    expect(PgAssistant.connection).toEqual(anthropic);
    expect(PgAssistant.items.length).toBe(1);
  });

  it("connects the default from a keyed backend and keeps the thread", async () => {
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
    expect(PgAssistant.items.length).toBe(1);
    expect(tracked()).toEqual([
      ["assistant_model_picked", { provider: "default", via: "menu" }],
    ]);
  });

  it("opens Connect a model on the default instead of connecting it, signed out", async () => {
    await PgSession.refreshWith(null);
    render(<Harness />);
    const user = await openMenu(/Opus 5.5/);
    await user.click(
      screen.getByRole("menuitemradio", { name: /GLM 5.3 Flash/ })
    );

    expect(PgAssistant.connection?.id).toBe("anthropic");
    expect(PgAssistant.items.length).toBe(1);
    expect(openConnect).toHaveBeenCalledWith("model", { provider: "default" });
    expect(tracked()).toEqual([]);
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
    // Signed in, so the connected default answers and no off row is reported
    await PgSession.refreshWith({
      id: "u1",
      /* eslint-disable unicorn/no-null -- `SessionUser` types these fields `| null` */
      name: null,
      image: null,
      login: null,
      /* eslint-enable unicorn/no-null */
    });
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

  // With no model, a message waits for one rather than going nowhere
  it("sends nothing on Enter with no model, keeps the text, and offers Connect a model", async () => {
    PgAssistant.disconnect();
    backend = { state: "absent" };
    const add = vi.spyOn(PgAssistant, "addUserMessage");
    render(<Harness />);
    await typeIn();
    await userEvent.setup().keyboard("{Enter}");

    expect(add).not.toHaveBeenCalled();
    expect(
      (
        screen.getByRole("textbox", {
          name: "Message the assistant",
        }) as HTMLTextAreaElement
      ).value
    ).toBe("hello");
    expect(sendBlocked()).toBe(true);
    expect(
      screen.getByRole("button", { name: "Connect a model" })
    ).toBeTruthy();
  });

  it("keeps Send while the default is still being asked about", async () => {
    PgAssistant.disconnect();
    backend = { state: "checking" };
    render(<Harness />);
    await typeIn();
    expect(sendBlocked()).toBe(false);
  });

  it("keeps Send where the default is served to a signed-in user", async () => {
    await PgSession.refreshWith({
      id: "u1",
      /* eslint-disable unicorn/no-null -- `SessionUser` types these fields `| null` */
      name: null,
      image: null,
      login: null,
      /* eslint-enable unicorn/no-null */
    });
    PgAssistant.disconnect();
    // eslint-disable-next-line unicorn/no-null -- `DefaultBackend` types `model` `| null`
    backend = { state: "present", model: null };
    render(<Harness />);
    await typeIn();
    expect(sendBlocked()).toBe(false);
  });

  it.each([
    [
      "the default could not be reached",
      { state: "unreachable" },
      "Can't reach the model",
    ],
    [
      "the default is served to a signed-out user",
      // eslint-disable-next-line unicorn/no-null -- `DefaultBackend` types `model` `| null`
      { state: "present", model: null },
      "Sign in to send",
    ],
  ] as const)(
    "blocks Send, with its reason, where %s",
    // eslint-disable-next-line max-params -- `it.each` spreads each row of the table into the callback
    async (_, answer: DefaultBackend, reason) => {
      // eslint-disable-next-line unicorn/no-null -- `PgSession.refreshWith(null)` is a signed-out session
      await PgSession.refreshWith(null);
      PgAssistant.disconnect();
      backend = answer;
      render(<Harness />);
      await typeIn();
      expect(sendBlocked()).toBe(true);
      expect(screen.getByRole("status").id).toBe("assistant-ai-off");
      expect(document.body.innerHTML).toContain(reason);
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
    // Still being asked about, so nothing says the assistant is off
    backend = { state: "checking" };
    render(<Harness />);

    act(() => PgAssistant.requestPrompt("Explain this error"));

    const hint = await screen.findByRole("status");
    expect(hint.getAttribute("data-slot")).toBe("callout");
    expect(hint.getAttribute("data-variant")).toBe("info");
    expect(hint.textContent).toBe(
      "Connect a backend, or sign in for the default one, to send this to the assistant. Your prompt is waiting in the composer."
    );
  });

  it("folds a waiting prompt into the off row where there is no default", async () => {
    PgAssistant.disconnect();
    backend = { state: "absent" };
    render(<Harness />);

    act(() => PgAssistant.requestPrompt("Explain this error"));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "Your prompt is waiting in the composer."
      )
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").id).toBe("assistant-ai-off");
  });
});

describe("AssistantComposer, the off row", () => {
  const row = () => document.getElementById("assistant-ai-off");
  /** The row, once the page's session read has answered */
  const shownRow = () =>
    waitFor(() => {
      const found = row();
      if (!found) throw new Error("no off row yet");
      return found;
    });

  beforeEach(async () => {
    // eslint-disable-next-line unicorn/no-null -- `PgSession.refreshWith(null)` is a signed-out session
    await PgSession.refreshWith(null);
    PgAssistant.disconnect();
  });

  it("says a deployment with no hosted key needs a key, and Add a key opens Connect a model", async () => {
    backend = { state: "absent" };
    render(<Harness />);
    expect(row()?.getAttribute("role")).toBe("status");
    expect(row()?.textContent).toContain(
      "The assistant needs a key of your own on this deployment."
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Add a key" }));
    expect(openConnect).toHaveBeenCalledWith("ai-off", undefined);
    expect(tracked()).toEqual([
      ["assistant_ai_off_shown", { reason: "no-key" }],
    ]);
  });

  it("offers sign-in or a key to a signed-out user, and signs in from the assistant", async () => {
    backend = { state: "present", model: "m" };
    const signIn = vi.spyOn(PgSession, "signIn").mockResolvedValue(undefined);
    render(<Harness />);
    expect((await shownRow()).textContent).toContain(
      "Sign in with GitHub to use the hosted model, or add a key of your own."
    );
    expect(screen.getByRole("button", { name: "Add a key" })).toBeTruthy();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Sign in with GitHub" }));
    expect(signIn).toHaveBeenCalledWith({ from: "assistant" });
    expect(tracked()).toEqual([
      ["assistant_ai_off_shown", { reason: "signed-out" }],
    ]);
  });

  it("says a failed sign-in in the row", async () => {
    backend = { state: "present", model: "m" };
    vi.spyOn(PgSession, "signIn").mockRejectedValue(new Error("boom"));
    render(<Harness />);
    await shownRow();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Sign in with GitHub" }));
    await waitFor(() =>
      expect(row()?.textContent).toContain("Sign-in failed. Try again.")
    );
  });

  it("goes away once the user signs in", async () => {
    backend = { state: "present", model: "m" };
    render(<Harness />);
    await shownRow();
    await act(() =>
      // eslint-disable-next-line unicorn/no-null -- `SessionUser` types these fields `| null`
      PgSession.refreshWith({ id: "u1", name: null, image: null, login: null })
    );
    expect(row()).toBeNull();
  });

  it("asks again from Try again where the model could not be reached", async () => {
    backend = { state: "unreachable" };
    const { retryDefaultBackend } = await import("../model/default-backend");
    render(<Harness />);
    expect(row()?.textContent).toContain(
      "The assistant can't reach its model. Try again in a minute."
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Try again" }));
    expect(retryDefaultBackend).toHaveBeenCalled();
  });

  it("is reported once per reason however often it draws", () => {
    backend = { state: "absent" };
    const { rerender } = render(<Harness />);
    rerender(<Harness />);
    act(() => PgAssistant.addUserMessage("again"));
    expect(
      tracked().filter(([name]) => name === "assistant_ai_off_shown")
    ).toEqual([["assistant_ai_off_shown", { reason: "no-key" }]]);
  });

  it("does not show while a key-based backend is connected", () => {
    backend = { state: "absent" };
    act(() => PgAssistant.connect(anthropic));
    render(<Harness />);
    expect(row()).toBeNull();
  });

  it("starts no session read of its own: the page's session effect reads it", () => {
    PgSession.reset();
    backend = { state: "present", model: "m" };
    const reads = vi.mocked(globalThis.fetch);
    reads.mockClear();
    render(<Harness />);
    expect(
      reads.mock.calls.filter(([url]) =>
        String(url).includes("/api/auth/get-session")
      )
    ).toEqual([]);
    expect(row()).toBeNull();
  });

  it("does not show while the default is being asked about", () => {
    backend = { state: "checking" };
    render(<Harness />);
    expect(row()).toBeNull();
  });
});
