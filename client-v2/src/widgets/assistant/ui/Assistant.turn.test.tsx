import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shared/ui/tooltip";
import { PgAssistant } from "../../../views/sidebar/assistant/store";
import type { Turn } from "../model/use-turn";

// Beside `Assistant.test.tsx`, which stands in for the turn: here the real
// `useTurn` runs, so what is under test is that the panel holds it above
// both views. The thread and Sources stand in by name; the composer is its
// Base, fed by the turn, with no chips or model of its own.
vi.mock("./Thread", () => ({
  Thread: () => <div>thread</div>,
}));
vi.mock("../../../views/sidebar/assistant/Component/Grounding", () => ({
  default: () => <div>sources</div>,
}));
vi.mock("../../../components/Link", () => ({ default: () => null }));
vi.mock("./AssistantComposer", async () => {
  const { BaseAssistantComposer } = await import("./BaseAssistantComposer");
  return {
    AssistantComposer: ({
      turn,
      onSources,
      focusPicked,
    }: {
      turn: Turn;
      onSources(): void;
      focusPicked(): boolean;
    }) => (
      <BaseAssistantComposer
        chips={[]}
        value={turn.input}
        onValueChange={turn.setInput}
        onSend={(text) => void turn.send(text)}
        onStop={turn.stop}
        busy={turn.busy}
        placeholder="Ask"
        model={null}
        effort={null}
        focusRequest={turn.focusRequest}
        onSources={onSources}
        onConnect={() => turn.openConnect("add")}
        connectLabel="Connect a model…"
        focusPicked={focusPicked}
      />
    ),
  };
});
// The real providers stream from the network; no turn runs here
vi.mock("../../../views/sidebar/assistant/model", () => ({
  createProvider: vi.fn(),
}));
// A turn's end reaches the explorer and the account
vi.mock("../../../effects/chat-thread/push-thread", () => ({
  pushThread: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../../utils/explorer/explorer", () => ({
  PgExplorer: {
    currentWorkspaceName: "hello-anchor",
    onDidInit: () => ({ dispose: () => {} }),
    onDidSwitchWorkspace: () => ({ dispose: () => {} }),
    onDidRenameWorkspace: () => ({ dispose: () => {} }),
  },
}));
// No tutorial on screen: the panel is named after the project
vi.mock("@/entities/tutorial", () => ({ useTutorialBeforeStart: () => null }));

import { resetDefaultBackendProbe } from "../model/default-backend";
import { Assistant } from "./Assistant";

beforeEach(() => {
  resetDefaultBackendProbe();
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ configured: false, model: null }),
  } as Response);
  vi.spyOn(PgAssistant, "initMcp").mockResolvedValue(undefined);
  PgAssistant.disconnect();
});

afterEach(() => {
  // The panel is still mounted here: RTL's own cleanup runs after this hook
  act(() => PgAssistant.disconnect());
  vi.restoreAllMocks();
});

describe("Assistant's turn", () => {
  it("outlives a visit to Sources: the composer comes back with what was typed", async () => {
    render(
      <TooltipProvider>
        <Assistant
          widen={{ wide: false, setWide: vi.fn(), canWiden: true }}
          onHide={vi.fn()}
          openConnect={vi.fn()}
        />
      </TooltipProvider>
    );
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: "Message the assistant" }),
      "half a question"
    );

    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(
      screen.getByRole("menuitem", { name: /Sources and tools/ })
    );
    expect(screen.getByText("sources")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(
      screen.getByRole<HTMLInputElement>("textbox", {
        name: "Message the assistant",
      }).value
    ).toBe("half a question");
  });

  it("opens Connect a model through the opener the app hands in", async () => {
    const openConnect = vi.fn();
    render(
      <TooltipProvider>
        <Assistant
          widen={{ wide: false, setWide: vi.fn(), canWiden: true }}
          onHide={vi.fn()}
          openConnect={openConnect}
        />
      </TooltipProvider>
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(screen.getByRole("menuitem", { name: /Connect a model/ }));

    expect(openConnect).toHaveBeenCalledWith("menu", undefined);
  });

  const renderPanel = () =>
    render(
      <TooltipProvider>
        <Assistant
          widen={{ wide: false, setWide: vi.fn(), canWiden: true }}
          onHide={vi.fn()}
          openConnect={vi.fn()}
        />
      </TooltipProvider>
    );
  const composer = () =>
    screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Message the assistant",
    });

  it("puts focus in the composer when a prompt is placed in it", async () => {
    renderPanel();
    expect(document.activeElement).not.toBe(composer());

    await act(async () => {
      PgAssistant.requestPrompt("Explain this error", { send: false });
    });

    await waitFor(() => expect(document.activeElement).toBe(composer()));
    expect(composer().value).toBe("Explain this error");
  });

  it("leaves Sources for a placed prompt and puts focus in the composer", async () => {
    renderPanel();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(
      screen.getByRole("menuitem", { name: /Sources and tools/ })
    );
    expect(screen.getByText("sources")).toBeTruthy();

    await act(async () => {
      PgAssistant.requestPrompt("Explain this error", { send: false });
    });

    await waitFor(() => expect(document.activeElement).toBe(composer()));
    expect(composer().value).toBe("Explain this error");
  });

  it("opens Sources and tools from the composer's +, with focus on Back", async () => {
    renderPanel();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add context" }));
    await user.keyboard("s");

    expect(screen.getByText("sources")).toBeTruthy();
    const back = screen.getByRole("button", { name: "Back" });
    await waitFor(() => expect(document.activeElement).toBe(back));
  });

  it("names More's connect entry by whether a model is connected", async () => {
    PgAssistant.connect({
      id: "anthropic",
      apiKey: "sk-ant-fake",
      settings: { model: "claude-opus-5-5", effort: "medium" },
    });
    renderPanel();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "More" }));
    expect(
      screen.getByRole("menuitem", { name: /Connection and key…/ })
    ).toBeTruthy();
  });
});
