// The thread: its scroller, its empty state and the working marker.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BaseThread } from "./BaseThread";
import type { BusyRetryView } from "./BaseThread";
import { THREAD_NOT_SAVED } from "../../../views/sidebar/assistant/store";
import type { ChatItem } from "../../../views/sidebar/assistant/store";

vi.mock("../../../components/Markdown", () => ({
  default: ({ children }: { children: string }) => <p>{children}</p>,
}));

const CREATED = "2026-10-19T00:00:00.000Z";
const SUGGESTIONS = ["What does this program do?", "Why did my build fail?"];

const renderThread = (
  items: readonly ChatItem[],
  overrides: {
    working?: boolean;
    unsaved?: boolean;
    project?: string | null;
    onSuggestion?: (text: string) => void;
    retry?: BusyRetryView;
  } = {}
) =>
  render(
    <BaseThread
      items={items}
      working={overrides.working ?? false}
      unsaved={overrides.unsaved ?? false}
      project={overrides.project === undefined ? "Counter" : overrides.project}
      suggestions={SUGGESTIONS}
      onSuggestion={overrides.onSuggestion ?? vi.fn()}
      actionsFor={() => undefined}
      onAnswer={vi.fn()}
      retry={overrides.retry}
    />
  );

describe("BaseThread", () => {
  it("the thread is the conversation log", () => {
    renderThread([]);
    expect(screen.getByRole("log", { name: "Conversation" })).toBeTruthy();
  });

  it("an empty thread asks about the project", () => {
    renderThread([]);
    expect(
      screen.getByRole("heading", { name: "Ask about Counter", level: 3 })
    ).toBeTruthy();
  });

  it("an empty thread with no project asks about nothing in particular", () => {
    renderThread([], { project: null });
    expect(
      screen.getByRole("heading", { name: "Ask the assistant", level: 3 })
    ).toBeTruthy();
  });

  it("an unreadable thread says nothing typed here is saved", () => {
    renderThread([], { unsaved: true });
    const notice = screen.getByRole("status");
    expect(notice.textContent).toBe(THREAD_NOT_SAVED);
    expect(
      screen.getByRole("log", { name: "Conversation" }).contains(notice)
    ).toBe(true);
  });

  it("a readable thread says nothing about saving", () => {
    renderThread([]);
    expect(screen.queryByText(THREAD_NOT_SAVED)).toBeNull();
  });

  it("lays the suggestions out as a row that wraps", () => {
    renderThread([]);
    const suggestion = screen.getByRole("button", {
      name: "Why did my build fail?",
    });
    expect(suggestion.parentElement?.className).toContain("flex-wrap");
  });

  it("a suggestion sends itself", () => {
    const onSuggestion = vi.fn();
    renderThread([], { onSuggestion });
    fireEvent.click(
      screen.getByRole("button", { name: "Why did my build fail?" })
    );
    expect(onSuggestion).toHaveBeenCalledWith("Why did my build fail?");
  });

  it("working shows while nothing has streamed", () => {
    renderThread(
      [{ id: "u-1", createdAt: CREATED, kind: "user", text: "Hi" }],
      { working: true }
    );
    expect(
      screen.getByRole("status", { name: "Assistant is working" })
    ).toBeTruthy();
  });

  it("no working marker once the turn is over", () => {
    renderThread([{ id: "u-1", createdAt: CREATED, kind: "user", text: "Hi" }]);
    expect(
      screen.queryByRole("status", { name: "Assistant is working" })
    ).toBeNull();
  });

  describe("a busy model (Spec 08 AI-03)", () => {
    const USER_ITEM: ChatItem = {
      kind: "user",
      id: "u1",
      createdAt: CREATED,
      text: "hi",
    };
    const busy = (canTryNow: boolean) => ({
      secondsLeft: 7,
      canTryNow,
      onTryNow: vi.fn(),
      onStop: vi.fn(),
    });

    it("counts down under the message with Try now and Stop", () => {
      const retry = busy(true);
      renderThread([USER_ITEM], { retry });

      expect(screen.getByText("The model is busy")).toBeTruthy();
      expect(screen.getByText("Trying again in 7 s.")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Try now" }));
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
      expect(retry.onTryNow).toHaveBeenCalled();
      expect(retry.onStop).toHaveBeenCalled();
    });

    it("keeps Try now off while the server's wait runs", () => {
      renderThread([USER_ITEM], { retry: busy(false) });

      expect(
        (screen.getByRole("button", { name: "Try now" }) as HTMLButtonElement)
          .disabled
      ).toBe(true);
    });

    it("says nothing about it when no message waits", () => {
      renderThread([USER_ITEM]);

      expect(screen.queryByText("The model is busy")).toBeNull();
    });
  });

  it("every item is a scroller item", () => {
    const { container } = renderThread([
      { id: "u-1", createdAt: CREATED, kind: "user", text: "Hi" },
      { id: "a-1", createdAt: CREATED, kind: "assistant", text: "Hello" },
    ]);
    expect(
      container.querySelectorAll("[data-slot=message-scroller-item]")
    ).toHaveLength(2);
  });
});
