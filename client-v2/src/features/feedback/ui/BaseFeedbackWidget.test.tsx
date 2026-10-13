import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { BaseFeedbackWidget } from "./BaseFeedbackWidget";

const renderWidget = (canShare: boolean, sending = false) => {
  const onShare = vi.fn();
  const onGithub = vi.fn();
  render(
    <BaseFeedbackWidget
      canShare={canShare}
      sending={sending}
      onShare={onShare}
      onGithub={onGithub}
    />
  );
  return { onShare, onGithub };
};

const openMenu = () =>
  userEvent.click(screen.getByRole("button", { name: "Feedback" }));

const itemNames = () =>
  screen.getAllByRole("menuitem").map((item) => item.textContent?.trim());

describe("BaseFeedbackWidget", () => {
  it("should offer Share feedback first where a send can succeed", async () => {
    const { onShare } = renderWidget(true);
    await openMenu();

    expect(itemNames()).toEqual([
      "Share feedback",
      "Suggest an idea",
      "Report a bug",
    ]);
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Share feedback" })
    );
    expect(onShare).toHaveBeenCalledTimes(1);
  });

  it("should offer only the GitHub links where a send cannot succeed", async () => {
    renderWidget(false);
    await openMenu();

    expect(itemNames()).toEqual(["Suggest an idea", "Report a bug"]);
  });

  it.each([
    [false, [], 0],
    [true, ["Sending feedback"], 1],
  ])(
    "should show on the trigger whether a send is in flight: %s",
    (sending, statuses, pulses) => {
      renderWidget(true, sending);

      expect(
        screen
          .queryAllByRole("status")
          .map((status) => status.getAttribute("aria-label"))
      ).toEqual(statuses);
      expect(
        document.querySelectorAll('[data-slot="feedback-pulse"]')
      ).toHaveLength(pulses);
    }
  );

  it.each([
    ["Suggest an idea", "idea"],
    ["Report a bug", "bug"],
  ])("should open %s in a new tab and report it", async (name, link) => {
    const { onGithub } = renderWidget(true);
    await openMenu();
    const item = screen.getByRole("menuitem", { name });

    expect(item.getAttribute("href")).toBe(
      "https://github.com/solana-foundation/solana-playground/issues"
    );
    expect(item.getAttribute("target")).toBe("_blank");
    expect(item.getAttribute("rel")).toBe("noopener noreferrer");
    await userEvent.click(item);
    expect(onGithub).toHaveBeenCalledWith(link);
  });
});
