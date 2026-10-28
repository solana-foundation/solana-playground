// The thread: its scroller, its empty state and the working marker.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BaseThread } from "./BaseThread";
import { THREAD_NOT_SAVED } from "../../../views/sidebar/assistant/store";
import type { ChatItem } from "../../../views/sidebar/assistant/store";

const { scrollToEnd } = vi.hoisted(() => ({ scrollToEnd: vi.fn() }));

// The real scroller renders; only the handle `FollowOnSend` calls is watched,
// since jsdom has no layout to scroll
vi.mock("@/shared/ui/message-scroller", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/shared/ui/message-scroller")
  >();
  return {
    MessageScrollerProvider: actual.MessageScrollerProvider,
    MessageScroller: actual.MessageScroller,
    MessageScrollerViewport: actual.MessageScrollerViewport,
    MessageScrollerContent: actual.MessageScrollerContent,
    MessageScrollerItem: actual.MessageScrollerItem,
    MessageScrollerButton: actual.MessageScrollerButton,
    useMessageScroller: () => ({
      scrollToEnd,
      scrollToMessage: vi.fn(),
      scrollToStart: vi.fn(),
    }),
    useMessageScrollerScrollable: actual.useMessageScrollerScrollable,
    useMessageScrollerVisibility: actual.useMessageScrollerVisibility,
  };
});

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
    />
  );

const user = (id: string): ChatItem => ({
  id,
  createdAt: CREATED,
  kind: "user",
  text: id,
});
const reply = (id: string): ChatItem => ({
  id,
  createdAt: CREATED,
  kind: "assistant",
  text: id,
});

const threadOf = (items: readonly ChatItem[], working: boolean) => (
  <BaseThread
    items={items}
    working={working}
    unsaved={false}
    project="Counter"
    suggestions={SUGGESTIONS}
    onSuggestion={vi.fn()}
    actionsFor={() => undefined}
    onAnswer={vi.fn()}
  />
);

describe("BaseThread: following a message the user sends", () => {
  beforeEach(() => scrollToEnd.mockClear());

  it("opening a thread does not scroll it", () => {
    render(threadOf([user("u-1"), reply("a-1")], false));
    expect(scrollToEnd).not.toHaveBeenCalled();
  });

  it("a message sent as a turn starts scrolls to the end once", () => {
    const { rerender } = render(threadOf([user("u-1"), reply("a-1")], false));
    rerender(threadOf([user("u-1"), reply("a-1"), user("u-2")], true));
    rerender(
      threadOf([user("u-1"), reply("a-1"), user("u-2"), reply("a-2")], true)
    );
    expect(scrollToEnd).toHaveBeenCalledTimes(1);
  });

  it("a message folded in from another device does not scroll", () => {
    const { rerender } = render(threadOf([user("u-1"), reply("a-1")], false));
    rerender(threadOf([user("u-1"), reply("a-1"), user("u-2")], false));
    // Nor does it later, once this tab starts a turn of its own on it
    rerender(threadOf([user("u-1"), reply("a-1"), user("u-2")], true));
    expect(scrollToEnd).not.toHaveBeenCalled();
  });

  it("another thread arriving does not scroll", () => {
    const { rerender } = render(threadOf([], false));
    rerender(threadOf([user("t2-u"), reply("t2-a")], false));
    expect(scrollToEnd).not.toHaveBeenCalled();
  });
});

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
