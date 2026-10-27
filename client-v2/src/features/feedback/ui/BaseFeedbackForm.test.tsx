import { useRef, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EMPTY_DRAFT } from "../model/use-feedback-form";
import type { FeedbackDraft, SendStatus } from "../model/use-feedback-form";
import { BaseFeedbackForm } from "./BaseFeedbackForm";

interface HarnessProps {
  send?: SendStatus;
  initial?: FeedbackDraft;
  onDraft?: (draft: FeedbackDraft) => void;
  onSubmit?: () => void;
  onGithub?: (link: string) => void;
  onOpenChange?: (open: boolean) => void;
}

/** Holds the draft and `open` as `FeedbackHost` does, with a button to return focus to */
const Harness = ({
  send = "idle",
  initial = EMPTY_DRAFT,
  onDraft = () => {},
  onSubmit = () => {},
  onGithub = () => {},
  onOpenChange = () => {},
}: HarnessProps) => {
  const [draft, setDraft] = useState(initial);
  const [open, setOpen] = useState(true);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={trigger}>Feedback</button>
      <BaseFeedbackForm
        open={open}
        send={send}
        draft={draft}
        onDraftChange={(next) => {
          onDraft(next);
          setDraft(next);
        }}
        onOpenChange={(next) => {
          onOpenChange(next);
          setOpen(next);
        }}
        onSubmit={onSubmit}
        onGithub={onGithub}
        returnFocusTo={trigger}
      />
    </>
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const message = () =>
  screen.getByRole("textbox", { name: "Feedback" }) as HTMLTextAreaElement;
const contact = () =>
  screen.getByRole("textbox", {
    name: "X handle (optional)",
  }) as HTMLInputElement;
const star = (n: number) =>
  screen.getByRole("radio", { name: `${n} of 5 stars` }) as HTMLInputElement;
const submit = () =>
  userEvent.click(screen.getByRole("button", { name: "Submit" }));

describe("BaseFeedbackForm", () => {
  it("should name its fields as the spec does", () => {
    render(<Harness />);

    expect(screen.getByRole("heading", { name: "Give feedback" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Rating" })).toBeTruthy();
    expect(message().id).toBe("feedback-message");
    expect(message().getAttribute("maxlength")).toBe("4096");
    expect(contact().id).toBe("feedback-contact");
    expect(contact().getAttribute("maxlength")).toBe("16");
  });

  it("should open with the cursor in the message, not on the close button", () => {
    render(<Harness />);

    expect(document.activeElement).toBe(message());
  });

  it("should hand every edit out as the draft, and submit it", async () => {
    const onDraft = vi.fn();
    const onSubmit = vi.fn();
    render(<Harness onDraft={onDraft} onSubmit={onSubmit} />);

    await userEvent.click(star(4));
    await userEvent.type(message(), "Deploy is slow");
    await userEvent.type(contact(), "@fren");
    await submit();

    expect(onDraft).toHaveBeenLastCalledWith({
      message: "Deploy is slow",
      contact: "@fren",
      rating: 4,
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("should show the draft it is given", () => {
    render(
      <Harness initial={{ message: "Kept", contact: "@fren", rating: 3 }} />
    );

    expect(message().value).toBe("Kept");
    expect(contact().value).toBe("@fren");
    expect(star(3).checked).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["only spaces", "   "],
  ])("should refuse a message that is %s", async (_, text) => {
    const onSubmit = vi.fn();
    render(
      <Harness onSubmit={onSubmit} initial={{ message: text, contact: "" }} />
    );

    await submit();

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("should send once a refused message gets real text", async () => {
    const onSubmit = vi.fn();
    render(
      <Harness onSubmit={onSubmit} initial={{ message: "   ", contact: "" }} />
    );
    await submit();

    await userEvent.type(message(), "Deploy is slow");
    await submit();

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("should move the rating with the arrow keys", async () => {
    // user-event finds the radio's group with `CSS.escape`, which jsdom lacks and every browser has
    vi.stubGlobal("CSS", {
      escape: (value: string) => value.replace(/[^\w-]/g, "\\$&"),
    });
    render(<Harness />);

    await userEvent.click(star(2));
    await userEvent.keyboard("{ArrowRight}");

    expect(star(3).checked).toBe(true);
  });

  it.each<[SendStatus, string[]]>([
    [
      "failed",
      ["Could not send feedback. Try again, or use the GitHub links below."],
    ],
    ["idle", []],
  ])("should say in the form that a send failed: %s", (send, alerts) => {
    render(<Harness send={send} />);

    expect(
      screen.queryAllByRole("alert").map((alert) => alert.textContent)
    ).toEqual(alerts);
  });

  it("should hold the draft still while sending", () => {
    render(<Harness send="sending" />);

    expect(
      (screen.getByRole("button", { name: /Submit/ }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(message().readOnly).toBe(true);
    expect(contact().readOnly).toBe(true);
    expect(star(1).disabled).toBe(true);
  });

  it("should close on Escape and return focus to the trigger", async () => {
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);

    await userEvent.keyboard("{Escape}");

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Feedback" })
    );
  });

  it.each([
    ["Suggest an idea", "idea"],
    ["report a bug", "bug"],
  ])(
    "should open %s on the issue list in a new tab and stay open",
    async (name, link) => {
      const onGithub = vi.fn();
      const onOpenChange = vi.fn();
      render(<Harness onGithub={onGithub} onOpenChange={onOpenChange} />);
      const anchor = screen.getByRole("link", { name });

      expect(anchor.getAttribute("href")).toBe(
        "https://github.com/solana-foundation/solana-playground/issues"
      );
      expect(anchor.getAttribute("target")).toBe("_blank");
      expect(anchor.getAttribute("rel")).toBe("noopener noreferrer");
      await userEvent.click(anchor);
      expect(onGithub).toHaveBeenCalledWith(link);
      expect(onOpenChange).not.toHaveBeenCalled();
    }
  );
});
