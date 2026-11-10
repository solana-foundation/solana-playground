// The connected thread: the store's items, the turn's send, and what is
// reported when the user acts on them.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/features/auth";
import { PgSession } from "@/features/auth";
import { PgSyncClient } from "@/features/persistence";
import {
  initLogger,
  memoryProvider as logMemory,
  resetLogger,
} from "@/shared/lib/logger";
import * as reportModule from "@/shared/lib/report-button-failure";
import {
  initTelemetry,
  memoryProvider as memoryTelemetry,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import { TooltipProvider } from "@/shared/ui/tooltip";

import {
  CONNECTION_LOST,
  PgAssistant,
  THREAD_NOT_SAVED,
} from "../../../views/sidebar/assistant/store";
import type { DefaultBackend } from "../model/default-backend";
import type { Turn } from "../model/use-turn";
import { Thread } from "./Thread";

// The probe is the deployment's; a test says what it answered
let backend: DefaultBackend = { state: "absent" };
vi.mock("../model/default-backend", () => ({
  useDefaultBackend: () => backend,
}));

// Undo reads and writes the project through the real bridge, which reaches
// the utils barrel; the thread only decides when to offer it and what to report
const undo = vi.hoisted(() => ({
  can: vi.fn(() => false),
  original: vi.fn((): string | undefined => undefined),
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

/** A reply that proposes code, the kind "Make this change" turns into a patch */
const CHANGE_REPLY =
  "Add a field to the account:\n\n```rust\npub count: u64,\n```";

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
  PgAssistant.clear();
});

afterEach(() => {
  undo.original.mockReturnValue(undefined);
  // The thread is still mounted here: RTL's own cleanup runs after this hook
  act(() => PgAssistant.clear());
  act(() => PgAssistant.disconnect());
  PgSession.reset();
  backend = { state: "absent" };
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
  const SIGNED_OUT: SessionUser | undefined = undefined;

  /** Who is signed in, and a way to change it the way `PgSession` would */
  const session = (initial: SessionUser | undefined) => {
    let user = initial;
    const listeners = new Set<() => void>();
    vi.spyOn(PgSession, "get").mockImplementation(() => user);
    vi.spyOn(PgSession, "afterFirstRead").mockResolvedValue(undefined);
    vi.spyOn(PgSession, "onDidChange").mockImplementation((cb) => {
      listeners.add(cb as () => void);
      return { dispose: () => listeners.delete(cb as () => void) };
    });
    return (next: SessionUser | undefined) => {
      user = next;
      listeners.forEach((cb) => cb());
    };
  };

  const syncs = (available: boolean) =>
    vi.spyOn(PgSyncClient, "available").mockResolvedValue(available);

  it("a conversation ends in an offer to sign in", async () => {
    session(SIGNED_OUT);
    syncs(true);
    act(() => {
      PgAssistant.addUserMessage("Hi");
    });
    render(<Thread turn={stubTurn(false)} project="Counter" />);
    expect(await screen.findByText(SIGN_IN_TO_KEEP)).toBeTruthy();
  });

  it("signing in from the offer stays in the project and is reported", async () => {
    session(SIGNED_OUT);
    syncs(true);
    const signIn = vi
      .fn<(scopes: string[]) => Promise<void>>()
      .mockResolvedValue();
    const signInFor = vi.spyOn(PgSession, "signInFor").mockReturnValue(signIn);
    act(() => {
      PgAssistant.addUserMessage("Hi");
    });
    render(<Thread turn={stubTurn(false)} project="Counter" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Sign in with GitHub" })
    );
    expect(signInFor).toHaveBeenCalledWith("assistant");
    expect(signIn).toHaveBeenCalledWith([]);
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

    act(() => setUser(SIGNED_OUT));
    expect(await screen.findByText(SIGN_IN_TO_KEEP)).toBeTruthy();
  });

  // The session effect's own read is what tells it the account signed in; a
  // read started by the panel, which can mount first, hid that from it
  it("never starts the session read itself", async () => {
    session(SIGNED_OUT);
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
    vi.spyOn(PgSession, "afterFirstRead").mockReturnValue(
      new Promise<void>((resolve) => (answer = resolve))
    );
    // Before the read `get()` is `undefined` for everyone
    vi.spyOn(PgSession, "get").mockReturnValue(SIGNED_OUT);
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
    const setUser = session(SIGNED_OUT);
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
    act(() => setUser(SIGNED_OUT));
    expect(button.disabled).toBe(false);
  });

  it("signing in takes the offer away", async () => {
    const setUser = session(SIGNED_OUT);
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
    session(SIGNED_OUT);
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
    vi.spyOn(PgSession, "signInFor").mockReturnValue(
      vi
        .fn<(scopes: string[]) => Promise<void>>()
        .mockRejectedValueOnce(cancelled)
        .mockRejectedValueOnce(broken)
    );
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
    session(SIGNED_OUT);
    syncs(true);
    render(<Thread turn={stubTurn(false)} project="Counter" />);
    await act(async () => {});
    expect(screen.queryByText(SIGN_IN_TO_KEEP)).toBeNull();
  });

  it("a deployment without sync offers nothing", async () => {
    session(SIGNED_OUT);
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
      ["assistant_approval_answered", { kind: "patch", decision: "allow" }],
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
      ["assistant_approval_answered", { kind: "command", decision: "deny" }],
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
    const card = PgAssistant.items.at(-1);
    if (!card) throw new Error("the thread is empty");
    PgAssistant.resolveApproval(card.id, true);
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
  const REFUSED = "OpenAI did not accept this key.";
  const withOpener = (openConnect: Turn["openConnect"]) =>
    ({ busy: false, send: vi.fn(), openConnect } as unknown as Turn);
  /** A turn whose composer reads `input`, for Use hosted model to fill */
  const withInput = (input: string, setInput: Turn["setInput"]) =>
    ({
      busy: false,
      send: vi.fn(),
      openConnect: vi.fn(),
      input,
      setInput,
    } as unknown as Turn);
  const refuse = () =>
    act(() => {
      PgAssistant.addUserMessage("hi");
      PgAssistant.addErrorWith(RECOVER)(REFUSED);
    });
  const hosted = () => {
    backend = { state: "present", model: "z-ai/glm-5.3-flash:US" };
  };
  const signIn = () =>
    act(() =>
      PgSession.refreshWith({
        id: "u1",
        name: undefined,
        image: undefined,
        login: undefined,
      })
    );

  it("offers Change key on the error, opening Connect on that backend", () => {
    refuse();
    const openConnect = vi.fn();
    render(<Thread turn={withOpener(openConnect)} project="Counter" />);

    fireEvent.click(screen.getByRole("button", { name: "Change key" }));

    expect(openConnect).toHaveBeenCalledWith("key-rejected", RECOVER);
  });

  it("offers no hosted model on a deployment without one", () => {
    refuse();
    render(<Thread turn={withOpener(vi.fn())} project="Counter" />);

    expect(
      screen.queryByRole("button", { name: "Use hosted model" })
    ).toBeNull();
  });

  it("moves the thread to the hosted model, sends nothing and puts the message back", async () => {
    hosted();
    await signIn();
    refuse();
    const setInput = vi.fn();
    const turn = withInput("", setInput);
    render(<Thread turn={turn} project="Counter" />);

    fireEvent.click(screen.getByRole("button", { name: "Use hosted model" }));

    expect(PgAssistant.connection).toMatchObject({ id: "default" });
    expect(turn.send).not.toHaveBeenCalled();
    expect(setInput).toHaveBeenCalledWith("hi");
    expect(tracked()).toContainEqual([
      "assistant_model_picked",
      { provider: "default", via: "key-rejected" },
    ]);
  });

  it("leaves a draft in the composer as it is", async () => {
    hosted();
    await signIn();
    refuse();
    const setInput = vi.fn();
    render(<Thread turn={withInput("draft", setInput)} project="Counter" />);

    fireEvent.click(screen.getByRole("button", { name: "Use hosted model" }));

    expect(setInput).not.toHaveBeenCalled();
  });

  it("opens Connect on the hosted model for a signed-out user", () => {
    hosted();
    refuse();
    const openConnect = vi.fn();
    render(<Thread turn={withOpener(openConnect)} project="Counter" />);

    fireEvent.click(screen.getByRole("button", { name: "Use hosted model" }));

    expect(openConnect).toHaveBeenCalledWith("use-hosted", {
      provider: "default",
    });
    expect(PgAssistant.connection).toBeNull();
  });

  it("drops both buttons once the thread moved, so a pick counts once", async () => {
    hosted();
    await signIn();
    refuse();
    render(<Thread turn={withInput("", vi.fn())} project="Counter" />);

    fireEvent.click(screen.getByRole("button", { name: "Use hosted model" }));

    expect(
      screen.queryByRole("button", { name: "Use hosted model" })
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Change key" })).toBeNull();
    expect(
      tracked().filter(([name]) => name === "assistant_model_picked")
    ).toHaveLength(1);
  });

  it("drops Change key once the thread moved to another key's backend", () => {
    act(() =>
      PgAssistant.connect({
        id: "anthropic",
        model: "claude-x",
        apiKey: "sk-test",
      } as Parameters<typeof PgAssistant.connect>[0])
    );
    refuse();
    render(<Thread turn={withOpener(vi.fn())} project="Counter" />);

    expect(screen.queryByRole("button", { name: "Change key" })).toBeNull();
  });

  it("keeps Change key while the refused backend is still connected", () => {
    act(() =>
      PgAssistant.connect({
        id: "openai",
        model: "gpt-x",
        apiKey: "sk-test",
      } as Parameters<typeof PgAssistant.connect>[0])
    );
    refuse();
    render(<Thread turn={withOpener(vi.fn())} project="Counter" />);

    expect(screen.getByRole("button", { name: "Change key" })).toBeTruthy();
  });

  it("offers nothing once a reply came after the error", () => {
    hosted();
    refuse();
    act(() => finishedReply("Hello."));
    render(<Thread turn={withOpener(vi.fn())} project="Counter" />);

    expect(screen.queryByRole("button", { name: "Change key" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Use hosted model" })
    ).toBeNull();
  });

  it("offers nothing for a backend this build does not have", () => {
    act(() => {
      PgAssistant.addUserMessage("hi");
      PgAssistant.addErrorWith({
        provider: "gone" as typeof RECOVER.provider,
      })("Gone did not accept this key.");
    });
    render(<Thread turn={withOpener(vi.fn())} project="Counter" />);

    expect(screen.queryByRole("button", { name: "Change key" })).toBeNull();
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

  it("make this change asks for a patch and is reported", () => {
    act(() => finishedReply(CHANGE_REPLY));
    const send = vi.fn().mockResolvedValue(undefined);
    render(<Thread turn={stubTurn(false, send)} project="Counter" />);

    fireEvent.click(screen.getByRole("button", { name: "Make this change" }));

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatch(/^Write this change for me/);
    expect(tracked()).toEqual([["assistant_make_change_requested", {}]]);
  });

  it("no make-change under an explanation", () => {
    act(() =>
      finishedReply(
        "This account holds 2.5 SOL and the System Program owns it."
      )
    );
    render(<Thread turn={stubTurn(false)} project="Counter" />);
    expect(
      screen.queryByRole("button", { name: "Make this change" })
    ).toBeNull();
  });

  it("no make-change under a command to run", () => {
    act(() => finishedReply("Run this:\n\n```bash\nanchor build\n```"));
    render(<Thread turn={stubTurn(false)} project="Counter" />);
    expect(
      screen.queryByRole("button", { name: "Make this change" })
    ).toBeNull();
  });

  it("no make-change while a turn runs", () => {
    act(() => finishedReply(CHANGE_REPLY));
    render(<Thread turn={stubTurn(true)} project="Counter" />);
    expect(
      screen.queryByRole("button", { name: "Make this change" })
    ).toBeNull();
  });

  it("make-change only on the newest reply", () => {
    act(() => {
      finishedReply(CHANGE_REPLY);
      finishedReply(CHANGE_REPLY);
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
