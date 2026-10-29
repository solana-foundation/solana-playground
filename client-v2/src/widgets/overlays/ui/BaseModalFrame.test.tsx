import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";

import { Modal } from "@/shared/ui/modal";
import { BaseModalFrame } from "./BaseModalFrame";
import type { BaseModalFrameProps, SubmitStatus } from "./BaseModalFrame";

type Submit = NonNullable<BaseModalFrameProps["submit"]>;

/** A footer named "Rename", in the given status, with these handlers */
const submitOf = (
  status: SubmitStatus = "ready",
  onSubmit: () => void = vi.fn(),
  onCancel?: () => void
): Submit => ({
  text: "Rename",
  status,
  variant: "default",
  onSubmit,
  onCancel,
});

const renderFrame = ({
  title = { text: "Rename", hidden: false },
  error,
  submit,
  openFocus,
  children,
}: {
  title?: BaseModalFrameProps["title"];
  error?: string;
  submit?: Submit;
  openFocus?: BaseModalFrameProps["openFocus"];
  children?: ReactNode;
} = {}) =>
  render(
    <Modal open>
      <BaseModalFrame
        title={title}
        error={error}
        submit={submit}
        openFocus={openFocus}
        size="default"
      >
        {children}
      </BaseModalFrame>
    </Modal>
  );

const enterOn = (el: Element, init: { isComposing?: boolean } = {}) =>
  fireEvent.keyDown(el, { key: "Enter", isComposing: init.isComposing });

it("should show the title as the dialog's heading and name", () => {
  renderFrame({ title: { text: "Rename file", hidden: false } });

  expect(screen.getByRole("heading", { name: "Rename file" })).toBeTruthy();
  expect(screen.getByRole("dialog", { name: "Rename file" })).toBeTruthy();
});

it("should show the error", () => {
  renderFrame({ error: "File already exists" });

  expect(screen.getByText("File already exists")).toBeTruthy();
});

it("should submit once when Enter is pressed in an input", () => {
  const onSubmit = vi.fn();
  renderFrame({
    submit: submitOf("ready", onSubmit),
    children: <input aria-label="Name" />,
  });

  const button = screen.getByRole("button", { name: "Rename" });
  expect(button.getAttribute("type")).toBe("submit");
  enterOn(screen.getByRole("textbox", { name: "Name" }));

  expect(onSubmit).toHaveBeenCalledTimes(1);
});

it("should submit on Enter after a click on a part of the body that takes no focus", () => {
  const onSubmit = vi.fn();
  renderFrame({
    submit: submitOf("ready", onSubmit),
    children: <div>Anchor</div>,
  });

  // A framework card: the focus stays on the dialog itself
  enterOn(screen.getByRole("dialog"));

  expect(onSubmit).toHaveBeenCalledTimes(1);
});

it("should leave Enter to a button in the body", () => {
  const onSubmit = vi.fn();
  renderFrame({
    submit: submitOf("ready", onSubmit),
    children: <button type="button">Copy</button>,
  });

  enterOn(screen.getByRole("button", { name: "Copy" }));

  expect(onSubmit).not.toHaveBeenCalled();
});

it("should not submit on an Enter that composes text", () => {
  const onSubmit = vi.fn();
  renderFrame({
    submit: submitOf("ready", onSubmit),
    children: <input aria-label="Name" />,
  });

  enterOn(screen.getByRole("textbox", { name: "Name" }), { isComposing: true });

  expect(onSubmit).not.toHaveBeenCalled();
});

it("should not submit on Enter while the submit is disabled", () => {
  const onSubmit = vi.fn();
  renderFrame({
    submit: submitOf("disabled", onSubmit),
    children: <input aria-label="Name" />,
  });

  enterOn(screen.getByRole("textbox", { name: "Name" }));

  expect(onSubmit).not.toHaveBeenCalled();
});

it("should leave an Enter its input handled alone", () => {
  const onSubmit = vi.fn();
  renderFrame({
    submit: submitOf("ready", onSubmit),
    children: (
      <input aria-label="Name" onKeyDown={(ev) => ev.preventDefault()} />
    ),
  });

  enterOn(screen.getByRole("textbox", { name: "Name" }));

  expect(onSubmit).not.toHaveBeenCalled();
});

