import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActBeat, TutorialDefinition } from "@/entities/tutorial";
import type {
  ConversationState,
  ConversationView,
  Turn,
} from "@/features/tutorial-conversation";
import hello from "../../../tutorials/hello-anchor/tutorial.json";

const definition = hello as unknown as TutorialDefinition;

vi.mock("@/features/tutorial-conversation", () => ({
  PgConversation: {
    state: null,
    view: vi.fn(),
    onDidChange: vi.fn(),
    init: vi.fn(),
    start: vi.fn(),
    pick: vi.fn(),
    hint: vi.fn(),
    skip: vi.fn(),
    act: vi.fn(),
    explain: vi.fn(),
    fixMyself: vi.fn(),
    next: vi.fn(),
    startOver: vi.fn(),
  },
  judgeGoal: "judgeGoal",
  realWorkspace: "realWorkspace",
  unwiredRunner: "unwiredRunner",
}));
vi.mock("@/utils/explorer", () => ({
  PgExplorer: {
    convertToFullPath: (p: string) => `/hello/${p}`,
    getFileContent: () => "a\nb\nc\nd\ne\nf\ng",
    currentWorkspaceName: "hello",
    currentFilePath: "",
    saveEditorPosition: vi.fn(),
    openFile: vi.fn(),
    getFile: vi.fn(),
    onDidCreateItem: vi.fn(),
  },
}));
/** The handler `reportButtonFailure` hands back: calling it is what raises the toast */
const { refuse } = vi.hoisted(() => ({ refuse: vi.fn() }));
vi.mock("@/shared/lib/report-button-failure", () => ({
  reportButtonFailure: vi.fn(() => refuse),
  markUnavailableHere: vi.fn(),
}));
vi.mock("@/utils/editor", () => ({
  PgEditor: { revealLine: vi.fn(), setReadOnly: vi.fn() },
}));
vi.mock("@/entities/tutorial", async () => ({
  tutorialTelemetry: (await import("@/entities/tutorial/model/telemetry"))
    .tutorialTelemetry,
}));

import { PgConversation } from "@/features/tutorial-conversation";
import { tutorialTelemetry } from "@/entities/tutorial/model/telemetry";
import {
  markUnavailableHere,
  reportButtonFailure,
} from "@/shared/lib/report-button-failure";
import { PgEditor } from "@/utils/editor";
import { PgExplorer } from "@/utils/explorer";
import {
  TutorialConversation,
  useConversationStartOver,
} from "./TutorialConversation";

const store = PgConversation as unknown as {
  state: ConversationState | null;
  view: ReturnType<typeof vi.fn>;
  onDidChange: ReturnType<typeof vi.fn>;
  init: ReturnType<typeof vi.fn>;
  startOver: ReturnType<typeof vi.fn>;
};

const step1 = definition.steps[0];
const divider: Turn = {
  id: `divider:${step1.id}`,
  kind: "divider",
  step: step1.id,
  at: 1,
  whole: true,
  index: 1,
  title: step1.title,
  objective: step1.objective,
  done: true,
  took: 41_000,
};
const wrote: Turn = {
  id: "wrote:s1.q1",
  kind: "wrote",
  step: step1.id,
  at: 2,
  whole: true,
  beatId: "s1.q1",
  wrote: { file: "src/lib.rs", lines: [5, 6] },
  failed: false,
};
const live: Turn = {
  id: "s2.deploy",
  kind: "act",
  step: definition.steps[1].id,
  at: 3,
  whole: true,
  beatId: "s2.deploy",
  act: definition.steps[1].beats.find((b): b is ActBeat => b.kind === "act")!,
  state: "live",
  note: null,
  stage: null,
  took: null,
};

const onStep2: ConversationView = {
  turns: [divider, wrote, live],
  live,
  steps: definition.steps.map((s, i) => ({
    id: s.id,
    short: s.short,
    title: s.title,
    state: ["done", "current", "not_reached", "not_reached"][i] as
      | "done"
      | "current"
      | "not_reached",
    took: null,
  })),
  placeholder: "Ask about this step",
  nextAt: null,
  finishAt: null,
};

const loaded = (): ConversationState => ({
  context: { definition, slug: "hello-anchor", judge: () => true },
  engine: {
    progress: {
      version: 1,
      passed: [step1.id],
      finishedAt: null,
      startedAt: 1,
      restartedAt: null,
      cursor: {
        kind: "step",
        stepId: definition.steps[1].id,
        beat: 0,
        fail: false,
      },
      beats: {},
      runs: {},
      times: {},
    },
    stage: null,
  },
  loadFailed: false,
  loadedAt: 1000,
});

