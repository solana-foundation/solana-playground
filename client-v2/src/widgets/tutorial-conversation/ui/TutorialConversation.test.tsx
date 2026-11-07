/* eslint-disable layers/curry-order, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActBeat, Ask, TutorialDefinition } from "@/entities/tutorial";
import type {
  Action,
  ConversationState,
  ConversationView,
  EngineState,
  RunResult,
  Turn,
} from "@/features/tutorial-conversation";
import { requireFor } from "@/test-utils/require-for";

import hello from "../../../tutorials/hello-anchor/tutorial.json";

const definition = hello as unknown as TutorialDefinition;

vi.mock("@/features/tutorial-conversation", async () => ({
  // The marks' dry run of a question's landing is the engine's own
  landingFor: (await import("@/features/tutorial-conversation/model/landing"))
    .landingFor,
  stepOfBeat: (await import("@/features/tutorial-conversation/model/reducer"))
    .stepOfBeat,
  PgConversation: {
    state: null,
    view: vi.fn(),
    onDidChange: vi.fn(),
    init: vi.fn(),
    start: vi.fn(),
    pick: vi.fn(),
    hint: vi.fn(),
    skip: vi.fn(),
    typeIt: vi.fn(),
    edit: vi.fn(),
    onDidRequestFocus: vi.fn(),
    act: vi.fn(),
    recheck: vi.fn(),
    explain: vi.fn(),
    answered: vi.fn(),
    showFix: vi.fn(),
    onDidRequestExplain: vi.fn(),
    fixMyself: vi.fn(),
    next: vi.fn(),
    startOver: vi.fn(),
    deployed: vi.fn(),
  },
  judgeGoal: "judgeGoal",
  realDeployWatch: () => "realDeployWatch",
  watchBuildSource: vi.fn(),
  watchDeploys: vi.fn(() => ({ dispose: vi.fn() })),
  isUnreachable: (r: { act: string; ok: boolean; reason?: string }) =>
    r.act === "build" && !r.ok && r.reason === "unreachable",
  isSignedOut: (r: { act: string; ok: boolean; reason?: string }) =>
    r.act === "build" && !r.ok && r.reason === "signed_out",
  isUnconfirmed: (
    await import("@/features/tutorial-conversation/model/progress")
  ).isUnconfirmed,
  realWorkspace: "realWorkspace",
  tutorialRunner: {
    run: vi.fn(async () => ({
      act: "deploy",
      ok: false,
      seconds: 0,
      reason: "failed",
      message: "x",
    })),
    recognise: "recognise",
  },
}));
const session = vi.hoisted(() => ({
  user: undefined as { login: string } | undefined,
  signIn: vi.fn<(from: string, scopes: string[]) => Promise<void>>(
    async () => {}
  ),
  refresh: vi.fn(async () => {}),
}));
vi.mock("@/features/auth", () => ({
  PgSession: {
    get: () => session.user,
    signInFor: (from: string) => (scopes: string[]) =>
      session.signIn(from, scopes),
    refresh: session.refresh,
    onDidChange: () => ({ dispose: () => {} }),
  },
  useSignedIn: () => !!session.user,
  isSignInFailure: () => false,
}));
vi.mock("@/views/flow/state/stage", () => ({
  PgFlow: { deployStarted: vi.fn(), deployFinished: vi.fn() },
}));
vi.mock("@/utils", () => ({
  PgProgramInfo: { idl: null, pk: null },
  PgWallet: { accounts: [], add: vi.fn() },
}));
vi.mock("@/utils/explorer", () => ({
  PgExplorer: {
    convertToFullPath: (p: string) => `/hello/${p}`,
    getFileContent: vi.fn(() => "a\nb\nc\nd\ne\nf\ng"),
    getRelativePath: (p: string) => p.replace("/hello/", ""),
    onDidSaveFile: vi.fn(),
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
// The real one pulls in the editor's globals; the reply's text is what counts
vi.mock("@/components/Markdown", () => ({
  default: ({ children }: { children: string }) => <p>{children}</p>,
}));
/** The editor's read-only holds: how many were taken, how many still held */
const { editorHolds } = vi.hoisted(() => ({
  editorHolds: { taken: 0, held: 0 },
}));
vi.mock("@/utils/editor", () => ({
  PgEditor: {
    revealLine: vi.fn(),
    focus: vi.fn(),
    holdReadOnly: () => {
      editorHolds.taken += 1;
      editorHolds.held += 1;
      return { dispose: () => (editorHolds.held -= 1) };
    },
  },
}));
vi.mock("@/entities/tutorial", async () => {
  const docs = await import("@/entities/tutorial/model/docs");
  return {
    tutorialTelemetry: (await import("@/entities/tutorial/model/telemetry"))
      .tutorialTelemetry,
    slugOf: (await import("@/entities/tutorial/model/definition/check")).slugOf,
    docForLink: docs.docForLink,
    requestDoc: docs.requestDoc,
    requestCode: docs.requestCode,
  };
});
// The listed tutorials, for the finish card's "Next: <tutorial>"
vi.mock("@/utils/tutorial", () => ({
  PgTutorial: {
    all: [{ name: "Counter PDA Tutorial" }],
    open: vi.fn(async () => {}),
  },
}));

