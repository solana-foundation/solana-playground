// The connected thread: the store's items, the lesson's next move, the
// turn's send, and what is reported when the user acts on them.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initTelemetry,
  memoryProvider as memoryTelemetry,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import {
  CONNECTION_LOST,
  PgAssistant,
  THREAD_NOT_SAVED,
} from "../../../views/sidebar/assistant/store";
import * as reportModule from "@/shared/lib/report-button-failure";
import type { Turn } from "../model/use-turn";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { Thread } from "./Thread";

/** The open lesson as the thread sees it; no lesson unless a test opens one */
const lesson = vi.hoisted(() => ({
  open: false,
  stage: "build" as "build" | "deploy",
  attempted: false,
  canPass: false,
  pass: vi.fn(),
  execute: vi.fn(() => Promise.resolve()),
}));

// The runtime's commands reach the utils barrel, which needs the build's
// globals; what is under test is which command the reply's button runs
vi.mock("../../../utils/command", () => ({
  PgCommand: {
    build: { execute: lesson.execute },
    deploy: { execute: lesson.execute },
  },
}));
// The lesson store reaches the same barrel. Its folds stand in for a lesson
// whose current step is verified by `lesson.stage`.
vi.mock("../../../views/flow/lessons", () => ({
  INITIAL_LESSON_STATE: { path: null, record: [] },
  PgLesson: {
    onDidChange: (cb: (state: unknown) => void) => {
      cb(lesson.open ? { path: {}, record: [] } : { path: null, record: [] });
      return { dispose: () => {} };
    },
    canPass: () => lesson.canPass,
    pass: lesson.pass,
  },
  foldRecord: () => ({}),
  cursorStep: () => ({ id: "step-1", verify: {} }),
  verifyingStage: () => lesson.stage,
  attempted: () => lesson.attempted,
}));
vi.mock("../../../views/sidebar/assistant/bridge/lesson-context", () => ({
  describeLesson: (state: { path: unknown }) =>
    state.path ? { verifiedBy: "A build proves this step" } : null,
}));
// Undo reads and writes the project through the real bridge, which reaches
// the same barrel; the thread only decides when to offer it and what to report
const undo = vi.hoisted(() => ({
  can: vi.fn(() => false),
  original: vi.fn((): string | null => null),
  undo: vi.fn(
    async (): Promise<
      import("../../../views/sidebar/assistant/patch-undo").UndoResult
    > => "undone"
  ),
}));
vi.mock("../../../views/sidebar/assistant/patch-undo", () => ({
  PgPatchUndo: undo,
}));
vi.mock("../../../components/Markdown", () => ({
  default: ({ children }: { children: string }) => <p>{children}</p>,
}));

let events: ReturnType<typeof memoryTelemetry>;

const tracked = () => events.events.map((e) => [e.name, e.params]);

/** The part of the turn the thread uses; the rest is the composer's */
const stubTurn = (busy: boolean, send: Turn["send"] = vi.fn()) =>
  ({ busy, send } as unknown as Turn);

const PATCH = {
  type: "patch" as const,
  path: "src/lib.rs",
  before: "a",
  after: "b",
};

/** A finished reply with `text`, after a user message */
const finishedReply = (text: string) => {
  PgAssistant.addUserMessage("How do I add a counter?");
  const id = PgAssistant.startAssistantMessage();
  PgAssistant.appendToAssistantMessage(id, text);
  PgAssistant.setStatus("idle");
};

/** A turn that wrote a patch the user applied, then replied */
const appliedPatchThenReply = () => {
  PgAssistant.addUserMessage("Fix it");
  PgAssistant.requestApproval(PATCH);
  PgAssistant.resolveApproval(PgAssistant.items[1].id, true);
  const id = PgAssistant.startAssistantMessage();
  PgAssistant.appendToAssistantMessage(id, "Done.");
  PgAssistant.setStatus("idle");
};

beforeEach(() => {
  events = memoryTelemetry();
  initTelemetry({ providers: [events] });
  lesson.open = false;
  lesson.stage = "build";
  lesson.attempted = false;
  lesson.canPass = false;
  PgAssistant.clear();
});

