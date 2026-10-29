import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shared/ui/tooltip";
import { PgAssistant } from "../../../views/sidebar/assistant/store";
import type { Turn } from "../model/use-turn";

// Beside `Assistant.test.tsx`, which stands in for the turn: here the real
// `useTurn` runs, so what is under test is that the panel holds it above
// both views. The thread and Sources stand in by name; the composer only
// shows and edits what is in it.
vi.mock("./Thread", () => ({
  Thread: () => <div>thread</div>,
}));
vi.mock("../../../views/sidebar/assistant/Component/Grounding", () => ({
  default: () => <div>sources</div>,
}));
vi.mock("../../../components/Link", () => ({ default: () => null }));
vi.mock("./AssistantComposer", () => ({
  AssistantComposer: ({ turn }: { turn: Turn }) => (
    <input
      aria-label="Message the assistant"
      value={turn.input}
      onChange={(event) => turn.setInput(event.target.value)}
    />
  ),
}));
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
});