import { onCodeRequest } from "@/entities/tutorial/model/docs";
import { tutorialTelemetry } from "@/entities/tutorial/model/telemetry";
import {
  PgConversation,
  tutorialRunner,
  watchDeploys,
} from "@/features/tutorial-conversation";
// Past the slice's entry, which is mocked: the engine's pure parts make the
// phone's progress
import {
  INITIAL_ENGINE_STATE,
  reduce,
} from "@/features/tutorial-conversation/model/reducer";
import { view as viewOf } from "@/features/tutorial-conversation/model/view";
import {
  markUnavailableHere,
  reportButtonFailure,
} from "@/shared/lib/report-button-failure";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { PgEditor } from "@/utils/editor";
import { PgExplorer } from "@/utils/explorer";
import { PgTutorial } from "@/utils/tutorial";
import { PgFlow } from "@/views/flow/state/stage";
import { PgAssistant } from "@/views/sidebar/assistant/store";

import { onStepJumpRequest, requestStepJump } from "../model/jump";
import {
  TutorialConversation,
  useConversationStartOver,
} from "./TutorialConversation";
import { useConversationSteps } from "./use-conversation-steps";

const store = PgConversation as unknown as {
  state: ConversationState | null;
  view: ReturnType<typeof vi.fn>;
  onDidChange: ReturnType<typeof vi.fn>;
  onDidRequestFocus: ReturnType<typeof vi.fn>;
  edit: ReturnType<typeof vi.fn>;
  typeIt: ReturnType<typeof vi.fn>;
  init: ReturnType<typeof vi.fn>;
  startOver: ReturnType<typeof vi.fn>;
  onDidRequestExplain: ReturnType<typeof vi.fn>;
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
  act: requireFor("an act beat")(
    definition.steps[1].beats.find((b): b is ActBeat => b.kind === "act")
  ),
  state: "live",
  presses: [],
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

const finishTurn: Turn = {
  id: "finish",
  kind: "finish",
  step: null,
  at: 9,
  whole: true,
  chips: definition.finish.chips,
  seconds: 252,
  receipt: {
    act: "call",
    ok: true,
    seconds: 0.9,
    signatures: ["5ig"],
    line: "Program log: Hello, Alex!",
    called: [],
  },
};

const finished: ConversationView = {
  turns: [divider, finishTurn],
  live: null,
  steps: definition.steps.map((s) => ({
    id: s.id,
    short: s.short,
    title: s.title,
    state: "done" as const,
    took: null,
  })),
  placeholder: "Ask anything",
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
      said: [],
      proposals: [],
      accounts: {},
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
  editorHolds.taken = 0;
  editorHolds.held = 0;
  Element.prototype.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  store.state = loaded();
  store.view.mockReturnValue(onStep2);
  vi.mocked(PgExplorer.getFile).mockReturnValue({ path: "p", content: "" });
  store.init.mockReturnValue({ dispose });
  store.onDidChange.mockReturnValue({ dispose: vi.fn() });
  store.onDidRequestFocus.mockReturnValue({ dispose: vi.fn() });
  vi.mocked(PgExplorer.onDidSaveFile).mockReturnValue({ dispose: vi.fn() });
  store.onDidRequestExplain.mockReturnValue({ dispose: vi.fn() });
});

