// The connected thread: the store's items, the lesson's next move, the
// turn's send, and what is reported when the user acts on them.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PgSession } from "@/features/auth";
import type { SessionUser } from "@/features/auth";
import { PgSyncClient } from "@/features/persistence";
import {
  initLogger,
  memoryProvider as logMemory,
  resetLogger,
} from "@/shared/lib/logger";
import {
  initTelemetry,
  memoryProvider as memoryTelemetry,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import {
  PgAssistant,
  THREAD_NOT_SAVED,
} from "../../../views/sidebar/assistant/store";
import type { Turn } from "../model/use-turn";
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

describe("Thread, signed out", () => {
  const SIGN_IN_TO_KEEP =
    "Sign in to keep this conversation on your other devices.";
  const USER = { id: "u1", name: "Ada" } as unknown as SessionUser;

  /** Who is signed in, and a way to change it the way `PgSession` would */
  const session = (initial: SessionUser | null) => {
    let user = initial;
    const listeners = new Set<() => void>();
    vi.spyOn(PgSession, "get").mockImplementation(() => user);
    vi.spyOn(PgSession, "afterRead").mockResolvedValue(undefined);
    vi.spyOn(PgSession, "onDidChange").mockImplementation((cb) => {
      listeners.add(cb as () => void);
      return { dispose: () => listeners.delete(cb as () => void) };
    });
    return (next: SessionUser | null) => {
      user = next;
      listeners.forEach((cb) => cb());
    };
  };

  const syncs = (available: boolean) =>
    vi.spyOn(PgSyncClient, "available").mockResolvedValue(available);

  it("a conversation ends in an offer to sign in", async () => {
    session(null);
    syncs(true);
    act(() => {
      PgAssistant.addUserMessage("Hi");
    });
    render(<Thread turn={stubTurn(false)} project="Counter" />);
    expect(await screen.findByText(SIGN_IN_TO_KEEP)).toBeTruthy();
  });

  it("signing in from the offer stays in the project and is reported", async () => {
    session(null);
    syncs(true);
    const signIn = vi.spyOn(PgSession, "signIn").mockResolvedValue();
    act(() => {
      PgAssistant.addUserMessage("Hi");
    });
    render(<Thread turn={stubTurn(false)} project="Counter" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Sign in with GitHub" })
    );
    expect(signIn).toHaveBeenCalledWith({ from: "assistant" });
    expect(tracked()).toEqual([["assistant_sign_in_offered_clicked", {}]]);
  });

  it("a session that ends shows the offer", async () => {
    const setUser = session(USER);
    syncs(true);
    act(() => {
      PgAssistant.addUserMessage("Hi");
    });
    render(<Thread turn={stubTurn(false)} project="Counter" />);
    await act(async () => {});
    expect(screen.queryByText(SIGN_IN_TO_KEEP)).toBeNull();

    act(() => setUser(null));
    expect(await screen.findByText(SIGN_IN_TO_KEEP)).toBeTruthy();
  });

  // The session effect's own read is what tells it the account signed in; a
  // read started by the panel, which can mount first, hid that from it
  it("never starts the session read itself", async () => {
    session(null);
    syncs(true);
    const whenRead = vi.spyOn(PgSession, "whenRead");
    const refresh = vi.spyOn(PgSession, "refresh");
    act(() => {
      PgAssistant.addUserMessage("Hi");
    });
    render(<Thread turn={stubTurn(false)} project="Counter" />);
    await screen.findByText(SIGN_IN_TO_KEEP);
    expect(whenRead).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("waits for the session read before offering anything", async () => {
    session(USER);
    syncs(true);
    let answer!: () => void;
    vi.spyOn(PgSession, "afterRead").mockReturnValue(
      new Promise<void>((resolve) => (answer = resolve))
    );
    // Before the read `get()` is `null` for everyone
    vi.spyOn(PgSession, "get").mockReturnValue(null);
    act(() => {
      PgAssistant.addUserMessage("Hi");
    });
    render(<Thread turn={stubTurn(false)} project="Counter" />);
    await act(async () => {});
    expect(screen.queryByText(SIGN_IN_TO_KEEP)).toBeNull();

    vi.spyOn(PgSession, "get").mockReturnValue(USER);
    await act(async () => answer());
    expect(screen.queryByText(SIGN_IN_TO_KEEP)).toBeNull();
  });

  it("a sign-in under way holds the button, and its end frees it", async () => {
    const setUser = session(null);
    syncs(true);
    const state = vi
      .spyOn(PgSession, "signInState")
      .mockReturnValue({ status: "pending" });
    act(() => {
      PgAssistant.addUserMessage("Hi");
    });
    render(<Thread turn={stubTurn(false)} project="Counter" />);
    const button = (await screen.findByRole("button", {
      name: "Sign in with GitHub",
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    state.mockReturnValue({ status: "idle" });
    act(() => setUser(null));
    expect(button.disabled).toBe(false);
  });

  it("signing in takes the offer away", async () => {
    const setUser = session(null);
    syncs(true);
    act(() => {
      PgAssistant.addUserMessage("Hi");
    });
    render(<Thread turn={stubTurn(false)} project="Counter" />);
    await screen.findByText(SIGN_IN_TO_KEEP);

    act(() => setUser(USER));
    expect(screen.queryByText(SIGN_IN_TO_KEEP)).toBeNull();
  });

  it("a cancelled sign-in is logged, anything else reported", async () => {
    session(null);
    syncs(true);
    const logged = logMemory();
    initLogger({ providers: [logged] });
    // A real failure at a known step: the server refuses to start the sign-in
    const refused = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: false } as Response);
    const cancelled = await PgSession.signIn().catch((e: unknown) => e);
    refused.mockRestore();
    const broken = new Error("popup threw");
    vi.spyOn(PgSession, "signIn")
      .mockRejectedValueOnce(cancelled)
      .mockRejectedValueOnce(broken);
    act(() => {
      PgAssistant.addUserMessage("Hi");
    });
    render(<Thread turn={stubTurn(false)} project="Counter" />);
    const button = await screen.findByRole("button", {
      name: "Sign in with GitHub",
    });

    fireEvent.click(button);
    fireEvent.click(button);
    await act(async () => {});

    const mine = logged.entries.filter(
      (e) => e.ns === "assistant:sign-in-offer"
    );
    expect(mine).toEqual([
      expect.objectContaining({ level: "info" }),
      expect.objectContaining({ level: "error", error: broken, report: true }),
    ]);
    resetLogger();
  });

  it("an empty thread has nothing to keep", async () => {
    session(null);
    syncs(true);
    render(<Thread turn={stubTurn(false)} project="Counter" />);
    await act(async () => {});
    expect(screen.queryByText(SIGN_IN_TO_KEEP)).toBeNull();
  });

  it("a deployment without sync offers nothing", async () => {
    session(null);
    syncs(false);
    act(() => {
      PgAssistant.addUserMessage("Hi");
    });
    render(<Thread turn={stubTurn(false)} project="Counter" />);
    await act(async () => {});
    expect(screen.queryByText(SIGN_IN_TO_KEEP)).toBeNull();
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