afterEach(() => {
  undo.original.mockReturnValue(null);
  // The thread is still mounted here: RTL's own cleanup runs after this hook
  act(() => PgAssistant.clear());
  resetTelemetry();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("Thread, an unreadable thread", () => {
  it("says nothing typed here is saved", () => {
    vi.spyOn(PgAssistant, "unsaved", "get").mockReturnValue(true);
    render(<Thread turn={stubTurn(false)} project="Counter" />);
    expect(screen.getByRole("status").textContent).toBe(THREAD_NOT_SAVED);
  });
});

describe("Thread, approvals", () => {
  it("answering a card resolves it once and reports it once", () => {
    act(() => {
      PgAssistant.requestApproval(PATCH);
    });
    render(<Thread turn={stubTurn(true)} project="Counter" />);

    const apply = screen.getByRole("button", { name: "Apply" });
    act(() => {
      apply.click();
      apply.click();
    });

    const card = PgAssistant.items.find((i) => i.kind === "approval");
    expect(card?.kind === "approval" && card.status).toBe("allowed");
    expect(tracked()).toEqual([
      ["assistant_approval_answered", { kind: "patch", answer: "allow" }],
    ]);
  });

  it("denying a command is reported as a denied command", () => {
    act(() => {
      PgAssistant.requestApproval({
        type: "command",
        name: "build",
        effect: "Compiles the program",
      });
    });
    render(<Thread turn={stubTurn(true)} project="Counter" />);

    fireEvent.click(screen.getByRole("button", { name: "Deny" }));

    const card = PgAssistant.items.find((i) => i.kind === "approval");
    expect(card?.kind === "approval" && card.status).toBe("denied");
    expect(tracked()).toEqual([
      ["assistant_approval_answered", { kind: "command", answer: "deny" }],
    ]);
  });
});

describe("Thread, undo", () => {
  const applied = () => {
    act(() => {
      PgAssistant.requestApproval(PATCH);
      PgAssistant.resolveApproval(PgAssistant.items[0].id, true);
    });
  };

  it("offers Undo patch on a card it can take back, and reports the undo once", async () => {
    undo.can.mockReturnValue(true);
    applied();
    render(<Thread turn={stubTurn(false)} project="Counter" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo patch" }));
    });

    expect(undo.undo).toHaveBeenCalledWith(PgAssistant.items[0]);
    expect(tracked()).toEqual([["assistant_patch_undone", { via: "card" }]]);
  });

  it("reports nothing when the file moved on", async () => {
    undo.can.mockReturnValue(true);
    undo.undo.mockResolvedValueOnce("moved-on");
    applied();
    render(<Thread turn={stubTurn(false)} project="Counter" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo patch" }));
    });

    expect(tracked()).toEqual([]);
  });

  it("reports a failed Undo on the button and counts no undo", async () => {
    const report = vi.fn();
    const reportFor = vi
      .spyOn(reportModule, "reportButtonFailure")
      .mockReturnValue(report);
    const failure = new Error("the write failed");
    undo.can.mockReturnValue(true);
    undo.undo.mockRejectedValueOnce(failure);
    applied();
    render(<Thread turn={stubTurn(false)} project="Counter" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo patch" }));
    });

    expect(reportFor).toHaveBeenCalledWith("undo the patch");
    expect(report).toHaveBeenCalledWith(failure);
    expect(tracked()).toEqual([]);
    reportFor.mockRestore();
  });

  it("offers the original to copy on a card whose Undo could not finish", () => {
    undo.original.mockReturnValue("old");
    applied();
    render(
      <TooltipProvider>
        <Thread turn={stubTurn(false)} project="Counter" />
      </TooltipProvider>
    );
    expect(
      screen.getByRole("button", { name: "Copy the original" })
    ).toBeTruthy();
  });

  it("offers nothing to copy on a card whose Undo did not strand", () => {
    applied();
    render(<Thread turn={stubTurn(false)} project="Counter" />);
    expect(
      screen.queryByRole("button", { name: "Copy the original" })
    ).toBeNull();
  });

  it("offers no Undo patch on a card it cannot take back", () => {
    undo.can.mockReturnValue(false);
    applied();
    render(<Thread turn={stubTurn(false)} project="Counter" />);
    expect(screen.queryByRole("button", { name: "Undo patch" })).toBeNull();
  });
});