describe("TutorialConversation", () => {
  it("starts the engine once with the real workspace, the tutorial's runner and 3.2's judge, and stops it on leaving", () => {
    const { rerender, unmount } = render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
    rerender(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
    expect(store.init).toHaveBeenCalledTimes(1);
    expect(store.init).toHaveBeenCalledWith({
      workspace: "realWorkspace",
      runner: expect.objectContaining({ recognise: "recognise" }),
      judge: "judgeGoal",
    });
    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("hands a deploy from outside the cards to the engine, until it leaves", () => {
    const stop = vi.fn();
    vi.mocked(watchDeploys).mockReturnValueOnce({ dispose: stop });
    const { unmount } = render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
    const [onIdl, port] = vi.mocked(watchDeploys).mock.calls[0];
    expect(port).toBe("realDeployWatch");
    const idl = { version: "0.1.0", name: "p", instructions: [] };
    onIdl(idl as never);
    expect(PgConversation.deployed).toHaveBeenCalledWith(idl);
    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("puts the live assistant in its tutorial mode while shown", () => {
    store.view.mockReturnValue(null);
    const { unmount } = render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
    expect(PgAssistant.mode?.name).toBe("tutorial");
    expect(PgAssistant.mode?.allows("write_file")).toBe(false);
    unmount();
    expect(PgAssistant.mode).toBeNull();
  });

  it("declines an approval a turn begun before the tutorial asks for, at once", async () => {
    PgAssistant.clear();
    store.view.mockReturnValue(null);
    try {
      render(
        <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
      );
      let answer: Promise<{ allowed: boolean }> | undefined;
      act(() => {
        answer = PgAssistant.requestApproval({
          type: "patch",
          path: "src/lib.rs",
          before: "a",
          after: "b",
        });
      });
      await expect(answer).resolves.toMatchObject({ allowed: false });
    } finally {
      PgAssistant.clear();
    }
  });

  it("runs a deploy on the tutorial's runner and tells the flow, for the terminal bar", async () => {
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
    const { runner } = store.init.mock.calls[0][0];
    await runner.run("deploy", { beatId: "s2.deploy" }, () => {});
    expect(tutorialRunner.run).toHaveBeenCalled();
    expect(PgFlow.deployStarted).toHaveBeenCalled();
    expect(PgFlow.deployFinished).toHaveBeenCalledWith(false);
  });

  it("shows one spinner while the engine has no view", () => {
    store.state = {
      context: null,
      engine: loaded().engine,
      loadFailed: false,
      loadedAt: 0,
    };
    store.view.mockReturnValue(null);
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByRole("log")).toBeNull();
  });

  it("shows the live assistant's exchanges in the feed as they arrive", () => {
    PgAssistant.clear();
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
    act(() => PgAssistant.addUserMessage("what does declare_id do?"));
    expect(screen.getByText("what does declare_id do?")).toBeTruthy();
    act(() => {
      const reply = PgAssistant.startAssistantMessage();
      PgAssistant.appendToAssistantMessage(
        reply,
        "It names the program's address."
      );
    });
    expect(screen.getByText("It names the program's address.")).toBeTruthy();
    PgAssistant.clear();
  });

  it("opens a wrote card's file with its first line in view", async () => {
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
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
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
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
    const context = requireFor("the store's state")(store.state).context;
    store.onDidChange.mockImplementation((cb) => {
      notify = cb;
      return { dispose: vi.fn() };
    });
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
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
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );

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
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
    expect(editorHolds.held).toBe(1);

    const started = loaded();
    started.context = intro.context;
    store.state = started;
    act(() => notify(started));
    expect(editorHolds.held).toBe(0);
  });

  it("frees the editor when the tutorial closes on its intro card", () => {
    const intro = loaded();
    intro.engine.progress.cursor = { kind: "intro" };
    store.state = intro;
    const { unmount } = render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
    unmount();
    expect(editorHolds.held).toBe(0);
  });

  it("never locks the editor on a step", () => {
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
    expect(editorHolds.taken).toBe(0);
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
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
    expect(screen.queryByRole("button", { name: /Show lines/ })).toBeNull();

    // The store's timer: the same state object, a view with the turn now due
    store.view.mockReturnValue(onStep2);
    act(() => notify(requireFor("the store's state")(store.state)));
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
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );

    // The save lands, on step 2
    store.state = loaded();
    store.view.mockReturnValue(onStep2);
    act(() => notify(requireFor("the store's state")(store.state)));
    act(() => created.forEach((cb) => cb()));
    expect(PgExplorer.openFile).not.toHaveBeenCalled();
    expect(PgExplorer.onDidCreateItem).not.toHaveBeenCalled();
  });

  it("scrolls the file already open to the line, rather than reopening it", async () => {
    (PgExplorer as unknown as { currentFilePath: string }).currentFilePath =
      "/hello/src/lib.rs";
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Show lines 5 to 6 in src/lib.rs" })
    );
    expect(PgEditor.revealLine).toHaveBeenCalledWith("/hello/src/lib.rs", 5);
    expect(PgExplorer.saveEditorPosition).toHaveBeenCalled();
    expect(PgExplorer.openFile).not.toHaveBeenCalled();
  });

  it("refuses to open a file the workspace does not hold, and says so", async () => {
    vi.mocked(PgExplorer.getFile).mockReturnValue(null);
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
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
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
    await userEvent.click(
      screen.getByRole("button", { name: `Step 1 of 4, ${step1.title}, done` })
    );
    expect(PgExplorer.openFile).not.toHaveBeenCalled();
    expect(refuse).not.toHaveBeenCalled();
  });

  it("hands the engine the file the learner types in, once the typing rests", () => {
    vi.useFakeTimers();
    let saved = () => {};
    vi.mocked(PgExplorer.onDidSaveFile).mockImplementation((cb) => {
      saved = cb as () => void;
      return { dispose: vi.fn() };
    });
    (PgExplorer as unknown as { currentFilePath: string }).currentFilePath =
      "/hello/src/lib.rs";
    vi.mocked(PgExplorer.getFileContent).mockReturnValue('msg!("Hello");');
    try {
      render(
        <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
      );
      saved();
      saved();
      vi.advanceTimersByTime(299);
      expect(store.edit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(store.edit).toHaveBeenCalledTimes(1);
      expect(store.edit).toHaveBeenCalledWith("src/lib.rs", 'msg!("Hello");');
    } finally {
      vi.useRealTimers();
    }
  });

  it("puts the caret where the open question's answer lands, for Type it myself", () => {
    let focus: (f: {
      file: string;
      line: number | "landing";
    }) => void = () => {};
    store.onDidRequestFocus.mockImplementation((cb) => {
      focus = cb;
      return { dispose: vi.fn() };
    });
    const ask = requireFor("a question beat")(
      step1.beats.find((b): b is Ask => b.kind === "ask")
    );
    const question: Turn = {
      id: ask.id,
      kind: "ask",
      step: step1.id,
      at: 2,
      whole: true,
      beatId: ask.id,
      ask,
      open: true,
      wrong: [],
      hinted: false,
      writeFailed: false,
      outcome: null,
      attempts: 0,
    };
    const onQuestion: ConversationView = {
      turns: [divider, question],
      live: question,
      steps: onStep2.steps,
      placeholder: onStep2.placeholder,
      nextAt: null,
      finishAt: null,
    };
    store.view.mockReturnValue(onQuestion);
    vi.mocked(PgExplorer.getFileContent).mockReturnValue(
      'use anchor_lang::prelude::*;\n\ndeclare_id!("11111111111111111111111111111111");'
    );
    (PgExplorer as unknown as { currentFilePath: string }).currentFilePath =
      "/hello/src/lib.rs";
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
    act(() => focus({ file: "src/lib.rs", line: "landing" }));
    expect(PgEditor.revealLine).toHaveBeenCalledWith("/hello/src/lib.rs", 5);
    expect(PgEditor.focus).toHaveBeenCalled();
  });

  it("sends the file typed in before a quick switch to another, not the other", () => {
    vi.useFakeTimers();
    let saved = () => {};
    vi.mocked(PgExplorer.onDidSaveFile).mockImplementation((cb) => {
      saved = cb as () => void;
      return { dispose: vi.fn() };
    });
    vi.mocked(PgExplorer.getFileContent).mockImplementation((path) =>
      path === "/hello/src/lib.rs" ? 'msg!("Hello, World!");' : "// client"
    );
    const explorer = PgExplorer as unknown as { currentFilePath: string };
    try {
      render(
        <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
      );
      explorer.currentFilePath = "/hello/src/lib.rs";
      saved();
      // The learner switches tabs before the typing rests
      explorer.currentFilePath = "/hello/client/client.ts";
      saved();
      expect(store.edit).toHaveBeenCalledWith(
        "src/lib.rs",
        'msg!("Hello, World!");'
      );
      vi.advanceTimersByTime(300);
      expect(store.edit).toHaveBeenLastCalledWith(
        "client/client.ts",
        "// client"
      );
      expect(store.edit).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("puts the caret on a line the engine names, as I'll fix it myself asks", () => {
    let focus: (f: {
      file: string;
      line: number | "landing";
    }) => void = () => {};
    store.onDidRequestFocus.mockImplementation((cb) => {
      focus = cb;
      return { dispose: vi.fn() };
    });
    (PgExplorer as unknown as { currentFilePath: string }).currentFilePath =
      "/hello/src/lib.rs";
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
    act(() => focus({ file: "src/lib.rs", line: 9 }));
    expect(PgEditor.revealLine).toHaveBeenCalledWith("/hello/src/lib.rs", 9);
    expect(PgEditor.focus).toHaveBeenCalled();
  });

  it("leaves the focus alone when the file to type in is not in the workspace", () => {
    let focus: (f: {
      file: string;
      line: number | "landing";
    }) => void = () => {};
    store.onDidRequestFocus.mockImplementation((cb) => {
      focus = cb;
      return { dispose: vi.fn() };
    });
    vi.mocked(PgExplorer.getFile).mockReturnValue(null);
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
    act(() => focus({ file: "src/gone.rs", line: 3 }));
    expect(refuse).toHaveBeenCalled();
    expect(PgEditor.focus).not.toHaveBeenCalled();
  });

  it("sends Type it myself to the engine for the live question", async () => {
    const ask = requireFor("a question beat")(
      step1.beats.find((b): b is Ask => b.kind === "ask")
    );
    const question: Turn = {
      id: ask.id,
      kind: "ask",
      step: step1.id,
      at: 2,
      whole: true,
      beatId: ask.id,
      ask,
      open: true,
      wrong: [],
      hinted: false,
      writeFailed: false,
      outcome: null,
      attempts: 0,
    };
    const onQuestion: ConversationView = {
      turns: [divider, question],
      live: question,
      steps: onStep2.steps,
      placeholder: onStep2.placeholder,
      nextAt: null,
      finishAt: null,
    };
    store.view.mockReturnValue(onQuestion);
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Type it myself" })
    );
    expect(store.typeIt).toHaveBeenCalledWith(ask.id);
  });

  it("presses the live act on ⌘↵", () => {
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
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
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
    const field = document.createElement("input");
    document.body.appendChild(field);
    press(field);
    expect(PgConversation.act).not.toHaveBeenCalled();
    field.remove();
  });

  it("leaves ⌘↵ to a call act's own fields, where Enter sends its arguments", () => {
    const callAct = requireFor("the call act")(
      definition.steps[3].beats.find(
        (b): b is ActBeat => b.kind === "act" && b.act === "call"
      )
    );
    const callTurn: Turn = {
      id: callAct.id,
      kind: "act",
      step: definition.steps[3].id,
      at: 3,
      whole: true,
      beatId: callAct.id,
      act: callAct,
      state: "live",
      presses: [],
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
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
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
      result: {
        act: "build",
        ok: false,
        reason: "compiler",
        seconds: 1,
        error: null,
        log: "",
      },
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
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
    press();
    expect(PgConversation.explain).toHaveBeenCalledWith("s2.deploy");
  });

  it("asks the assistant about an unplanned failure, then offers the fix once it answered", () => {
    // The real store, with no model connected; only the prompt is caught
    const requestPrompt = vi
      .spyOn(PgAssistant, "requestPrompt")
      .mockImplementation(() => {});
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
    const [onExplain] = store.onDidRequestExplain.mock.calls[0];
    act(() =>
      onExplain({
        beatId: "s1.build",
        result: {
          act: "build",
          ok: false,
          seconds: 1,
          reason: "compiler",
          error: {
            code: "E0308",
            file: "src/lib.rs",
            line: 10,
            column: 9,
            message: "mismatched types",
          },
          log: "error[E0308]: mismatched types",
        },
      })
    );
    expect(requestPrompt).toHaveBeenCalledWith(
      expect.stringContaining("E0308: mismatched types at src/lib.rs:10:9"),
      { send: true }
    );
    // No assistant connected in the test: its answer is taken as ended
    expect(PgConversation.answered).toHaveBeenCalledWith("s1.build");
    requestPrompt.mockRestore();
  });

  it("writes the fix on Show me the fix and shows where it lands", async () => {
    const offer: Turn = {
      id: "fix:s1.build:0",
      kind: "say",
      step: step1.id,
      at: 4,
      whole: true,
      beatId: "s1.build",
      text: "Fix it in the editor and build again, or I can show you the lines this step needs.",
      follow: { kind: "showFix", done: false },
    };
    store.view.mockReturnValue({
      turns: [offer],
      live: null,
      steps: onStep2.steps,
      placeholder: "Ask about this step",
      nextAt: null,
      finishAt: null,
    });
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Show me the fix" })
    );
    expect(PgConversation.showFix).toHaveBeenCalledWith("s1.build");
    expect(PgExplorer.openFile).toHaveBeenCalledWith("/hello/src/lib.rs");
  });

  it("puts the caret on the compiler's line from the failed card's pointer", async () => {
    const failure: Turn = {
      id: "result:s1.build:0",
      kind: "result",
      step: step1.id,
      at: 4,
      whole: true,
      beatId: "s1.build",
      act: "build",
      result: {
        act: "build",
        ok: false,
        seconds: 6,
        reason: "compiler",
        error: {
          code: "E0412",
          file: "src/lib.rs",
          line: 9,
          column: 32,
          message: "cannot find type `Hello` in this scope",
        },
        log: "",
      },
      took: 6000,
      planned: null,
      open: true,
    };
    store.view.mockReturnValue({
      turns: [failure],
      live: failure,
      steps: onStep2.steps,
      placeholder: "Ask about this step",
      nextAt: null,
      finishAt: null,
    });
    (PgExplorer as unknown as { currentFilePath: string }).currentFilePath =
      "/hello/src/lib.rs";
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
    await userEvent.click(
      screen.getByRole("button", { name: "--> src/lib.rs:9:32" })
    );
    expect(PgEditor.revealLine).toHaveBeenCalledWith("/hello/src/lib.rs", 9);
    expect(PgEditor.focus).toHaveBeenCalled();
  });

  it("runs the build again on ⌘↵ when its server never answered", () => {
    const unreachable: Turn = {
      id: "result:s1.build:0",
      kind: "result",
      step: definition.steps[0].id,
      at: 4,
      whole: true,
      beatId: "s1.build",
      act: "build",
      result: {
        act: "build",
        ok: false,
        reason: "unreachable",
        seconds: 0,
        error: null,
        log: "Failed to fetch",
      },
      took: 10,
      planned: null,
      open: true,
    };
    store.view.mockReturnValue({
      turns: [unreachable],
      live: unreachable,
      steps: onStep2.steps,
      placeholder: "Ask about this step",
      nextAt: null,
      finishAt: null,
    });
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
    press();
    expect(PgConversation.act).toHaveBeenCalledWith("s1.build");
    expect(PgConversation.explain).not.toHaveBeenCalled();
  });

  it("checks again on ⌘↵ when devnet has not read the call back", () => {
    const unconfirmed: Turn = {
      id: "result:s1.call:0",
      kind: "result",
      step: definition.steps[0].id,
      at: 4,
      whole: true,
      beatId: "s1.call",
      act: "call",
      result: {
        act: "call",
        ok: false,
        seconds: 4,
        reason: "unconfirmed",
        message:
          "Devnet has not confirmed this transaction yet. Check again, or open it in Explorer.",
        log: "",
        unconfirmed: [{ signature: "5ig", calls: [] }],
      },
      took: 10,
      planned: null,
      open: true,
    };
    store.view.mockReturnValue({
      turns: [unconfirmed],
      live: unconfirmed,
      steps: onStep2.steps,
      placeholder: "Ask about this step",
      nextAt: null,
      finishAt: null,
    });
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
    press();
    expect(PgConversation.recheck).toHaveBeenCalledWith("s1.call");
    expect(PgConversation.act).not.toHaveBeenCalled();
    expect(PgConversation.explain).not.toHaveBeenCalled();
  });

  describe("on a build refused for sign-in", () => {
    const refused: Turn = {
      id: "result:s1.build:0",
      kind: "result",
      step: definition.steps[0].id,
      at: 4,
      whole: true,
      beatId: "s1.build",
      act: "build",
      result: {
        act: "build",
        ok: false,
        reason: "signed_out",
        seconds: 0,
        error: null,
        log: "Sign in with GitHub to build.",
      },
      took: 10,
      planned: null,
      open: true,
    };
    const showRefused = () => {
      store.view.mockReturnValue({
        turns: [refused],
        live: refused,
        steps: onStep2.steps,
        placeholder: "Ask about this step",
        nextAt: null,
        finishAt: null,
      });
      render(
        <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
      );
    };

    it("signs in on ⌘↵ while nobody is signed in", () => {
      session.user = undefined;
      showRefused();
      expect(session.refresh).not.toHaveBeenCalled();
      press();
      expect(session.signIn).toHaveBeenCalledWith("tutorial", []);
      expect(PgConversation.act).not.toHaveBeenCalled();
      expect(PgConversation.explain).not.toHaveBeenCalled();
    });

    it("builds on ⌘↵ once someone is signed in", async () => {
      session.user = { login: "learner" };
      showRefused();
      expect(
        await screen.findByRole("button", { name: /^Build/ })
      ).toBeTruthy();
      press();
      expect(PgConversation.act).toHaveBeenCalledWith("s1.build");
      expect(session.signIn).not.toHaveBeenCalled();
      // The server refused a browser that thinks it is signed in: the
      // session is read again, so an expired one turns the card back
      expect(session.refresh).toHaveBeenCalledTimes(1);
      session.user = undefined;
    });
  });

  it("counts the pill's way back to the live step", async () => {
    const track = vi.spyOn(tutorialTelemetry, "track");
    render(
      <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
    );
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

describe("TutorialConversation on the phone", () => {
  const at = (n: number) => n * 100_000;
  const built: RunResult = {
    act: "build",
    ok: true,
    seconds: 1,
    instructions: ["hello"],
  };
  const deployed: RunResult = {
    act: "deploy",
    ok: true,
    seconds: 4,
    programId: "Hello1111111111111111111111111111111111111",
    signature: "5ig",
    upgraded: false,
    lamports: 1_000_000,
    instructions: ["hello"],
  };
  /** Hello Anchor from Start to step 3's open question, as the engine plays it */
  const toStep3: Action[] = [
    { type: "start", at: at(1) },
    { type: "pick", beatId: "s1.q1", option: 1, at: at(2) },
    {
      type: "written",
      beatId: "s1.q1",
      wrote: { file: "src/lib.rs", lines: [5, 6] },
      at: at(3),
    },
    { type: "act", beatId: "s1.build", at: at(4) },
    { type: "ended", beatId: "s1.build", result: built, at: at(5) },
    { type: "next", at: at(6) },
    { type: "pick", beatId: "s2.q2", option: 0, at: at(7) },
    { type: "act", beatId: "s2.deploy", at: at(8) },
    { type: "ended", beatId: "s2.deploy", result: deployed, at: at(9) },
    { type: "next", at: at(10) },
  ];
  const failedBuild: RunResult = {
    act: "build",
    ok: false,
    seconds: 6,
    reason: "compiler",
    error: null,
    log: "error[E0412]: cannot find type",
  };
  const toFailedBuild: Action[] = [
    { type: "start", at: at(1) },
    { type: "pick", beatId: "s1.q1", option: 1, at: at(2) },
    { type: "act", beatId: "s1.build", at: at(3) },
    { type: "ended", beatId: "s1.build", result: failedBuild, at: at(4) },
  ];
  const ctx = { definition, slug: "hello-anchor", judge: () => true };

  /** The store holds the progress `actions` make, from one save */
  const play = (actions: Action[]) => {
    const engine = actions.reduce<EngineState>(
      (state, action) => reduce(ctx, state, action).state,
      INITIAL_ENGINE_STATE
    );
    store.state = { context: ctx, engine, loadFailed: false, loadedAt: 0 };
    store.view.mockImplementation(() =>
      viewOf(definition, engine, { now: at(1000), loadedAt: 0 })
    );
  };

  let width = 1440;
  const media = (query: string) => ({
    get matches() {
      const below = /width\s*<\s*(\d+)px/.exec(query)?.[1];
      return below !== undefined && width < Number(below);
    },
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
  beforeEach(() => {
    vi.stubGlobal("matchMedia", media);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    width = 1440;
  });

  const drawAt = (px: number) => {
    width = px;
    return render(
      <TooltipProvider>
        <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
      </TooltipProvider>
    );
  };
  const turnsOf = (box: HTMLElement) =>
    Array.from(box.querySelectorAll<HTMLElement>("[data-turn]")).map(
      (el) => el.dataset.turn
    );
  const optionsOf = () =>
    screen
      .getAllByRole("group")
      .flatMap((group) =>
        Array.from(group.querySelectorAll("button")).map((b) => b.textContent)
      );

  it("draws the same turns and the same question from one save at 390 and 1440 px", () => {
    play(toStep3);
    const desk = drawAt(1440);
    const deskTurns = turnsOf(desk.container);
    const deskOptions = optionsOf();
    desk.unmount();

    const phone = drawAt(390);
    expect(turnsOf(phone.container)).toEqual(deskTurns);
    expect(optionsOf()).toEqual(deskOptions);
    expect(deskTurns.filter((t) => t === "divider")).toHaveLength(3);
  });

  it("takes a step picked in the phone's header to its divider and opens no file", () => {
    play(toStep3);
    const track = vi.spyOn(tutorialTelemetry, "track");
    drawAt(390);
    act(() => requestStepJump(0));
    expect(track).toHaveBeenCalledWith(
      "tutorial_step_jumped",
      expect.objectContaining({ step: 1, via: "menu" })
    );
    expect(PgExplorer.openFile).not.toHaveBeenCalled();
  });

  it("keeps Code read only on the phone after Start, and not on the desktop", () => {
    play(toStep3);
    const desk = drawAt(1440);
    expect(editorHolds.taken).toBe(0);
    desk.unmount();
    const phone = drawAt(390);
    expect(editorHolds.held).toBe(1);
    phone.unmount();
    expect(editorHolds.held).toBe(0);
  });

  it("leaves the step bar to the phone's header", () => {
    play(toStep3);
    const desk = drawAt(1440);
    expect(
      screen.getAllByRole("button", { name: /^Step 3 of 4/ }).length
    ).toBeGreaterThan(0);
    desk.unmount();
    drawAt(390);
    expect(screen.queryAllByRole("button", { name: /^Step 3 of 4/ })).toEqual(
      []
    );
  });

  it("offers Hint and Skip on the phone's question, and no Type it myself", () => {
    play(toStep3);
    const desk = drawAt(1440);
    expect(screen.getByRole("button", { name: "Type it myself" })).toBeTruthy();
    desk.unmount();

    drawAt(390);
    expect(screen.getByRole("button", { name: "Hint" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Type it myself" })).toBeNull();
  });

  it("offers Explain the error alone on a failed build, at a phone's and a tablet's width", () => {
    play(toFailedBuild);
    const desk = drawAt(1440);
    expect(
      screen.getByRole("button", { name: "I'll fix it myself" })
    ).toBeTruthy();
    desk.unmount();

    for (const px of [390, 900]) {
      const phone = drawAt(px);
      expect(
        screen.getByRole("button", { name: "Explain the error" })
      ).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "I'll fix it myself" })
      ).toBeNull();
      phone.unmount();
    }
  });

  it("shows no key hints on the phone", () => {
    play(toFailedBuild.slice(0, 2));
    const desk = drawAt(1440);
    expect(desk.container.querySelector("kbd")).toBeTruthy();
    desk.unmount();
    const phone = drawAt(390);
    expect(phone.container.querySelector("kbd")).toBeNull();
  });

  it("brings Code in from a wrote card's Show", async () => {
    play(toStep3);
    drawAt(390);
    const listen = vi.fn();
    const stop = onCodeRequest(listen);
    await userEvent.click(
      screen.getByRole("button", { name: "Show lines 5 to 6 in src/lib.rs" })
    );
    stop();
    expect(listen).toHaveBeenCalledTimes(1);
  });
});

describe("useConversationSteps", () => {
  // The store keys a conversation by its workspace, named after the tutorial
  const workspace = PgExplorer as unknown as { currentWorkspaceName: string };
  beforeEach(() => {
    workspace.currentWorkspaceName = definition.name;
  });
  afterEach(() => {
    workspace.currentWorkspaceName = "hello";
  });

  it("hands the phone's header the steps with their objectives and where the learner is", () => {
    const { result } = renderHook(() => useConversationSteps());
    expect(result.current.steps.map((s) => s.objective)).toEqual(
      definition.steps.map((s) => s.objective)
    );
    expect(result.current.steps[1].state).toBe("current");
    expect(result.current).toMatchObject({
      live: 1,
      started: true,
      finished: false,
      wrote: 1,
      minutes: definition.minutes,
    });
  });

  it("reads done once every step passed", () => {
    store.view.mockReturnValue(finished);
    const { result } = renderHook(() => useConversationSteps());
    expect(result.current.finished).toBe(true);
    expect(result.current.live).toBe(3);
  });

  it("asks the feed to jump to a step", () => {
    const listen = vi.fn();
    const stop = onStepJumpRequest(listen);
    const { result } = renderHook(() => useConversationSteps());
    result.current.jump(0);
    stop();
    expect(listen).toHaveBeenCalledWith(0);
  });

  it("reads as not loaded while the store still holds another tutorial's conversation", () => {
    workspace.currentWorkspaceName = "Counter";
    const { result } = renderHook(() => useConversationSteps());
    expect(result.current).toMatchObject({
      steps: [],
      wrote: 0,
      loaded: false,
    });
  });

  it("has no steps outside a conversation tutorial", () => {
    store.state = {
      context: null,
      engine: loaded().engine,
      loadFailed: false,
      loadedAt: 0,
    };
    store.view.mockReturnValue(null);
    const { result } = renderHook(() => useConversationSteps());
    expect(result.current).toMatchObject({
      steps: [],
      live: null,
      started: false,
      finished: false,
      wrote: 0,
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

  describe("on the finish", () => {
    // Copy's tooltip positions itself with a `ResizeObserver`, which jsdom lacks
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
    afterEach(() => vi.unstubAllGlobals());

    it("opens the next tutorial from the finish, and counts it", async () => {
      store.view.mockReturnValue(finished);
      const track = vi.spyOn(tutorialTelemetry, "track");
      render(
        <TooltipProvider>
          <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
        </TooltipProvider>
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Next: Counter PDA Tutorial" })
      );
      expect(track).toHaveBeenCalledWith("tutorial_next_opened", {
        tutorial: "hello-anchor",
        next: "counter-pda-tutorial",
      });
      expect(PgTutorial.open).toHaveBeenCalledWith("Counter PDA Tutorial");
    });

    it("counts no next tutorial when its open fails, and says so", async () => {
      store.view.mockReturnValue(finished);
      const track = vi.spyOn(tutorialTelemetry, "track");
      const failed = new Error("Explorer not initialized");
      vi.mocked(PgTutorial.open).mockRejectedValueOnce(failed);
      render(
        <TooltipProvider>
          <TutorialConversation onAllTutorials={vi.fn()} onOpenMenu={vi.fn()} />
        </TooltipProvider>
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Next: Counter PDA Tutorial" })
      );
      expect(reportButtonFailure).toHaveBeenCalledWith(
        "open Counter PDA Tutorial"
      );
      expect(refuse).toHaveBeenCalledWith(failed);
      expect(track).not.toHaveBeenCalledWith(
        "tutorial_next_opened",
        expect.anything()
      );
    });

    it("hands All tutorials to the frame, and counts Copy receipt", async () => {
      store.view.mockReturnValue(finished);
      const track = vi.spyOn(tutorialTelemetry, "track");
      const onAllTutorials = vi.fn();
      render(
        <TooltipProvider>
          <TutorialConversation
            onAllTutorials={onAllTutorials}
            onOpenMenu={vi.fn()}
          />
        </TooltipProvider>
      );
      await userEvent.click(
        screen.getByRole("button", { name: "All tutorials" })
      );
      expect(onAllTutorials).toHaveBeenCalledTimes(1);
      await userEvent.click(
        screen.getByRole("button", { name: "Copy receipt" })
      );
      expect(track).toHaveBeenCalledWith("tutorial_receipt_copied", {
        tutorial: "hello-anchor",
      });
    });
  });
});