const dispose = vi.fn();

afterEach(() => {
  (PgExplorer as unknown as { currentFilePath: string }).currentFilePath = "";
});

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  store.state = loaded();
  store.view.mockReturnValue(onStep2);
  vi.mocked(PgExplorer.getFile).mockReturnValue({ path: "p", content: "" });
  store.init.mockReturnValue({ dispose });
  store.onDidChange.mockReturnValue({ dispose: vi.fn() });
});

describe("TutorialConversation", () => {
  it("starts the engine once with the real workspace, the unwired runner and 3.2's judge, and stops it on leaving", () => {
    const { rerender, unmount } = render(<TutorialConversation />);
    rerender(<TutorialConversation />);
    expect(store.init).toHaveBeenCalledTimes(1);
    expect(store.init).toHaveBeenCalledWith({
      workspace: "realWorkspace",
      runner: "unwiredRunner",
      judge: "judgeGoal",
    });
    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("shows one spinner while the engine has no view", () => {
    store.state = {
      context: null,
      engine: loaded().engine,
      loadFailed: false,
      loadedAt: 0,
    };
    store.view.mockReturnValue(null);
    render(<TutorialConversation />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByRole("log")).toBeNull();
  });

  it("opens a wrote card's file with its first line in view", async () => {
    render(<TutorialConversation />);
    await userEvent.click(
      screen.getByRole("button", { name: "Show lines 5 to 6 in src/lib.rs" })
    );
    expect(PgExplorer.saveEditorPosition).toHaveBeenCalledWith(
      "/hello/src/lib.rs",
      { cursor: { from: 0, to: 0 }, topLineNumber: 1 }
    );
    expect(PgExplorer.openFile).toHaveBeenCalledWith("/hello/src/lib.rs");
  });

  it("opens a step's file at the top from its segment, and counts the jump", async () => {
    const track = vi.spyOn(tutorialTelemetry, "track");
    render(<TutorialConversation />);
    await userEvent.click(
      screen.getByRole("button", { name: `Step 1 of 4, ${step1.title}, done` })
    );
    expect(PgExplorer.openFile).toHaveBeenCalledWith(`/hello/${step1.file}`);
    expect(track).toHaveBeenCalledWith("tutorial_step_jumped", {
      tutorial: "hello-anchor",
      step: 1,
      from: 2,
      via: "bar",
    });
  });

  it("opens a step's file when the lesson enters it, once the file is written", () => {
    const created: (() => void)[] = [];
    vi.mocked(PgExplorer.onDidCreateItem).mockImplementation((cb) => {
      created.push(cb as () => void);
      return { dispose: vi.fn() };
    });
    vi.mocked(PgExplorer.getFile).mockReturnValue(null);
    let notify: (s: ConversationState) => void = () => {};
    const context = store.state!.context;
    store.onDidChange.mockImplementation((cb) => {
      notify = cb;
      return { dispose: vi.fn() };
    });
    render(<TutorialConversation />);
    // The first render is a load: the workspace keeps its own tabs
    expect(PgExplorer.openFile).not.toHaveBeenCalled();

    const entered = loaded();
    // The same loaded tutorial: only the cursor moved
    entered.context = context;
    entered.engine.progress.cursor = {
      kind: "step",
      stepId: definition.steps[2].id,
      beat: 0,
      fail: false,
    };
    store.state = entered;
    act(() => notify(entered));
    expect(PgExplorer.openFile).not.toHaveBeenCalled();

    vi.mocked(PgExplorer.getFile).mockReturnValue({ path: "p", content: "" });
    act(() => created.forEach((cb) => cb()));
    expect(PgExplorer.openFile).toHaveBeenCalledWith(
      `/hello/${definition.steps[2].file}`
    );
  });

  it("opens the step's file again once Start's restore has overwritten it", () => {
    const created: (() => void)[] = [];
    vi.mocked(PgExplorer.onDidCreateItem).mockImplementation((cb) => {
      created.push(cb as () => void);
      return { dispose: vi.fn() };
    });
    // The preview's lib.rs is still there when the cursor moves
    vi.mocked(PgExplorer.getFile).mockReturnValue({ path: "p", content: "" });
    let notify: (s: ConversationState) => void = () => {};
    store.onDidChange.mockImplementation((cb) => {
      notify = cb;
      return { dispose: vi.fn() };
    });
    const intro = loaded();
    intro.engine.progress.cursor = { kind: "intro" };
    store.state = intro;
    render(<TutorialConversation />);

    const started = loaded();
    started.context = intro.context;
    store.state = started;
    act(() => notify(started));
    expect(PgExplorer.openFile).toHaveBeenCalledTimes(1);
    // The restore writes it over the open one, which closes the tab
    act(() => created.forEach((cb) => cb()));
    expect(PgExplorer.openFile).toHaveBeenCalledTimes(2);
  });

  it("keeps the editor read only while the intro card shows, and frees it on Start", () => {
    vi.mocked(PgExplorer.onDidCreateItem).mockReturnValue({ dispose: vi.fn() });
    let notify: (s: ConversationState) => void = () => {};
    store.onDidChange.mockImplementation((cb) => {
      notify = cb;
      return { dispose: vi.fn() };
    });
    const intro = loaded();
    intro.engine.progress.cursor = { kind: "intro" };
    store.state = intro;
    render(<TutorialConversation />);
    expect(PgEditor.setReadOnly).toHaveBeenLastCalledWith(true);

    const started = loaded();
    started.context = intro.context;
    store.state = started;
    act(() => notify(started));
    expect(PgEditor.setReadOnly).toHaveBeenLastCalledWith(false);
  });

  it("frees the editor when the tutorial closes on its intro card", () => {
    const intro = loaded();
    intro.engine.progress.cursor = { kind: "intro" };
    store.state = intro;
    const { unmount } = render(<TutorialConversation />);
    unmount();
    expect(PgEditor.setReadOnly).toHaveBeenLastCalledWith(false);
  });

  it("never locks the editor on a step", () => {
    render(<TutorialConversation />);
    expect(PgEditor.setReadOnly).not.toHaveBeenCalled();
  });

  it("draws a turn that arrives on its own, when the store re-announces the same state", () => {
    let notify: (s: ConversationState) => void = () => {};
    store.onDidChange.mockImplementation((cb) => {
      notify = cb;
      return { dispose: vi.fn() };
    });
    store.view.mockReturnValue({
      turns: [divider],
      live: null,
      steps: onStep2.steps,
      placeholder: "Ask about this step",
      nextAt: 5,
      finishAt: null,
    });
    render(<TutorialConversation />);
    expect(screen.queryByRole("button", { name: /Show lines/ })).toBeNull();

    // The store's timer: the same state object, a view with the turn now due
    store.view.mockReturnValue(onStep2);
    act(() => notify(store.state!));
    expect(
      screen.getByRole("button", { name: "Show lines 5 to 6 in src/lib.rs" })
    ).toBeTruthy();
  });

  it("opens nothing when a reload's save arrives with the cursor already on a step", () => {
    const created: (() => void)[] = [];
    vi.mocked(PgExplorer.onDidCreateItem).mockImplementation((cb) => {
      created.push(cb as () => void);
      return { dispose: vi.fn() };
    });
    let notify: (s: ConversationState) => void = () => {};
    store.onDidChange.mockImplementation((cb) => {
      notify = cb;
      return { dispose: vi.fn() };
    });
    // The first render, before the store has read the save: the store's
    // initial state, its cursor on the intro (`INITIAL_CONVERSATION_STATE`)
    const initial = loaded().engine;
    initial.progress.cursor = { kind: "intro" };
    store.state = {
      context: null,
      engine: initial,
      loadFailed: false,
      loadedAt: 0,
    };
    store.view.mockReturnValue(null);
    render(<TutorialConversation />);

    // The save lands, on step 2
    store.state = loaded();
    store.view.mockReturnValue(onStep2);
    act(() => notify(store.state!));
    act(() => created.forEach((cb) => cb()));
    expect(PgExplorer.openFile).not.toHaveBeenCalled();
    expect(PgExplorer.onDidCreateItem).not.toHaveBeenCalled();
  });

  it("scrolls the file already open to the line, rather than reopening it", async () => {
    (PgExplorer as unknown as { currentFilePath: string }).currentFilePath =
      "/hello/src/lib.rs";
    render(<TutorialConversation />);
    await userEvent.click(
      screen.getByRole("button", { name: "Show lines 5 to 6 in src/lib.rs" })
    );
    expect(PgEditor.revealLine).toHaveBeenCalledWith("/hello/src/lib.rs", 5);
    expect(PgExplorer.saveEditorPosition).toHaveBeenCalled();
    expect(PgExplorer.openFile).not.toHaveBeenCalled();
  });

  it("refuses to open a file the workspace does not hold, and says so", async () => {
    vi.mocked(PgExplorer.getFile).mockReturnValue(null);
    render(<TutorialConversation />);
    await userEvent.click(
      screen.getByRole("button", { name: "Show lines 5 to 6 in src/lib.rs" })
    );
    expect(PgExplorer.saveEditorPosition).not.toHaveBeenCalled();
    expect(PgExplorer.openFile).not.toHaveBeenCalled();
    expect(reportButtonFailure).toHaveBeenCalledWith("open src/lib.rs");
    expect(markUnavailableHere).toHaveBeenCalledWith(
      expect.any(Error),
      "it is not in this project"
    );
    expect(refuse).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "src/lib.rs is not in this workspace",
      })
    );
  });

  it("leaves the editor as it is when a jumped-to step's file is gone, and says nothing", async () => {
    vi.mocked(PgExplorer.getFile).mockReturnValue(null);
    render(<TutorialConversation />);
    await userEvent.click(
      screen.getByRole("button", { name: `Step 1 of 4, ${step1.title}, done` })
    );
    expect(PgExplorer.openFile).not.toHaveBeenCalled();
    expect(refuse).not.toHaveBeenCalled();
  });

  it("presses the live act on ⌘↵", () => {
    render(<TutorialConversation />);
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", metaKey: true })
      );
    });
    expect(PgConversation.act).toHaveBeenCalledWith("s2.deploy");
  });
});

