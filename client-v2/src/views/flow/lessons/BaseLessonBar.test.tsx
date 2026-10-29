import { fireEvent, render, screen } from "@testing-library/react";

import { BaseLessonBar } from "./BaseLessonBar";
import type { StepBandProps } from "./BaseObjectiveBand";

const noop = () => {};

const props = (): StepBandProps => ({
  kind: "step",
  position: { label: "Step 1 of 4", short: "1/4", progress: 0.25 },
  objective: "Say hello on chain",
  criterion: "Verified when the build passes.",
  back: { enabled: false, onClick: noop },
  next: { enabled: true, onClick: noop },
  read: { label: "Read the page", onClick: noop },
  primary: { kind: "stuck", label: "I'm stuck", onClick: noop },
  phone: true,
});

describe("BaseLessonBar", () => {
  it("holds the step's controls at the foot, at the thumb's size", () => {
    render(<BaseLessonBar {...props()} />);
    const bar = screen.getByRole("toolbar", { name: "This step" });
    for (const name of [
      "Previous step",
      "Next step",
      "Read the page",
      "I'm stuck",
    ]) {
      expect(bar.contains(screen.getByRole("button", { name }))).toBe(true);
    }
    expect(
      screen.getByRole("button", { name: "Next step" }).className
    ).toContain("size-12");
    expect(
      (
        screen.getByRole("button", {
          name: "Previous step",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it("fires the step's action", () => {
    const onStuck = vi.fn();
    const p = props();
    p.primary = { kind: "stuck", label: "I'm stuck", onClick: onStuck };
    render(<BaseLessonBar {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "I'm stuck" }));
    expect(onStuck).toHaveBeenCalledTimes(1);
  });

  it("offers the gallery at the path's end", () => {
    render(
      <BaseLessonBar
        kind="finished"
        position={{ label: "4 of 4 steps", short: "done", progress: 1 }}
        objective="You have finished Hello Anchor."
        criterion="4 proved."
        back={{ enabled: true, onClick: noop }}
        next={{ enabled: false, onClick: noop }}
        gallery={{ label: "Browse gallery", onClick: noop }}
        phone
      />
    );
    expect(screen.getByRole("button", { name: "Browse gallery" })).toBeTruthy();
  });
});
