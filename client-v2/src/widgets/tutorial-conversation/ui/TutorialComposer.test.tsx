/* eslint-disable layers/curry-order, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TutorialDefinition } from "@/entities/tutorial";
import type {
  ConversationState,
  ConversationView,
} from "@/features/tutorial-conversation";

import hello from "../../../tutorials/hello-anchor/tutorial.json";

const definition = hello as unknown as TutorialDefinition;

vi.mock("@/features/tutorial-conversation", () => ({
  PgConversation: {
    state: null,
    view: vi.fn(),
    say: vi.fn(),
    asked: vi.fn(),
    chip: vi.fn(),
    start: vi.fn(),
  },
}));
vi.mock("@/views/sidebar/assistant/store", () => ({
  PgAssistant: { items: [] },
}));
// The connected feed pulls in the explorer and the editor; the composer needs
// only the state it re-renders on
vi.mock("./TutorialConversation", async () => {
  const { PgConversation } = await import("@/features/tutorial-conversation");
  return { useConversationState: () => PgConversation.state };
});

import { PgConversation } from "@/features/tutorial-conversation";
import { PgAssistant } from "@/views/sidebar/assistant/store";

import BaseTutorialComposer from "./BaseTutorialComposer";
import type { ComposerTurn } from "./TutorialComposer";
import { TutorialComposer } from "./TutorialComposer";

const store = PgConversation as unknown as {
  state: ConversationState | null;
  view: ReturnType<typeof vi.fn>;
  say: ReturnType<typeof vi.fn>;
  asked: ReturnType<typeof vi.fn>;
  chip: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
};

const box = () => screen.getByRole("textbox", { name: "Message" });

/** The Base with its value held, as the turn holds it in the app */
const Held = (props: {
  onSend: (text: string) => void;
  chips?: readonly string[] | null;
  onChip?: (i: number) => void;
}) => {
  const [value, setValue] = useState("");
  return (
    <BaseTutorialComposer
      waiting={false}
      value={value}
      onChange={setValue}
      placeholder="Ask about this step"
      busy={false}
      onSend={props.onSend}
      onStop={vi.fn()}
      chips={props.chips ?? null}
      onChip={props.onChip ?? vi.fn()}
    />
  );
};