it("should not submit when a button in the body without a type is clicked", () => {
  const onSubmit = vi.fn();
  const onClick = vi.fn();
  renderFrame({
    submit: submitOf("ready", onSubmit),
    // A `<button>` without `type="button"` submits its form
    children: <button onClick={onClick}>Copy</button>,
  });

  fireEvent.click(screen.getByRole("button", { name: "Copy" }));

  expect(onClick).toHaveBeenCalledTimes(1);
  expect(onSubmit).not.toHaveBeenCalled();
});

it("should submit once when the button is clicked", () => {
  const onSubmit = vi.fn();
  renderFrame({ submit: submitOf("ready", onSubmit) });

  fireEvent.click(screen.getByRole("button", { name: "Rename" }));

  expect(onSubmit).toHaveBeenCalledTimes(1);
});

it("should show a Cancel button that calls onCancel", () => {
  const onCancel = vi.fn();
  renderFrame({ submit: submitOf("ready", vi.fn(), onCancel) });

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(onCancel).toHaveBeenCalledTimes(1);
});

it("should show no Cancel button without onCancel", () => {
  renderFrame({ submit: submitOf() });

  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
});

it("should disable the submit and Cancel while busy", () => {
  renderFrame({ submit: submitOf("busy", vi.fn(), vi.fn()) });

  const submit = screen.getByRole("button", { name: /Rename/ });
  const cancel = screen.getByRole("button", { name: "Cancel" });
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  expect((cancel as HTMLButtonElement).disabled).toBe(true);
});

it("should keep an accessible name and show no heading when the title is hidden", () => {
  renderFrame({ title: { text: "Solana Playground", hidden: true } });

  expect(
    screen.getByRole("dialog", { name: "Solana Playground" })
  ).toBeTruthy();
  expect(
    screen
      .getByRole("heading", { name: "Solana Playground" })
      .classList.contains("sr-only")
  ).toBe(true);
});

it("should focus the submit on open when the body has no input, so Enter presses it", () => {
  renderFrame({ submit: submitOf(), children: <p>Delete the file?</p> });

  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Rename" })
  );
});

it("should pass over the hidden controls Radix keeps for a form, and focus the submit", () => {
  // A radio group and a select inside a form each keep a native control the
  // user never reaches: `aria-hidden`, out of the tab order
  renderFrame({
    submit: submitOf(),
    children: (
      <>
        <input type="radio" aria-hidden="true" tabIndex={-1} readOnly />
        <select aria-hidden="true" tabIndex={-1} />
        <p>Pick one</p>
      </>
    ),
  });

  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Rename" })
  );
});

it("should focus the body's first input on open", () => {
  renderFrame({
    submit: submitOf(),
    children: (
      <>
        <input type="hidden" />
        <input aria-label="Name" />
      </>
    ),
  });

  expect(document.activeElement).toBe(
    screen.getByRole("textbox", { name: "Name" })
  );
});

it("should draw the hairline under a shown title only", () => {
  const { unmount } = renderFrame({ title: { text: "Rename", hidden: false } });
  const header = () =>
    document.querySelector('[data-slot="modal-header"]')!.classList;
  expect(header().contains("border-b")).toBe(true);
  expect(header().contains("md:border-b-0")).toBe(false);
  unmount();

  renderFrame({ title: { text: "Solana Playground", hidden: true } });
  expect(header().contains("md:border-b-0")).toBe(true);
});

it("should focus the dialog itself on open when asked, so no field shows a ring", () => {
  renderFrame({
    openFocus: "dialog",
    children: <input aria-label="Name" />,
  });

  expect(document.activeElement).toBe(screen.getByRole("dialog"));
});

it("should focus Cancel on open when asked, so Enter cancels a destructive dialog", () => {
  renderFrame({
    openFocus: "cancel",
    submit: submitOf("ready", vi.fn(), vi.fn()),
  });

  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Cancel" })
  );
});

