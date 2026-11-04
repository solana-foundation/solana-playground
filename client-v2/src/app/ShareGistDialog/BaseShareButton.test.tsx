import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shared/ui/tooltip";

import BaseShareButton from "./BaseShareButton";

it("names the project it shares, draws an icon, and calls back on a click", () => {
  const onShare = vi.fn();
  render(
    <TooltipProvider>
      <BaseShareButton name="counter" onShare={onShare} />
    </TooltipProvider>
  );

  const share = screen.getByRole("button", { name: "Share counter" });
  expect(share.id).toBe("flow-share");
  // An icon, as the bar's other controls; its name is the tooltip
  expect(share.textContent).toBe("");
  expect(share.querySelector("svg")).toBeTruthy();
  fireEvent.click(share);

  expect(onShare).toHaveBeenCalledTimes(1);
});