describe("BaseTutorialComposer", () => {
  it("sends on Enter, and breaks the line on Shift+Enter", async () => {
    const onSend = vi.fn();
    render(<Held onSend={onSend} />);
    await userEvent.type(box(), "what is a PDA?{Shift>}{Enter}{/Shift}why");
    expect(onSend).not.toHaveBeenCalled();
    expect((box() as HTMLTextAreaElement).value).toBe("what is a PDA?\nwhy");
    await userEvent.type(box(), "{Enter}");
    expect(onSend).toHaveBeenCalledWith("what is a PDA?\nwhy");
  });

  it("does nothing on ⌘↵, which presses the live act elsewhere in the column", async () => {
    const onSend = vi.fn();
    render(<Held onSend={onSend} />);
    await userEvent.type(box(), "build");
    fireEvent.keyDown(box(), { key: "Enter", metaKey: true });
    fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows the moment's placeholder and is never disabled", () => {
    render(
      <BaseTutorialComposer
        waiting={false}
        value=""
        onChange={vi.fn()}
        placeholder="Ask while it builds"
        busy={true}
        onSend={vi.fn()}
        onStop={vi.fn()}
        chips={null}
        onChip={vi.fn()}
      />
    );
    expect(box().getAttribute("placeholder")).toBe("Ask while it builds");
    expect((box() as HTMLTextAreaElement).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
  });

  it("routes Enter while the assistant answers, so a word still runs", async () => {
    const onSend = vi.fn();
    render(
      <BaseTutorialComposer
        waiting={false}
        value="build"
        onChange={vi.fn()}
        placeholder="Ask about this step"
        busy={true}
        onSend={onSend}
        onStop={vi.fn()}
        chips={null}
        onChip={vi.fn()}
      />
    );
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("build");
    fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("has no chips during the lesson, and presses one after the finish", async () => {
    const onChip = vi.fn();
    const { rerender } = render(<Held onSend={vi.fn()} onChip={onChip} />);
    expect(screen.queryByRole("group", { name: "Ask next" })).toBeNull();

    const labels = definition.finish.chips.map((c) => c.label);
    rerender(<Held onSend={vi.fn()} chips={labels} onChip={onChip} />);
    await userEvent.click(
      screen.getByRole("button", { name: "What should I build next?" })
    );
    expect(onChip).toHaveBeenCalledWith(1);
  });
});

describe("TutorialComposer", () => {
  const view = (placeholder: ConversationView["placeholder"]) =>
    ({
      turns: [],
      live: null,
      steps: [],
      placeholder,
      nextAt: null,
      finishAt: null,
    } as ConversationView);
  /** Where the lesson stands, by the cursor's kind */
  const CURSORS = {
    intro: { kind: "intro" },
    step: { kind: "step", stepId: definition.steps[0].id },
    finished: { kind: "finished" },
  } as const;
  const stateRestartedAt = (
    restartedAt: number | null,
    cursor: keyof typeof CURSORS
  ) =>
    ({
      context: { definition, slug: "hello-anchor" },
      loadedAt: 0,
      engine: { progress: { cursor: CURSORS[cursor], restartedAt } },
    } as unknown as ConversationState);
  const stateAt = (cursor: keyof typeof CURSORS) =>
    stateRestartedAt(null, cursor);
  const thread = PgAssistant as unknown as {
    items: import("@/views/sidebar/assistant/store").ChatItem[];
  };
  const reply = (text: string) => ({
    id: "a1",
    createdAt: new Date(1000).toISOString(),
    kind: "assistant" as const,
    text,
  });

  /** A turn whose input is held like `useTurn`'s */
  const Connected = ({
    turn,
  }: {
    turn: Omit<ComposerTurn, "input" | "setInput">;
  }) => {
    const [input, setInput] = useState("");
    return (
      <TutorialComposer
        turn={{
          send: turn.send,
          stop: turn.stop,
          busy: turn.busy,
          input,
          setInput,
        }}
      />
    );
  };
  /** A turn whose sends reach the assistant, or (`reached` false) open Connect a model */
  const turn = (reached = true) => ({
    send: vi.fn(async () => reached),
    stop: vi.fn(),
    busy: false,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    thread.items = [];
    store.state = stateAt("step");
    store.view.mockReturnValue(view("Ask about this step"));
  });

  it("reads greyed before Start until focused, and still takes a question", async () => {
    store.state = stateAt("intro");
    store.view.mockReturnValue(view("Ask anything about this tutorial"));
    store.say.mockReturnValue("assistant");
    const t = turn();
    const { container } = render(<Connected turn={t} />);
    const waiting = container.querySelector("[data-waiting]");
    expect(waiting?.className).toContain("opacity-50");
    expect(waiting?.className).toContain("focus-within:opacity-100");
    expect(screen.queryByRole("button", { name: "Start step 1" })).toBeNull();
    expect(box().getAttribute("placeholder")).toBe(
      "Ask anything about this tutorial"
    );
    await userEvent.type(box(), "what is a PDA{Enter}");
    expect(t.send).toHaveBeenCalledWith("what is a PDA");
  });

  it("puts Start alone in the composer's place on the phone before Start, and the box after it", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    try {
      store.state = stateAt("intro");
      store.view.mockReturnValue(view("Ask anything about this tutorial"));
      const { rerender } = render(<Connected turn={turn()} />);
      const start = screen.getByRole("button", { name: "Start step 1" });
      expect(start.className).toContain("w-full");
      expect(start.className).toContain("h-12");
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(screen.queryByText("Ready to start the lesson?")).toBeNull();
      await userEvent.click(start);
      expect(store.start).toHaveBeenCalledTimes(1);

      store.state = stateAt("step");
      rerender(<Connected turn={turn()} />);
      expect(box()).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Start step 1" })).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("suggests starting once the assistant has answered before Start", async () => {
    store.state = stateAt("intro");
    store.view.mockReturnValue(view("Ask anything about this tutorial"));
    thread.items = [reply("A PDA is an address a program signs for.")];
    render(<Connected turn={turn()} />);
    expect(screen.getByText("Ready to start the lesson?")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Start step 1" }));
    expect(store.start).toHaveBeenCalledTimes(1);
  });

  it("suggests starting after a turn that only opened the menu", () => {
    store.state = stateAt("intro");
    store.view.mockReturnValue(view("Ask anything about this tutorial"));
    thread.items = [
      {
        id: "t1",
        createdAt: new Date(1000).toISOString(),
        kind: "tool",
        label: "opened the menu",
      },
    ];
    render(<Connected turn={turn()} />);
    expect(screen.getByRole("button", { name: "Start step 1" })).toBeTruthy();
  });

  it("does not count a turn from before the last Start over", () => {
    store.state = stateRestartedAt(2000, "intro");
    store.view.mockReturnValue(view("Ask anything about this tutorial"));
    thread.items = [reply("A PDA is an address a program signs for.")];
    render(<Connected turn={turn()} />);
    expect(screen.queryByRole("button", { name: "Start step 1" })).toBeNull();
  });

  it("holds the suggestion while the answer is still coming", () => {
    store.state = stateAt("intro");
    store.view.mockReturnValue(view("Ask anything about this tutorial"));
    thread.items = [reply("A PDA is")];
    const busy = { send: vi.fn(async () => true), stop: vi.fn(), busy: true };
    render(<Connected turn={busy} />);
    expect(screen.queryByRole("button", { name: "Start step 1" })).toBeNull();
  });

  it("lifts once the lesson has begun: no grey, no suggestion", () => {
    thread.items = [reply("A PDA is an address a program signs for.")];
    const { container } = render(<Connected turn={turn()} />);
    expect(container.querySelector("[data-waiting]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start step 1" })).toBeNull();
  });

  it("runs a live action's word in the lesson, and never asks the assistant", async () => {
    store.say.mockReturnValue("lesson");
    const t = turn();
    render(<Connected turn={t} />);
    await userEvent.type(box(), "build{Enter}");
    expect(store.say).toHaveBeenCalledWith("build");
    expect(store.asked).not.toHaveBeenCalled();
    expect(t.send).not.toHaveBeenCalled();
    expect((box() as HTMLTextAreaElement).value).toBe("");
  });

  it("sends anything else to the live assistant, counted as asked", async () => {
    store.say.mockReturnValue("assistant");
    const t = turn();
    render(<Connected turn={t} />);
    await userEvent.type(box(), "I'm stuck{Enter}");
    expect(t.send).toHaveBeenCalledWith("I'm stuck");
    await waitFor(() => expect(store.asked).toHaveBeenCalledTimes(1));
  });

  it("counts a question on the step it was asked on, with Start pressed mid-answer", async () => {
    store.say.mockReturnValue("assistant");
    store.state = stateAt("intro");
    let answered: (reached: boolean) => void = () => {};
    const t = {
      send: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            answered = resolve;
          })
      ),
      stop: vi.fn(),
      busy: false,
    };
    const { rerender } = render(<Connected turn={t} />);
    await userEvent.type(box(), "what is a PDA{Enter}");
    store.state = stateAt("step");
    rerender(<Connected turn={t} />);
    await act(async () => answered(true));
    expect(store.asked).toHaveBeenCalledTimes(1);
    expect(store.asked).toHaveBeenCalledWith(CURSORS.intro);
  });

  it("does not count a question that opened Connect a model instead", async () => {
    store.say.mockReturnValue("assistant");
    const t = turn(false);
    render(<Connected turn={t} />);
    await userEvent.type(box(), "what is a PDA{Enter}");
    expect(t.send).toHaveBeenCalledWith("what is a PDA");
    await t.send.mock.results[0].value;
    expect(store.asked).not.toHaveBeenCalled();
  });

  it("keeps a question in the box, uncounted, while the assistant answers, and says why", () => {
    store.say.mockReturnValue("assistant");
    const t = turn();
    const answering = (busy: boolean) => (
      <TutorialComposer
        turn={{
          send: t.send,
          stop: t.stop,
          busy,
          input: "why msg!?",
          setInput: vi.fn(),
        }}
      />
    );
    const { rerender } = render(answering(true));
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(store.say).toHaveBeenCalledWith("why msg!?");
    expect(store.asked).not.toHaveBeenCalled();
    expect(t.send).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe(
      "The assistant is still answering. Press Enter again once it's done."
    );
    // The answer ended: the question can go, and the note leaves
    rerender(answering(false));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("is one line at rest, and the full box once focused or holding text", async () => {
    const { container } = render(<Connected turn={turn()} />);
    const form = () => container.querySelector("[data-slot=composer]");
    expect(form()?.hasAttribute("data-open")).toBe(false);
    fireEvent.focus(box());
    expect(form()?.hasAttribute("data-open")).toBe(true);
    await userEvent.type(box(), "why");
    fireEvent.blur(box());
    // Folding waits a tick, and text keeps it open
    await waitFor(() => expect(form()?.hasAttribute("data-open")).toBe(true));
    await userEvent.clear(box());
    box().focus();
    box().blur();
    await waitFor(() => expect(form()?.hasAttribute("data-open")).toBe(false));
  });

  it("shows the finish chips only after the finish, and posts a chip's answer with no model call", async () => {
    const t = turn();
    const { unmount } = render(<Connected turn={t} />);
    expect(
      screen.queryByRole("button", { name: "Change what hello says" })
    ).toBeNull();
    unmount();

    store.state = stateAt("finished");
    store.view.mockReturnValue(view("Ask anything"));
    render(<Connected turn={t} />);
    expect(box().getAttribute("placeholder")).toBe("Ask anything");
    await userEvent.click(
      screen.getByRole("button", { name: "Change what hello says" })
    );
    expect(store.chip).toHaveBeenCalledWith(0);
    expect(t.send).not.toHaveBeenCalled();
  });
});