it("should focus the dialog when asked for Cancel on a phone, which has none", () => {
  render(
    <Modal open>
      <BaseModalFrame
        phone
        title={{ text: "Delete counter?", hidden: false }}
        submit={{
          text: "Delete project",
          status: "ready",
          variant: "destructive",
          onSubmit: vi.fn(),
          onCancel: vi.fn(),
        }}
        openFocus="cancel"
        size="default"
      />
    </Modal>
  );

  expect(document.activeElement).toBe(screen.getByRole("dialog"));
});

it("should cancel, not submit, on Enter at the focused Cancel", () => {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  renderFrame({
    openFocus: "cancel",
    submit: submitOf("ready", onSubmit, onCancel),
  });

  const cancel = screen.getByRole("button", { name: "Cancel" });
  fireEvent.keyDown(cancel, { key: "Enter" });
  fireEvent.click(cancel);

  expect(onSubmit).not.toHaveBeenCalled();
  expect(onCancel).toHaveBeenCalledTimes(1);
});

it("should not submit on Enter at the dialog when asked for Cancel on a phone", () => {
  const onSubmit = vi.fn();
  render(
    <Modal open>
      <BaseModalFrame
        phone
        title={{ text: "Delete counter?", hidden: false }}
        submit={{
          text: "Delete project",
          status: "ready",
          variant: "destructive",
          onSubmit,
          onCancel: vi.fn(),
        }}
        openFocus="cancel"
        size="default"
      />
    </Modal>
  );

  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });

  expect(onSubmit).not.toHaveBeenCalled();
});

/** A press: Radix settles an outside press on the click that follows it */
const pressOutside = (el: HTMLElement) => {
  fireEvent.pointerDown(el);
  fireEvent.click(el);
};

const renderOpen = (onOpenChange: (open: boolean) => void) =>
  render(
    <>
      <div data-sonner-toaster="true">
        <button type="button">toast close</button>
      </div>
      <button type="button">page</button>
      <Modal open onOpenChange={onOpenChange}>
        <BaseModalFrame
          title={{ text: "Rename", hidden: false }}
          size="default"
        />
      </Modal>
    </>
  );

it("should stay open when a toast is clicked", async () => {
  const onOpenChange = vi.fn();
  renderOpen(onOpenChange);
  // Radix listens for outside clicks from the next tick
  await new Promise((resolve) => setTimeout(resolve, 0));

  pressOutside(screen.getByText("toast close"));

  expect(onOpenChange).not.toHaveBeenCalled();
});

it("should close when the page outside is clicked", async () => {
  const onOpenChange = vi.fn();
  renderOpen(onOpenChange);
  // Radix listens for outside clicks from the next tick
  await new Promise((resolve) => setTimeout(resolve, 0));

  pressOutside(screen.getByText("page"));

  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("should draw a brand submit as the ring brand button, still the dialog's submit", () => {
  const onSubmit = vi.fn();
  renderFrame({
    submit: {
      text: "Connect",
      status: "ready",
      variant: "brand",
      onSubmit,
    },
  });

  const submit = screen.getByRole("button", { name: "Connect" });
  expect(submit.getAttribute("data-slot")).toBe("brand-button");
  expect(submit.getAttribute("data-variant")).toBe("ring");
  expect(submit.getAttribute("type")).toBe("submit");
  fireEvent.click(submit);
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

it("should draw a default submit as the stock button", () => {
  renderFrame({ submit: submitOf() });

  expect(
    screen.getByRole("button", { name: "Rename" }).getAttribute("data-slot")
  ).toBe("button");
});

it("on a phone, has no Cancel beside the bar's Close and draws a brand submit as the accent", () => {
  const onSubmit = vi.fn();
  render(
    <Modal open>
      <BaseModalFrame
        phone
        title={{ text: "Connect a model", hidden: false }}
        submit={{
          text: "Connect",
          status: "ready",
          variant: "brand",
          onSubmit,
          onCancel: vi.fn(),
        }}
        size="default"
      />
    </Modal>
  );
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  const submit = screen.getByRole("button", { name: "Connect" });
  expect(submit.getAttribute("data-variant")).toBe("accent");
  fireEvent.click(submit);
  expect(onSubmit).toHaveBeenCalledTimes(1);
});
