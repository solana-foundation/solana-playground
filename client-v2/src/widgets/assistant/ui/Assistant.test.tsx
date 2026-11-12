import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PgSession } from "@/features/auth";
import {
  initTelemetry,
  memoryProvider as memoryTelemetry,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import { TooltipProvider } from "@/shared/ui/tooltip";

import { PgAssistant } from "../../../views/sidebar/assistant/store";
import type { DefaultBackend } from "../model/default-backend";

// The thread, Sources and the composer stand in by name: what is under test
// is which of them the panel shows, not what they draw.
vi.mock("./Thread", () => ({
  Thread: ({ project }: { project: string | null }) => (
    <div data-project={project ?? "none"}>thread</div>
  ),
}));
// Connect a model's footer link reaches the utils barrel, which needs the
// build's globals; the panel's dialog here is a stand-in
vi.mock("../../../components/Link", () => ({ default: () => null }));
vi.mock("../../../views/sidebar/assistant/Component/Grounding", () => ({
  default: () => <div>sources</div>,
}));
vi.mock("./AssistantComposer", () => ({
  AssistantComposer: () => <div>composer</div>,
}));
// Connect a model is a dialog, which takes focus as it opens; `dialog.shows`
// is off for one that never appears
const dialog = vi.hoisted(() => ({ shows: true }));
const turn = vi.hoisted(() => ({ busy: false, openConnect: vi.fn() }));
vi.mock("../model/use-turn", () => ({ useTurn: () => turn }));
// What the deployment serves, as the head names it
const deployment = vi.hoisted(() => ({
  backend: { state: "absent" } as DefaultBackend,
}));
vi.mock("../model/default-backend", () => ({
  useDefaultBackend: () => deployment.backend,
}));

// The explorer's workspace, with the events the thread follows
const explorer = vi.hoisted(() => ({
  name: "hello-anchor" as string | undefined,
  listeners: new Set<() => void>(),
}));
vi.mock("../../../utils/explorer/explorer", () => {
  const on = (cb: () => void) => {
    explorer.listeners.add(cb);
    return { dispose: () => explorer.listeners.delete(cb) };
  };
  return {
    PgExplorer: {
      get currentWorkspaceName() {
        return explorer.name;
      },
      onDidInit: on,
      onDidSwitchWorkspace: on,
      onDidRenameWorkspace: on,
    },
  };
});

// The tutorial on screen before its Start, which names the panel over the
// project; null off a tutorial's route
const tutorial = vi.hoisted(() => ({ beforeStart: null as string | null }));
vi.mock("@/entities/tutorial", () => ({
  useTutorialBeforeStart: () => tutorial.beforeStart,
}));

import { Modal, ModalContent, ModalTitle } from "@/shared/ui/modal";

import { Assistant } from "./Assistant";

/** Opens or closes `FakeConnect`, once it has mounted */
let showConnect: (show: boolean) => void = () => {};

/**
 * Stands in for Connect a model: a dialog with a field. The real one is
 * `ModalHost`'s, from `widgets/overlays`, which a widget may not import.
 */
const FakeConnect = () => {
  const [open, setOpen] = useState(false);
  showConnect = setOpen;
  return (
    <Modal open={open} onOpenChange={setOpen}>
      <ModalContent aria-describedby={undefined}>
        <ModalTitle>Connect a model</ModalTitle>
        <input aria-label="Dialog field" />
      </ModalContent>
    </Modal>
  );
};

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  explorer.name = "hello-anchor";
  tutorial.beforeStart = null;
  explorer.listeners.clear();
  deployment.backend = { state: "absent" };
  turn.openConnect.mockReset();
  turn.openConnect.mockImplementation(() => {
    if (dialog.shows) showConnect(true);
  });
  turn.busy = false;
  dialog.shows = true;
  PgAssistant.disconnect();
  vi.spyOn(PgAssistant, "initMcp").mockResolvedValue(undefined);
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
});
afterEach(() => {
  showConnect = () => {};
  PgAssistant.disconnect();
  PgSession.reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const mount = (inSheet: boolean) => {
  const setWide = vi.fn();
  const onHide = vi.fn();
  // The app's one `TooltipProvider` sits in `App`
  render(
    <TooltipProvider>
      <FakeConnect />
      <Assistant
        widen={{ wide: false, setWide, canWiden: !inSheet, inSheet }}
        onHide={onHide}
        openConnect={turn.openConnect}
      />
    </TooltipProvider>
  );
  return { setWide, onHide, user: userEvent.setup() };
};

/** The assistant in the wide frame's column at the left */
const setup = () => mount(false);
/** The assistant as the right Sheet (under Home, or 768 to 1023 px) */
const setupInSheet = () => mount(true);

const openSources = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "More" }));
  await user.click(screen.getByRole("menuitem", { name: /Sources and tools/ }));
};

