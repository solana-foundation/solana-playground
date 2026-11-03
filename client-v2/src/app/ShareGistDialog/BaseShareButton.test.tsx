import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import BaseShareButton from "./BaseShareButton";

// The widget's entry boots `@/utils`, whose settings need the build's
// globals; the mark is all this button takes from it
vi.mock("@/widgets/session-footer", () => ({
  GithubMark: (props: { className?: string }) => (
    <svg data-testid="github-mark" className={props.className} />
  ),
}));

it("names the project it shares, says Share, and calls back on a click", () => {
  const onShare = vi.fn();
  render(<BaseShareButton name="counter" onShare={onShare} />);

  const share = screen.getByRole("button", { name: "Share counter" });
  expect(share.id).toBe("flow-share");
  expect(share.textContent).toBe("Share");
  expect(share.querySelector("svg")).toBeTruthy();
  fireEvent.click(share);

  expect(onShare).toHaveBeenCalledTimes(1);
});
