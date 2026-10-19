// The connected thread: the store's items, the turn's send, and what is
// reported when the user acts on them.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as memoryLog,
  resetLogger,
} from "../../../shared/lib/logger";
import {
  initTelemetry,
  memoryProvider as memoryTelemetry,
  resetTelemetry,
} from "../../../shared/lib/telemetry";
import { PgAssistant } from "../../../views/sidebar/assistant/store";
import type { Turn } from "../model/use-turn";
import { Thread } from "./Thread";

// The runtime's commands reach the utils barrel, which needs the build's
// globals; a lesson's Build or Deploy is not under test here
vi.mock("../../../utils/command", () => ({ PgCommand: {} }));
// The lesson store reaches the same barrel; no lesson is open in these tests
vi.mock("../../../views/flow/lessons", () => ({
  INITIAL_LESSON_STATE: { path: null, record: [] },
  PgLesson: { onDidChange: () => ({ dispose: () => {} }) },
}));
vi.mock("../../../components/Markdown", () => ({
  default: ({ children }: { children: string }) => <p>{children}</p>,
}));

let events: ReturnType<typeof memoryTelemetry>;

const tracked = () => events.events.map((e) => [e.name, e.params]);

/** The part of the turn the thread uses; the rest is the composer's */
const stubTurn = (busy: boolean, send: Turn["send"]) =>
  ({ busy, send } as unknown as Turn);

beforeEach(() => {
  events = memoryTelemetry();
  initTelemetry({ providers: [events] });
  initLogger({ providers: [memoryLog()] });
  PgAssistant.clear();
});

afterEach(() => {
  PgAssistant.clear();
  resetTelemetry();
  resetLogger();
  vi.restoreAllMocks();
});

describe("Thread", () => {
  it("answering a card resolves it once and reports it once", () => {
    let answered: boolean | null = null;
    act(() => {
      PgAssistant.requestApproval({
        type: "patch",
        path: "src/lib.rs",
        before: "a",
        after: "b",
      }).then(({ allowed }) => {
        answered = allowed;
      });
    });
    render(<Thread turn={stubTurn(true, vi.fn())} project="Counter" />);

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
    return Promise.resolve().then(() => expect(answered).toBe(true));
  });

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
    act(() => {
      PgAssistant.addUserMessage("How do I add a counter?");
      const id = PgAssistant.startAssistantMessage();
      PgAssistant.appendToAssistantMessage(id, "Add a field to the account.");
      PgAssistant.setStatus("idle");
    });
    const send = vi.fn().mockResolvedValue(undefined);
    render(<Thread turn={stubTurn(false, send)} project="Counter" />);

    fireEvent.click(screen.getByRole("button", { name: "Make this change" }));

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatch(/^Write this change for me/);
    expect(tracked()).toEqual([["assistant_make_change_requested", {}]]);
  });

  it("no make-change on a turn that wrote a patch", () => {
    act(() => {
      PgAssistant.addUserMessage("Fix it");
      PgAssistant.requestApproval({
        type: "patch",
        path: "src/lib.rs",
        before: "a",
        after: "b",
      });
      PgAssistant.resolveApproval(PgAssistant.items[1].id, true);
      const id = PgAssistant.startAssistantMessage();
      PgAssistant.appendToAssistantMessage(id, "Done.");
      PgAssistant.setStatus("idle");
    });
    render(<Thread turn={stubTurn(false, vi.fn())} project="Counter" />);

    expect(
      screen.queryByRole("button", { name: "Make this change" })
    ).toBeNull();
  });

  it("a failed send is logged, not swallowed", async () => {
    const logs = memoryLog();
    initLogger({ providers: [logs] });
    const send = vi.fn().mockRejectedValue(new Error("offline"));
    render(<Thread turn={stubTurn(false, send)} project="Counter" />);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Why did my build fail?" })
      );
    });

    expect(
      logs.entries.some(
        (e) => e.ns === "assistant:thread" && e.level === "error" && e.report
      )
    ).toBe(true);
  });
});