describe("TutorialConversation keys and the pill", () => {
  const press = (target: EventTarget = document) =>
    act(() => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          bubbles: true,
        })
      );
    });

  it("leaves ⌘↵ to a field that has focus", () => {
    render(<TutorialConversation />);
    const field = document.createElement("input");
    document.body.appendChild(field);
    press(field);
    expect(PgConversation.act).not.toHaveBeenCalled();
    field.remove();
  });

  it("leaves ⌘↵ to a call act's own fields, where Enter sends its arguments", () => {
    const callAct = definition.steps[3].beats.find(
      (b): b is ActBeat => b.kind === "act" && b.act === "call"
    )!;
    const callTurn: Turn = {
      id: callAct.id,
      kind: "act",
      step: definition.steps[3].id,
      at: 3,
      whole: true,
      beatId: callAct.id,
      act: callAct,
      state: "live",
      note: null,
      stage: null,
      took: null,
    };
    store.view.mockReturnValue({
      turns: [callTurn],
      live: callTurn,
      steps: onStep2.steps,
      placeholder: "Ask about this step",
      nextAt: null,
      finishAt: null,
    });
    render(<TutorialConversation />);
    press();
    expect(PgConversation.act).not.toHaveBeenCalled();
  });

  it("presses Explain on ⌘↵ while a failure waits", () => {
    const failure: Turn = {
      id: "result:s2.deploy:0",
      kind: "result",
      step: definition.steps[1].id,
      at: 4,
      whole: true,
      beatId: "s2.deploy",
      act: "build",
      result: { act: "build", ok: false, seconds: 1, error: null, log: "" },
      took: 1000,
      planned: null,
      open: true,
    };
    store.view.mockReturnValue({
      turns: [divider, failure],
      live: failure,
      steps: onStep2.steps,
      placeholder: "Ask about this step",
      nextAt: null,
      finishAt: null,
    });
    render(<TutorialConversation />);
    press();
    expect(PgConversation.explain).toHaveBeenCalledWith("s2.deploy");
  });

  it("counts the pill's way back to the live step", async () => {
    const track = vi.spyOn(tutorialTelemetry, "track");
    render(<TutorialConversation />);
    await userEvent.click(
      screen.getByRole("button", { name: `Step 1 of 4, ${step1.title}, done` })
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Back to step 2" })
    );
    expect(track).toHaveBeenLastCalledWith("tutorial_step_back", {
      tutorial: "hello-anchor",
      step: 2,
    });
  });
});

describe("useConversationStartOver", () => {
  it("hands the frame Start over and the steps passed", async () => {
    const { result } = renderHook(() => useConversationStartOver());
    expect(result.current.passed).toBe(1);
    await result.current.onStartOver?.();
    expect(store.startOver).toHaveBeenCalledTimes(1);
  });

  it("offers nothing outside a conversation tutorial", () => {
    store.state = {
      context: null,
      engine: loaded().engine,
      loadFailed: false,
      loadedAt: 0,
    };
    const { result } = renderHook(() => useConversationStartOver());
    expect(result.current.onStartOver).toBeUndefined();
  });
});
