import { fireEvent, render, screen } from "@testing-library/react";

import { BaseObjectiveBand } from "./BaseObjectiveBand";
import type { FinishedBandProps, StepBandProps } from "./BaseObjectiveBand";

const noop = () => {};

const props = (): StepBandProps => ({
  kind: "step",
  position: { label: "Step 1 of 4", short: "1/4", progress: 0.25 },
  objective: "Say hello on chain",
  criterion: "Verified when the build passes.",
  back: { enabled: true, onClick: noop },
  next: { enabled: true, onClick: noop },
  read: { label: "Read the page", onClick: noop },
  primary: { kind: "stuck", label: "I'm stuck", onClick: noop },
});

const finished = (onGallery: () => void): FinishedBandProps => ({
  kind: "finished",
  position: { label: "4 of 4 steps", short: "done", progress: 1 },
  objective: "Say hello on chain",
  criterion: "Verified when the build passes.",
  back: { enabled: true, onClick: noop },
  next: { enabled: false, onClick: noop },
  gallery: { label: "Browse gallery", onClick: onGallery },
});

const slot = (container: HTMLElement, name: string) =>
  container.querySelector(`[data-slot="${name}"]`);

describe("BaseObjectiveBand", () => {
  it("draws the wide band as one row: where, the ask, then the actions", () => {
    const { container } = render(<BaseObjectiveBand {...props()} />);
    const band = slot(container, "objective-band");
    expect(band?.textContent).toContain("Step 1 of 4");
    expect(band?.textContent).toContain("Say hello on chain");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "25"
    );
    const actions = slot(container, "objective-actions");
    expect(actions?.parentElement).toBe(slot(container, "objective-row"));
    for (const name of [
      "Previous step",
      "Next step",
      "Read the page",
      "I'm stuck",
    ]) {
      expect(actions?.contains(screen.getByRole("button", { name }))).toBe(
        true
      );
    }
  });

  it("says the position in sentence case", () => {
    const { container } = render(<BaseObjectiveBand {...props()} />);
    expect(slot(container, "objective-count")?.className).not.toContain(
      "uppercase"
    );
  });

  it("offers no proving action and no readiness line", () => {
    const { container } = render(<BaseObjectiveBand {...props()} />);
    expect(screen.queryByRole("button", { name: /to prove this/ })).toBeNull();
    expect(slot(container, "callout")).toBeNull();
    expect(container.textContent).not.toContain("Before you can");
  });

  it("shows how the step is checked under the row on request", () => {
    const { container } = render(<BaseObjectiveBand {...props()} />);
    const check = screen.getByRole("button", {
      name: "How this step is checked",
    });
    expect(check.getAttribute("aria-expanded")).toBe("false");
    expect(slot(container, "objective-condition")).toBeNull();
    fireEvent.click(check);
    expect(check.getAttribute("aria-expanded")).toBe("true");
    expect(slot(container, "objective-condition")?.textContent).toBe(
      "Verified when the build passes."
    );
  });

  it("keeps the brand ring for the step's one action", () => {
    const { container } = render(<BaseObjectiveBand {...props()} />);
    const brand = container.querySelectorAll('[data-slot="objective-primary"]');
    expect(brand).toHaveLength(1);
    expect(brand[0].textContent).toBe("I'm stuck");
  });

  it("continues a step proved by reading", () => {
    const onContinue = vi.fn();
    const p = props();
    p.primary = { kind: "continue", label: "Continue", onClick: onContinue };
    render(<BaseObjectiveBand {...p} />);
    expect(screen.queryByRole("button", { name: "I'm stuck" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("renders no read button without a page", () => {
    const p = props();
    p.read = null;
    render(<BaseObjectiveBand {...p} />);
    expect(screen.queryByRole("button", { name: /read/i })).toBeNull();
  });

  it("disables the previous step when it cannot go back", () => {
    const p = props();
    p.back = { enabled: false, onClick: noop };
    render(<BaseObjectiveBand {...p} />);
    const back = screen.getByRole("button", {
      name: "Previous step",
    }) as HTMLButtonElement;
    expect(back.disabled).toBe(true);
  });

  it("draws the finished band with the gallery", () => {
    const onGallery = vi.fn();
    const onBack = vi.fn();
    const f = finished(onGallery);
    f.back = { enabled: true, onClick: onBack };
    const { container } = render(<BaseObjectiveBand {...f} />);
    expect(container.textContent).toContain("4 of 4 steps");
    // The summary shows without a check to press
    expect(slot(container, "objective-condition")?.textContent).toBe(
      "Verified when the build passes."
    );
    expect(
      screen.queryByRole("button", { name: "How this step is checked" })
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Previous step" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Browse gallery" }));
    expect(onGallery).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "I'm stuck" })).toBeNull();
    expect(screen.queryByRole("button", { name: /read/i })).toBeNull();
  });

  it("folds to one row on a phone that opens in place", () => {
    const p = props();
    p.phone = true;
    const { container } = render(<BaseObjectiveBand {...p} />);
    const fold = slot(container, "objective-fold");
    expect(fold?.textContent).toContain("1/4");
    expect(fold?.textContent).not.toContain("Step 1 of 4");
    expect(fold?.textContent).toContain("Say hello on chain");
    // The actions are the foot bar's on a phone
    expect(screen.queryByRole("button", { name: "I'm stuck" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Read the page" })).toBeNull();
    const toggle = screen.getByRole("button", { name: /Say hello on chain/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(fold?.textContent).not.toContain("Verified when");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(fold?.textContent).toContain("Verified when the build passes.");
  });
});
