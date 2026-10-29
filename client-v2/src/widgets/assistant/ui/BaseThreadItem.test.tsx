// One item of the thread, drawn from the design system's message parts.
import { createElement } from "react";
import type { FC } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as memoryLog,
  resetLogger,
} from "@/shared/lib/logger";
import { BUTTON_FAILED_TOAST } from "@/shared/lib/report-button-failure";
import { PgView } from "../../../utils/view";
import type { ToastChildProps } from "../../../utils/view";
import { BaseThreadItem } from "./BaseThreadItem";
import type { ChatItem } from "../../../views/sidebar/assistant/store";

// Replies render markdown; the text is enough here
vi.mock("../../../components/Markdown", () => ({
  default: ({ children }: { children: string }) => <p>{children}</p>,
}));

const CREATED = "2026-10-19T00:00:00.000Z";

/** What the failed-click toast says, from the last `setToast` call */
const toastText = (setToast: ReturnType<typeof vi.spyOn>) => {
  const [elementable] = setToast.mock.calls.at(-1)!;
  const Toast = elementable as FC<ToastChildProps>;
  return render(createElement(Toast, { id: BUTTON_FAILED_TOAST })).container
    .textContent;
};

const reply = (text: string): ChatItem => ({
  id: "reply-1",
  createdAt: CREATED,
  kind: "assistant",
  text,
});

const user = (text: string): ChatItem => ({
  id: "u-1",
  createdAt: CREATED,
  kind: "user",
  text,
});

afterEach(() => {
  resetLogger();
  vi.restoreAllMocks();
});

describe("BaseThreadItem", () => {
  it("the user's message is a bubble on the right", () => {
    const { container } = render(
      <BaseThreadItem item={user("Hi")} onAnswer={vi.fn()} />
    );
    const bubble = container.querySelector(
      "[data-slot=message][data-align=end] [data-slot=bubble][data-variant=default]"
    );
    expect(bubble?.textContent).toBe("You: Hi");
  });

  it("a reply is a ghost bubble at full width", () => {
    const { container } = render(
      <BaseThreadItem item={reply("Hello there")} onAnswer={vi.fn()} />
    );
    const bubble = container.querySelector(
      "[data-slot=bubble][data-variant=ghost]"
    );
    expect(bubble?.textContent).toBe("Assistant: Hello there");
  });

  it("who spoke is said to a screen reader, not only shown", () => {
    render(
      <>
        <BaseThreadItem item={user("Hi")} onAnswer={vi.fn()} />
        <BaseThreadItem item={reply("Hello")} onAnswer={vi.fn()} />
      </>
    );
    expect(screen.getByText("You:").className).toContain("sr-only");
    expect(screen.getByText("Assistant:").className).toContain("sr-only");
  });

  it("an empty reply renders nothing", () => {
    const { container } = render(
      <BaseThreadItem item={reply("")} onAnswer={vi.fn()} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("an error offers Enter key when its turn says so", () => {
    const enterKey = vi.fn();
    render(
      <BaseThreadItem
        item={{
          kind: "error",
          id: "e",
          createdAt: CREATED,
          text: "OpenAI-compatible did not accept this key. Check it and enter it again, or pick another model.",
        }}
        actions={{ enterKey }}
        onAnswer={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Enter key" }));

    expect(enterKey).toHaveBeenCalledTimes(1);
    expect(document.querySelector("#assistant-enter-key")).not.toBeNull();
  });

  it("an error offers nothing on its own", () => {
    render(
      <BaseThreadItem
        item={{ kind: "error", id: "e", createdAt: CREATED, text: "quota" }}
        onAnswer={vi.fn()}
      />
    );

    expect(screen.queryByRole("button")).toBeNull();
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
        onAnswer={vi.fn()}
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
        actions={{ makeChange: { onClick, mode: "next" } }}
        onAnswer={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Make this change" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("make change as a last resort inside a lesson", () => {
    render(
      <BaseThreadItem
        item={reply("A hint")}
        actions={{ makeChange: { onClick: vi.fn(), mode: "lastResort" } }}
        onAnswer={vi.fn()}
      />
    );
    expect(
      screen.getByRole("button", { name: "Write it for me" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Make this change" })
    ).toBeNull();
  });

  it("the verify step is named by its stage and runs its action", () => {
    const onClick = vi.fn(() => Promise.resolve());
    render(
      <BaseThreadItem
        item={reply("Done")}
        actions={{
          verifyStep: { onClick, stage: "deploy", title: "Proves it" },
        }}
        onAnswer={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Deploy" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("skip this step is offered when asked for", () => {
    const onClick = vi.fn();
    render(
      <BaseThreadItem
        item={reply("Still stuck?")}
        actions={{ skipStep: { onClick, title: "Not verified" } }}
        onAnswer={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Skip this step" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("a skip that throws is logged, not lost", () => {
    const logs = memoryLog();
    initLogger({ providers: [logs] });
    render(
      <BaseThreadItem
        item={reply("Still stuck?")}
        actions={{
          skipStep: {
            onClick: () => {
              throw new Error("lesson listener failed");
            },
            title: "Not verified",
          },
        }}
        onAnswer={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Skip this step" }));
    expect(
      logs.entries.some((e) => e.ns === "ui:button" && e.level === "error")
    ).toBe(true);
  });

  it("a skip that throws tells the user the step was not skipped", () => {
    const setToast = vi.spyOn(PgView, "setToast").mockImplementation(() => {});
    render(
      <BaseThreadItem
        item={reply("Still stuck?")}
        actions={{
          skipStep: {
            onClick: () => {
              throw new Error("lesson listener failed");
            },
            title: "Not verified",
          },
        }}
        onAnswer={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Skip this step" }));
    expect(toastText(setToast)).toBe("Could not skip the step.");
  });

  it("a verify step that fails tells the user the step was not checked", async () => {
    const setToast = vi.spyOn(PgView, "setToast").mockImplementation(() => {});
    render(
      <BaseThreadItem
        item={reply("Done")}
        actions={{
          verifyStep: {
            onClick: () => Promise.reject(new Error("build server down")),
            stage: "build",
            title: "Proves it",
          },
        }}
        onAnswer={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    await waitFor(() => expect(setToast).toHaveBeenCalled());
    expect(toastText(setToast)).toBe("Could not check the step.");
  });

  it("an error is an alert", () => {
    render(
      <BaseThreadItem
        item={{ id: "e-1", createdAt: CREATED, kind: "error", text: "Boom" }}
        onAnswer={vi.fn()}
      />
    );
    expect(screen.getByRole("alert").textContent).toBe("Boom");
  });

  it("a notice is a status, not an alert", () => {
    render(
      <BaseThreadItem
        item={{
          id: "n-1",
          createdAt: CREATED,
          kind: "notice",
          text: "Stopped.",
        }}
        onAnswer={vi.fn()}
      />
    );
    expect(screen.getByRole("status").textContent).toBe("Stopped.");
    expect(screen.queryByRole("alert")).toBeNull();
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
    expect(onAnswer).toHaveBeenCalledWith("card-1", "deny");
  });
});
