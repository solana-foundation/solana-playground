// One item of the thread, drawn from the design system's message parts.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BaseThreadItem } from "./BaseThreadItem";
import type { ChatItem } from "../../../views/sidebar/assistant/store";

// Replies render markdown; the text is enough here
vi.mock("../../../components/Markdown", () => ({
  default: ({ children }: { children: string }) => <p>{children}</p>,
}));

const CREATED = "2026-10-19T00:00:00.000Z";

const reply = (text: string): ChatItem => ({
  id: "reply-1",
  createdAt: CREATED,
  kind: "assistant",
  text,
});

describe("BaseThreadItem", () => {
  it("the user's message is a bubble on the right", () => {
    const { container } = render(
      <BaseThreadItem
        item={{ id: "u-1", createdAt: CREATED, kind: "user", text: "Hi" }}
      />
    );
    const bubble = container.querySelector(
      "[data-slot=message][data-align=end] [data-slot=bubble][data-variant=default]"
    );
    expect(bubble?.textContent).toBe("Hi");
  });

  it("a reply is a ghost bubble at full width", () => {
    const { container } = render(
      <BaseThreadItem item={reply("Hello there")} />
    );
    const bubble = container.querySelector(
      "[data-slot=bubble][data-variant=ghost]"
    );
    expect(bubble?.textContent).toBe("Hello there");
  });

  it("an empty reply renders nothing", () => {
    const { container } = render(<BaseThreadItem item={reply("")} />);
    expect(container.innerHTML).toBe("");
  });

  it("a tool line is a marker", () => {
    const { container } = render(
      <BaseThreadItem
        item={{
          id: "t-1",
          createdAt: CREATED,
          kind: "tool",
          label: "Read lib.rs",
        }}
      />
    );
    expect(container.querySelector("[data-slot=marker]")?.textContent).toBe(
      "Read lib.rs"
    );
  });

  it("make change offered as the next step", () => {
    const onClick = vi.fn();
    render(
      <BaseThreadItem
        item={reply("Add a counter")}
        actions={{ makeChange: { onClick, lastResort: false } }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Make this change" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("make change as a last resort inside a lesson", () => {
    render(
      <BaseThreadItem
        item={reply("A hint")}
        actions={{ makeChange: { onClick: vi.fn(), lastResort: true } }}
      />
    );
    expect(
      screen.getByRole("button", { name: "Write it for me" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Make this change" })
    ).toBeNull();
  });

  it("the verify step runs its action", () => {
    const onClick = vi.fn(() => Promise.resolve());
    render(
      <BaseThreadItem
        item={reply("Done")}
        actions={{ verifyStep: { onClick, label: "Build" } }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("skip this step is offered when asked for", () => {
    const onClick = vi.fn();
    render(
      <BaseThreadItem
        item={reply("Still stuck?")}
        actions={{ skipStep: { onClick } }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Skip this step" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("error is an alert, notice a status", () => {
    render(
      <>
        <BaseThreadItem
          item={{ id: "e-1", createdAt: CREATED, kind: "error", text: "Boom" }}
        />
        <BaseThreadItem
          item={{
            id: "n-1",
            createdAt: CREATED,
            kind: "notice",
            text: "Stopped.",
          }}
        />
      </>
    );
    expect(screen.getByRole("alert").textContent).toBe("Boom");
    expect(screen.getByRole("status").textContent).toBe("Stopped.");
  });

  it("an approval answers with its own id", () => {
    const onAnswer = vi.fn();
    render(
      <BaseThreadItem
        item={{
          id: "card-1",
          createdAt: CREATED,
          kind: "approval",
          status: "pending",
          request: { type: "command", name: "build", effect: "Compiles" },
        }}
        onAnswer={onAnswer}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(onAnswer).toHaveBeenCalledWith("card-1", false);
  });
});
