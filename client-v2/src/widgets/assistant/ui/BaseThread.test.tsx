// The thread: its scroller, its empty state and the working marker.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BaseThread } from "./BaseThread";
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
    project?: string | null;
    onSuggestion?: (text: string) => void;
  } = {}
) =>
  render(
    <BaseThread
      items={items}
      working={overrides.working ?? false}
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
      screen.getByRole("heading", { name: "Ask about Counter" })
    ).toBeTruthy();
  });

  it("an empty thread with no project asks about nothing in particular", () => {
    renderThread([], { project: null });
    expect(
      screen.getByRole("heading", { name: "Ask the assistant" })
    ).toBeTruthy();
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
