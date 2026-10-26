// The legacy Markdown and Loading components reach the utils barrel, which
// reads globals that exist only in the built app; markers stand in for them
vi.mock("../../../components/Markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));
vi.mock("../../../components/Loading", () => ({
  SpinnerWithBg: () => <div data-testid="spinner" />,
}));

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { BaseReader } from "./BaseReader";
import type { BaseReaderProps, ReaderBody } from "./BaseReader";
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui/dialog";

const noop = () => {};

/** A step with no page, going back to the code; each test changes a copy */
const props = (): BaseReaderProps => ({
  title: "Say hello on chain",
  position: "Step 1 of 4",
  criterion: "Verified when the build passes.",
  body: { kind: "none" },
  footer: { kind: "back", onClick: noop },
  onClose: noop,
});

const closingWith = (onClose: () => void): BaseReaderProps => {
  const p = props();
  p.onClose = onClose;
  return p;
};

const withBody = (body: ReaderBody): BaseReaderProps => {
  const p = props();
  p.body = body;
  return p;
};

const withFooter = (footer: BaseReaderProps["footer"]): BaseReaderProps => {
  const p = props();
  p.footer = footer;
  return p;
};

describe("BaseReader", () => {
  it("is a non-modal dialog named by the title, rendered in place", () => {
    const { container } = render(<BaseReader {...props()} />);
    const dialog = screen.getByRole("dialog", { name: "Say hello on chain" });
    expect(dialog.getAttribute("aria-modal")).toBeNull();
    expect(dialog.getAttribute("data-slot")).toBe("dialog-content");
    expect(container.contains(dialog)).toBe(true);
    expect(screen.getByRole("button", { name: "Close the page" })).toBeTruthy();
    expect(dialog.textContent).toContain("Step 1 of 4");
    expect(dialog.textContent).toContain("Verified when the build passes.");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<BaseReader {...closingWith(onClose)} />);
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("takes focus on mount and gives it back on unmount", async () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    const { unmount } = render(<BaseReader {...props()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
    unmount();
    // Radix hands focus back on a timer, after the unmount
    await waitFor(() => expect(document.activeElement).toBe(outside));
    outside.remove();
  });

  it("stays open when the pointer goes down outside", () => {
    const onClose = vi.fn();
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    render(<BaseReader {...closingWith(onClose)} />);
    act(() => {
      fireEvent.pointerDown(outside);
    });
    expect(onClose).not.toHaveBeenCalled();
    outside.remove();
  });

  it("says so when the page failed or there is none", () => {
    const { rerender } = render(
      <BaseReader {...withBody({ kind: "failed" })} />
    );
    expect(screen.getByText(/This page could not be loaded\./)).toBeTruthy();
    rerender(<BaseReader {...withBody({ kind: "none" })} />);
    expect(screen.getByText("This step has no page to read.")).toBeTruthy();
  });

  it("labels and styles the footer by its kind and fires it", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <BaseReader {...withFooter({ kind: "attest", onClick })} />
    );
    const attest = screen.getByRole("button", { name: "Mark as read" });
    expect(attest.getAttribute("data-variant")).toBe("default");
    fireEvent.click(attest);
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<BaseReader {...withFooter({ kind: "back", onClick })} />);
    expect(
      screen
        .getByRole("button", { name: "Back to the code" })
        .getAttribute("data-variant")
    ).toBe("outline");
  });

  it("leaves the page open when Escape closes a modal stacked over it", () => {
    const onClose = vi.fn();
    const onModalChange = vi.fn();
    render(
      <>
        <BaseReader {...closingWith(onClose)} />
        <Dialog open onOpenChange={onModalChange}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Connect a model</DialogTitle>
          </DialogContent>
        </Dialog>
      </>
    );
    const modal = screen.getByRole("dialog", { name: "Connect a model" });
    expect(modal.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(onModalChange).toHaveBeenCalledWith(false);
    expect(onClose).not.toHaveBeenCalled();
  });
});
