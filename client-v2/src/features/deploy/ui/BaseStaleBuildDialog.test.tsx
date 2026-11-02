// The failed-build question, answered each way.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BaseStaleBuildDialog from "./BaseStaleBuildDialog";

describe("BaseStaleBuildDialog", () => {
  it.each([
    ["Deploy last build", true],
    ["Cancel", false],
  ])("%s answers %s", (button, answer) => {
    const onAnswer = vi.fn();
    render(<BaseStaleBuildDialog open={true} onAnswer={onAnswer} />);

    expect(
      screen.getByRole("dialog", { name: "Your last build failed" })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: button }));
    expect(onAnswer).toHaveBeenCalledWith(answer);
  });
});
