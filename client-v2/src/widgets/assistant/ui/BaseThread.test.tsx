// The thread: its scroller, its empty state and the working marker.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BaseThread } from "./BaseThread";
import { THREAD_NOT_SAVED } from "../../../views/sidebar/assistant/store";
import type { ChatItem } from "../../../views/sidebar/assistant/store";

vi.mock("../../../components/Markdown", () => ({
  default: ({ children }: { children: string }) => <p>{children}</p>,
}));

const CREATED = "2026-10-19T00:00:00.000Z";
const SIGN_IN_TO_KEEP =
  "Sign in to keep this conversation on your other devices.";

const userMessage = (text: string): ChatItem => ({
  kind: "user",
  id: `user-${text}`,
  createdAt: CREATED,
  text,
});

const SUGGESTIONS = ["What does this program do?", "Why did my build fail?"];

const renderThread = (
  items: readonly ChatItem[],
  overrides: {
    working?: boolean;
    unsaved?: boolean;
    signIn?: { pending: boolean; onSignIn: () => void } | null;
    project?: string | null;
    onSuggestion?: (text: string) => void;
  } = {}
) =>
  render(
    <BaseThread
      items={items}
      working={overrides.working ?? false}
      unsaved={overrides.unsaved ?? false}
      signIn={overrides.signIn ?? null}
      project={overrides.project === undefined ? "Counter" : overrides.project}
      suggestions={SUGGESTIONS}
      onSuggestion={overrides.onSuggestion ?? vi.fn()}
      actionsFor={() => undefined}
      onAnswer={vi.fn()}
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

  it("a signed-out thread ends in an offer to sign in", () => {
    const onSignIn = vi.fn();
    renderThread([userMessage("Hi")], {
      signIn: { pending: false, onSignIn },
    });
    const line = screen.getByText(SIGN_IN_TO_KEEP);
    const log = screen.getByRole("log", { name: "Conversation" });
    expect(log.contains(line)).toBe(true);
    // At the foot: after the conversation's last item
    expect(
      screen.getByText("Hi").compareDocumentPosition(line) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Sign in with GitHub" })
    );
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("the offer's button waits while a sign-in is pending", () => {
    renderThread([userMessage("Hi")], {
      signIn: { pending: true, onSignIn: vi.fn() },
    });
    expect(
      (
        screen.getByRole("button", {
          name: "Sign in with GitHub",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it("no offer, no sign-in line", () => {
    renderThread([userMessage("Hi")]);
    expect(screen.queryByText(SIGN_IN_TO_KEEP)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Sign in with GitHub" })
    ).toBeNull();
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