describe("Thread, try again", () => {
  const stopped = () => {
    PgAssistant.addUserMessage("What does this program do?");
    const id = PgAssistant.startAssistantMessage();
    PgAssistant.appendToAssistantMessage(id, "The program");
    PgAssistant.addNotice("Stopped.");
  };

  it("after Stop sends the last message again and reports it", () => {
    stopped();
    const send = vi.fn();
    render(<Thread turn={stubTurn(false, send)} project="Counter" />);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(send).toHaveBeenCalledWith("What does this program do?");
    expect(tracked()).toEqual([
      ["assistant_reply_retried", { after: "stopped" }],
    ]);
  });

  it("after a cut-off reply sends the last message again", () => {
    PgAssistant.addUserMessage("What does this program do?");
    const id = PgAssistant.startAssistantMessage();
    PgAssistant.appendToAssistantMessage(id, "The program");
    PgAssistant.markCutOff(id);
    const send = vi.fn();
    render(<Thread turn={stubTurn(false, send)} project="Counter" />);

    expect(screen.getByText("This reply was cut off.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(send).toHaveBeenCalledWith("What does this program do?");
    expect(tracked()).toEqual([
      ["assistant_reply_retried", { after: "interrupted" }],
    ]);
  });

  it("after the connection dropped with no reply sends the last message again", () => {
    PgAssistant.addUserMessage("What does this program do?");
    PgAssistant.addError(CONNECTION_LOST);
    const send = vi.fn();
    render(<Thread turn={stubTurn(false, send)} project="Counter" />);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(send).toHaveBeenCalledWith("What does this program do?");
    expect(tracked()).toEqual([
      ["assistant_reply_retried", { after: "interrupted" }],
    ]);
  });

  it("offers no Try again once the turn applied a change", () => {
    PgAssistant.addUserMessage("Rename the counter");
    void PgAssistant.requestApproval({
      type: "patch",
      path: "src/lib.rs",
      before: "old",
      after: "new",
    });
    PgAssistant.resolveApproval(PgAssistant.items.at(-1)!.id, true);
    PgAssistant.addError(CONNECTION_LOST);
    render(<Thread turn={stubTurn(false)} project="Counter" />);

    // Sent again, the same request would propose the applied patch once more
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("offers no Try again under any other error", () => {
    PgAssistant.addUserMessage("What does this program do?");
    PgAssistant.addError("The model declined this request.");
    render(<Thread turn={stubTurn(false)} project="Counter" />);

    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("is not offered while a turn runs", () => {
    stopped();
    render(<Thread turn={stubTurn(true)} project="Counter" />);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("is not offered once the conversation moved on", () => {
    stopped();
    PgAssistant.addUserMessage("Something else");
    render(<Thread turn={stubTurn(false)} project="Counter" />);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

describe("Thread, the working marker", () => {
  const marker = () =>
    screen.queryByRole("status", { name: "Assistant is working" });

  it("shows while a running turn has streamed nothing", () => {
    act(() => {
      PgAssistant.addUserMessage("Hi");
      PgAssistant.startAssistantMessage();
      PgAssistant.setStatus("running");
    });
    render(<Thread turn={stubTurn(true)} project="Counter" />);
    expect(marker()).toBeTruthy();
  });

  it("shows while a tool runs after part of the reply", () => {
    act(() => {
      PgAssistant.addUserMessage("Hi");
      const id = PgAssistant.startAssistantMessage();
      PgAssistant.appendToAssistantMessage(id, "Let me look.");
      PgAssistant.addToolCall("Read src/lib.rs");
      PgAssistant.setStatus("running");
    });
    render(<Thread turn={stubTurn(true)} project="Counter" />);
    expect(marker()).toBeTruthy();
  });

  it("comes down once text streams into the reply", () => {
    act(() => {
      PgAssistant.addUserMessage("Hi");
      const id = PgAssistant.startAssistantMessage();
      PgAssistant.appendToAssistantMessage(id, "Hello");
      PgAssistant.setStatus("running");
    });
    render(<Thread turn={stubTurn(true)} project="Counter" />);
    expect(marker()).toBeNull();
  });
});

describe("Thread, a refused key", () => {
  const RECOVER = { provider: "openai" as const, model: "gpt-x" };
  const withOpener = (openConnect: Turn["openConnect"]) =>
    ({ busy: false, send: vi.fn(), openConnect } as unknown as Turn);

  it("offers Enter key on the error, opening Connect on that backend", () => {
    act(() => {
      PgAssistant.addUserMessage("hi");
      PgAssistant.addError(
        "OpenAI-compatible did not accept this key.",
        RECOVER
      );
    });
    const openConnect = vi.fn();
    render(<Thread turn={withOpener(openConnect)} project="Counter" />);

    fireEvent.click(screen.getByRole("button", { name: "Enter key" }));

    expect(openConnect).toHaveBeenCalledWith("key-rejected", RECOVER);
  });

  it("offers nothing once a reply came after the error", () => {
    act(() => {
      PgAssistant.addUserMessage("hi");
      PgAssistant.addError(
        "OpenAI-compatible did not accept this key.",
        RECOVER
      );
    });
    act(() => finishedReply("Hello."));
    render(<Thread turn={withOpener(vi.fn())} project="Counter" />);

    expect(screen.queryByRole("button", { name: "Enter key" })).toBeNull();
  });

  it("offers nothing for a backend this build does not have", () => {
    act(() => {
      PgAssistant.addUserMessage("hi");
      PgAssistant.addError("Gone did not accept this key.", {
        provider: "gone" as typeof RECOVER.provider,
      });
    });
    render(<Thread turn={withOpener(vi.fn())} project="Counter" />);

    expect(screen.queryByRole("button", { name: "Enter key" })).toBeNull();
  });
});

describe("Thread, sending", () => {
  it("a suggestion sends and is reported", () => {
    const send = vi.fn().mockResolvedValue(undefined);
    render(<Thread turn={stubTurn(false, send)} project="Counter" />);

    fireEvent.click(
      screen.getByRole("button", { name: "Why did my build fail?" })
    );

    expect(send).toHaveBeenCalledWith("Why did my build fail?");
    expect(tracked()).toEqual([["assistant_suggestion_picked", {}]]);
  });

  it("offers the lesson's questions while a lesson is open", () => {
    lesson.open = true;
    const send = vi.fn().mockResolvedValue(undefined);
    render(<Thread turn={stubTurn(false, send)} project="Hello Anchor" />);
    for (const name of [
      "Explain this step",
      "Give me a hint",
      "Why did my build fail?",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(
      screen.queryByRole("button", { name: "What does this program do?" })
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Give me a hint" }));
    expect(send).toHaveBeenCalledWith("Give me a hint");
    expect(tracked()).toEqual([["assistant_suggestion_picked", {}]]);
  });

  it("make this change asks for a patch and is reported", () => {
    act(() => finishedReply("Add a field to the account."));
    const send = vi.fn().mockResolvedValue(undefined);
    render(<Thread turn={stubTurn(false, send)} project="Counter" />);

    fireEvent.click(screen.getByRole("button", { name: "Make this change" }));

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatch(/^Write this change for me/);
    expect(tracked()).toEqual([["assistant_make_change_requested", {}]]);
  });

  it("no make-change while a turn runs", () => {
    act(() => finishedReply("Add a field to the account."));
    render(<Thread turn={stubTurn(true)} project="Counter" />);
    expect(
      screen.queryByRole("button", { name: "Make this change" })
    ).toBeNull();
  });

  it("make-change only on the newest reply", () => {
    act(() => {
      finishedReply("First answer.");
      finishedReply("Second answer.");
    });
    render(<Thread turn={stubTurn(false)} project="Counter" />);
    expect(
      screen.getAllByRole("button", { name: "Make this change" })
    ).toHaveLength(1);
  });

  it("no make-change on a turn that wrote a patch", () => {
    act(() => appliedPatchThenReply());
    render(<Thread turn={stubTurn(false)} project="Counter" />);
    expect(
      screen.queryByRole("button", { name: "Make this change" })
    ).toBeNull();
  });
});

describe("Thread, inside a lesson", () => {
  it("make-change is offered as a last resort", () => {
    lesson.open = true;
    act(() => finishedReply("Here is a hint."));
    render(<Thread turn={stubTurn(false)} project="Counter" />);
    expect(
      screen.getByRole("button", { name: "Write it for me" })
    ).toBeTruthy();
  });

  it("after an applied patch the move is the step's build", async () => {
    lesson.open = true;
    act(() => appliedPatchThenReply());
    render(<Thread turn={stubTurn(false)} project="Counter" />);

    // Async: Build is an AsyncButton, which settles once the command resolves
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Build" }));
    });

    expect(lesson.execute).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Skip this step" })).toBeNull();
  });

  it("a step verified by a deploy offers Deploy", () => {
    lesson.open = true;
    lesson.stage = "deploy";
    act(() => appliedPatchThenReply());
    render(<Thread turn={stubTurn(false)} project="Counter" />);
    expect(screen.getByRole("button", { name: "Deploy" })).toBeTruthy();
  });

  it("an attempted step that can pass offers the skip, and only that", () => {
    lesson.open = true;
    lesson.attempted = true;
    lesson.canPass = true;
    act(() => appliedPatchThenReply());
    render(<Thread turn={stubTurn(false)} project="Counter" />);

    fireEvent.click(screen.getByRole("button", { name: "Skip this step" }));

    expect(lesson.pass).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Build" })).toBeNull();
  });

  it("an attempted step that cannot pass offers neither", () => {
    lesson.open = true;
    lesson.attempted = true;
    act(() => appliedPatchThenReply());
    render(<Thread turn={stubTurn(false)} project="Counter" />);
    expect(screen.queryByRole("button", { name: "Skip this step" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Build" })).toBeNull();
  });

  it("no lesson move while a turn runs", () => {
    lesson.open = true;
    act(() => appliedPatchThenReply());
    render(<Thread turn={stubTurn(true)} project="Counter" />);
    expect(screen.queryByRole("button", { name: "Build" })).toBeNull();
  });
});