describe("Assistant", () => {
  it("shows the thread over the composer, under Assistant with no model", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Assistant" })).toBeTruthy();
    expect(screen.getByText("thread")).toBeTruthy();
    expect(screen.getByText("composer")).toBeTruthy();
  });

  it("points Collapse right in the Sheet and left in the column", () => {
    const collapseIcon = () =>
      screen
        .getByRole("button", { name: "Collapse assistant" })
        .querySelector("svg")
        ?.getAttribute("class");
    setupInSheet();
    expect(collapseIcon()).toContain("lucide-panel-right-close");
    cleanup();
    setup();
    expect(collapseIcon()).toContain("lucide-panel-left-close");
  });

  it("says Off in the head where the deployment serves no model", () => {
    deployment.backend = { state: "absent" };
    setup();
    expect(document.getElementById("assistant-status")?.textContent).toBe(
      "Off"
    );
  });

  it("says Off to a signed-out user, and clears it once they sign in", async () => {
    deployment.backend = { state: "present", model: "m" };
    await PgSession.refreshWith(undefined);
    setup();
    await waitFor(() =>
      expect(document.getElementById("assistant-status")?.textContent).toBe(
        "Off"
      )
    );
    await act(() =>
      PgSession.refreshWith({
        id: "u1",
        name: undefined,
        image: undefined,
        login: undefined,
      })
    );
    expect(document.getElementById("assistant-status")).toBeNull();
  });

  it("says Not responding where the deployment's answer could not be read", () => {
    deployment.backend = { state: "unreachable" };
    setup();
    expect(document.getElementById("assistant-status")?.textContent).toBe(
      "Not responding"
    );
  });

  it("shows no status in the head while a key-based backend is connected", () => {
    deployment.backend = { state: "absent" };
    PgAssistant.connect({ id: "anthropic", apiKey: "sk-ant-fake" });
    setup();
    expect(document.getElementById("assistant-status")).toBeNull();
  });

  it("tells the thread there is no project before one opens", () => {
    explorer.name = undefined;
    setup();
    expect(screen.getByText("thread").dataset.project).toBe("none");
  });

  it("hands the thread the project's own name", () => {
    setup();
    expect(screen.getByText("thread").dataset.project).toBe("hello-anchor");
  });

  it("hands the thread a tutorial not yet started while no project is open", () => {
    explorer.name = undefined;
    tutorial.beforeStart = "Hello Anchor";
    setup();
    expect(screen.getByText("thread").dataset.project).toBe("Hello Anchor");
  });

  it("keeps the thread on the open project beside a tutorial not yet started", () => {
    explorer.name = "Counter";
    tutorial.beforeStart = "Hello Anchor";
    setup();
    expect(screen.getByText("thread").dataset.project).toBe("Counter");
  });

  it("asks the gateway for its tools once, on mount", () => {
    setup();
    expect(PgAssistant.initMcp).toHaveBeenCalledTimes(1);
  });

  it("asks the gateway again when the account changes", async () => {
    setup();
    await act(() =>
      PgSession.refreshWith({
        id: "u1",
        name: undefined,
        image: undefined,
        login: undefined,
      })
    );
    expect(PgAssistant.initMcp).toHaveBeenCalledTimes(2);
  });

  it("names the hosted model in the head, not the project", () => {
    deployment.backend = { state: "present", model: "z-ai/glm-5.3-flash:US" };
    setup();
    expect(
      screen.getByRole("heading", {
        name: "Assistant · GLM 5.3 Flash · hosted",
      })
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /hello-anchor/ })).toBeNull();
  });

  it("names a keyed model with whose key it runs on", () => {
    PgAssistant.connect({
      id: "openrouter",
      apiKey: "sk-or-fake",
      endpoint: {
        baseUrl: "https://openrouter.ai/api/v1",
        model: "deepseek/deepseek-chat-v3.1:free",
      },
    });
    setup();
    expect(
      screen.getByRole("heading", {
        name: "deepseek/deepseek-chat-v3.1:free · your OpenRouter key",
      })
    ).toBeTruthy();
  });

  it("follows the model connected after it opens", () => {
    setup();
    act(() =>
      PgAssistant.connect({
        id: "anthropic",
        apiKey: "sk-ant-fake",
        settings: { model: "claude-sonnet-5-5", effort: "medium" },
      })
    );
    expect(
      screen.getByRole("heading", { name: "Sonnet 5.5 · your Anthropic key" })
    ).toBeTruthy();
  });

  it("hands the thread a switch or a rename of the project", () => {
    setup();
    explorer.name = "renamed";
    act(() => explorer.listeners.forEach((cb) => cb()));
    expect(screen.getByText("thread").dataset.project).toBe("renamed");
  });

  it("puts Sources and tools in place of the thread and composer, and comes back", async () => {
    const { user } = setup();
    await openSources(user);
    expect(screen.getByText("sources")).toBeTruthy();
    expect(screen.queryByText("thread")).toBeNull();
    expect(screen.queryByText("composer")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("thread")).toBeTruthy();
    expect(screen.queryByText("sources")).toBeNull();
  });

  it("goes back to the chat when a prompt is requested from Sources", async () => {
    const { user } = setup();
    await openSources(user);
    act(() => PgAssistant.requestPrompt("fix this"));
    expect(screen.getByText("composer")).toBeTruthy();
    expect(screen.queryByText("sources")).toBeNull();
  });

  it("opens Connect a model from More as the menu's", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(screen.getByRole("menuitem", { name: /Connect a model/ }));
    expect(turn.openConnect).toHaveBeenCalledWith("menu");
  });

  it("puts focus on Back when Sources and tools is picked from the keyboard", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.keyboard("s");
    const back = screen.getByRole("button", { name: "Back" });
    await waitFor(() => expect(document.activeElement).toBe(back));
  });

  it("leaves focus in Connect a model when it is picked", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.keyboard("k");
    expect(turn.openConnect).toHaveBeenCalledWith("menu");
    const field = screen.getByRole("textbox", { name: "Dialog field" });
    await waitFor(() => expect(document.activeElement).toBe(field));
  });

  it("opens Connect a model over Sources, which stays", async () => {
    const { user } = setup();
    await openSources(user);
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.keyboard("k");
    expect(turn.openConnect).toHaveBeenCalledWith("menu");
    expect(screen.getByText("sources")).toBeTruthy();
  });

  it("gives focus back to More when the picked view has nothing to focus", async () => {
    dialog.shows = false;
    const { user } = setup();
    const more = screen.getByRole("button", { name: "More" });
    await user.click(more);
    await user.keyboard("k");
    await waitFor(() => expect(document.activeElement).toBe(more));
  });

  it("offers Delete my key while a key is held, and forgets it", async () => {
    PgAssistant.connect({
      id: "anthropic",
      apiKey: "sk-ant-fake",
      settings: { model: "claude-opus-5-5", effort: "medium" },
    });
    const events = memoryTelemetry();
    initTelemetry({ providers: [events] });
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete my key" }));
    expect(PgAssistant.connection).toBeNull();
    expect(sessionStorage.getItem("assistant.connection")).toBeNull();
    expect(events.events.map((e) => [e.name, e.params])).toContainEqual([
      "assistant_key_deleted",
      { via: "assistant" },
    ]);
    resetTelemetry();
  });

  it("keeps Delete my key disabled during a turn", async () => {
    PgAssistant.connect({ id: "anthropic", apiKey: "sk-ant-fake" });
    // What `useTurn`, stubbed here, reports while its turn is busy
    PgAssistant.markTurnBusy(true);
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "More" }));
    expect(
      screen
        .getByRole("menuitem", { name: "Delete my key" })
        .getAttribute("aria-disabled")
    ).toBe("true");
    PgAssistant.markTurnBusy(false);
  });

  it("offers no Delete my key for the keyless default", async () => {
    PgAssistant.connect({ id: "default", apiKey: "" });
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "More" }));
    expect(
      screen.queryByRole("menuitem", { name: "Delete my key" })
    ).toBeNull();
  });

  it("widens through the shell, and hides through it", async () => {
    const { user, setWide, onHide } = setup();
    await user.click(
      screen.getByRole("button", { name: "Widen the assistant" })
    );
    expect(setWide).toHaveBeenCalledWith(true);
    await user.click(
      screen.getByRole("button", { name: "Collapse assistant" })
    );
    expect(onHide).toHaveBeenCalledTimes(1);
  });
});
