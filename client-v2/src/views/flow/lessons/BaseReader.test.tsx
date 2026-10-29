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

/** A step with no page; each test changes a copy */
const props = (): BaseReaderProps => ({
  title: "Say hello on chain",
  body: { kind: "none" },
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

describe("BaseReader", () => {
  it("is a non-modal dialog named by the title, rendered in place", () => {
    const { container } = render(<BaseReader {...props()} />);
    const dialog = screen.getByRole("dialog", { name: "Say hello on chain" });
    expect(dialog.getAttribute("aria-modal")).toBeNull();
    expect(dialog.getAttribute("data-slot")).toBe("dialog-content");
    expect(container.contains(dialog)).toBe(true);
    expect(screen.getByRole("button", { name: "Close the page" })).toBeTruthy();
    // The head is the objective alone, as the prototype's page has it
    expect(dialog.textContent).not.toMatch(/step 1 of 4/i);
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

  it("has no footer: the band carries the way on", () => {
    render(<BaseReader {...props()} />);
    expect(screen.queryByRole("button", { name: "Mark as read" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Back to the code" })
    ).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
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
