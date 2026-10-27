import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { GITHUB_LINKS } from "../lib/github-links";
import { BaseFeedbackMenuItems } from "./BaseFeedbackMenuItems";

const draw = (canShare: boolean, onShare = vi.fn(), onGithub = vi.fn()) => {
  render(
    <DropdownMenu>
      <DropdownMenuTrigger>Open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <BaseFeedbackMenuItems
          canShare={canShare}
          onShare={onShare}
          onGithub={onGithub}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return userEvent.click(screen.getByRole("button", { name: "Open" }));
};

const itemNames = () =>
  screen.getAllByRole("menuitem").map((item) => item.textContent?.trim());

it("offers Share feedback first where a send can succeed", async () => {
  await draw(true);
  expect(itemNames()).toEqual(["Share feedback", "Report a bug"]);
});

it("offers only Report a bug where it cannot", async () => {
  await draw(false);
  expect(itemNames()).toEqual(["Report a bug"]);
});

it("opens Report a bug on the issue list in a new tab", async () => {
  const onGithub = vi.fn();
  await draw(false, vi.fn(), onGithub);
  const item = screen.getByRole("menuitem", { name: "Report a bug" });
  expect(item.getAttribute("href")).toBe(GITHUB_LINKS.bug);
  expect(item.getAttribute("target")).toBe("_blank");
  expect(item.getAttribute("rel")).toBe("noopener noreferrer");
  await userEvent.click(item);
  expect(onGithub).toHaveBeenCalledExactlyOnceWith("bug");
});

it("opens the form from Share feedback", async () => {
  const onShare = vi.fn();
  await draw(true, onShare);
  await userEvent.click(
    screen.getByRole("menuitem", { name: "Share feedback" })
  );
  expect(onShare).toHaveBeenCalledOnce();
});
