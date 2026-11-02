import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import type { BaseHandoffProps, HandoffAccount } from "./BaseHandoff";
import BaseHandoff from "./BaseHandoff";

const LINK = "https://beta.solpg.io/tutorials/hello-solana";

const SIGNED_IN: HandoffAccount = { status: "signed-in", login: "ada" };
const SIGNED_OUT: HandoffAccount = {
  status: "signed-out",
  signingIn: false,
  error: null,
};

const props = (over: Partial<BaseHandoffProps> = {}): BaseHandoffProps => ({
  open: over.open ?? true,
  onOpenChange: over.onOpenChange ?? vi.fn(),
  link: over.link ?? LINK,
  account: over.account ?? SIGNED_IN,
  onSignIn: over.onSignIn ?? vi.fn(),
  onCopy: over.onCopy ?? vi.fn().mockResolvedValue(true),
  onShare:
    over.onShare === undefined
      ? vi.fn().mockResolvedValue(undefined)
      : over.onShare,
});

afterEach(() => {
  vi.useRealTimers();
});

it("opens from the row named Continue on a computer", () => {
  const onOpenChange = vi.fn();
  render(<BaseHandoff {...props({ open: false, onOpenChange })} />);
  fireEvent.click(screen.getByTestId("handoff-open"));
  expect(onOpenChange).toHaveBeenCalledWith(true);
  expect(screen.getByTestId("handoff-open")).toBe(
    screen.getByRole("button", { name: "Continue on a computer" })
  );
});

it("signed in, says the project is in the account and names the login", () => {
  render(<BaseHandoff {...props()} />);
  expect(
    screen.getByRole("dialog", { name: "Continue on a computer" })
  ).toBeTruthy();
  expect(screen.getByText(/saved to your account/)).toBeTruthy();
  expect(screen.getByText(/@ada/)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Sign in with GitHub" })
  ).toBeNull();
});

it("signed out, says the project is on this phone only and offers sign-in", () => {
  const onSignIn = vi.fn();
  render(<BaseHandoff {...props({ account: SIGNED_OUT, onSignIn })} />);
  expect(screen.getByText(/on this phone only/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Sign in with GitHub" }));
  expect(onSignIn).toHaveBeenCalledTimes(1);
});

it("holds the sign-in button while a sign-in is under way", () => {
  render(
    <BaseHandoff
      {...props({
        account: { status: "signed-out", signingIn: true, error: null },
      })}
    />
  );
  expect(
    screen
      .getByRole("button", { name: "Sign in with GitHub" })
      .hasAttribute("disabled")
  ).toBe(true);
});

it("says why the last sign-in failed, under its button", () => {
  render(
    <BaseHandoff
      {...props({
        account: {
          status: "signed-out",
          signingIn: false,
          error: "The sign-in window was closed.",
        },
      })}
    />
  );
  expect(screen.getByRole("alert").textContent).toBe(
    "The sign-in window was closed."
  );
});

it("shows the whole link in its well", () => {
  render(<BaseHandoff {...props()} />);
  expect(screen.getByTestId("handoff-link").textContent).toBe(LINK);
});

it("reads Copied after a copy, and Copy link again 2 s later", async () => {
  vi.useFakeTimers();
  const onCopy = vi.fn().mockResolvedValue(true);
  render(<BaseHandoff {...props({ onCopy })} />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  });
  expect(onCopy).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
});

it("never reads Copied when the copy is refused", async () => {
  const onCopy = vi.fn().mockResolvedValue(false);
  render(<BaseHandoff {...props({ onCopy })} />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  });
  expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
});

it("forgets Copied when the sheet closes", async () => {
  const draw = (open: boolean) => <BaseHandoff {...props({ open })} />;
  const { rerender } = render(draw(true));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  });
  rerender(draw(false));
  rerender(draw(true));
  expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
});

it("draws Share only where the browser can share", () => {
  const onShare = vi.fn().mockResolvedValue(undefined);
  const { unmount } = render(<BaseHandoff {...props({ onShare })} />);
  fireEvent.click(screen.getByRole("button", { name: "Share" }));
  expect(onShare).toHaveBeenCalledTimes(1);
  unmount();
  render(<BaseHandoff {...props({ onShare: null })} />);
  expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
});

it("closes on Stay on the phone", () => {
  const onOpenChange = vi.fn();
  render(<BaseHandoff {...props({ onOpenChange })} />);
  fireEvent.click(screen.getByRole("button", { name: "Stay on the phone" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
