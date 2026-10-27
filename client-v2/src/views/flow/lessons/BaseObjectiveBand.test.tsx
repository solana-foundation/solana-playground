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
  read: { label: "Read the page", unread: false, onClick: noop },
  stuck: { label: "I'm stuck", onClick: noop },
  prove: { label: "Build to prove this", onClick: noop },
  readiness: null,
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

const actionsRow = (container: HTMLElement) =>
  container.querySelector('[data-slot="objective-actions-row"]');

describe("BaseObjectiveBand", () => {
  it("draws the wide band with its position, meter and actions", () => {
    const { container } = render(<BaseObjectiveBand {...props()} />);
    const band = container.querySelector('[data-slot="objective-band"]');
    expect(band).not.toBeNull();
    expect(band?.textContent).toContain("Step 1 of 4");
    expect(band?.textContent).toContain("Say hello on chain");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "25"
    );
    for (const name of [
      "Previous step",
      "Next step",
      "Read the page",
      "I'm stuck",
      "Build to prove this",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("keeps the brand button for I'm stuck alone", () => {
    const { container } = render(<BaseObjectiveBand {...props()} />);
    const brand = container.querySelectorAll('[data-slot="brand-button"]');
    expect(brand).toHaveLength(1);
    expect(brand[0].textContent).toBe("I'm stuck");
    expect(
      screen
        .getByRole("button", { name: "Build to prove this" })
        .getAttribute("data-slot")
    ).toBe("button");
  });

  it("marks an unread page with a dot", () => {
    const p = props();
    p.read = { label: "Read step 1 first", unread: true, onClick: noop };
    render(<BaseObjectiveBand {...p} />);
    const read = screen.getByRole("button", { name: "Read step 1 first" });
    expect(read.hasAttribute("data-unread")).toBe(true);
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

  it("lists readiness as a callout of remedies and plain text", () => {
    const onFund = vi.fn();
    const p = props();
    p.readiness = {
      lead: "Before you can deploy:",
      items: [
        { key: "wallet", text: "fund the wallet", onClick: onFund },
        { key: "build", text: "building...", onClick: null },
      ],
    };
    const { container } = render(<BaseObjectiveBand {...p} />);
    const callout = container.querySelector('[data-slot="callout"]');
    expect(callout?.textContent).toContain("Before you can deploy:");
    fireEvent.click(screen.getByRole("button", { name: "fund the wallet" }));
    expect(onFund).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "building..." })).toBeNull();
    expect(callout?.textContent).toContain("building...");
    expect(callout?.parentElement?.getAttribute("aria-live")).toBe("polite");
  });

  it("renders no callout without readiness", () => {
    const { container } = render(<BaseObjectiveBand {...props()} />);
    expect(container.querySelector('[data-slot="callout"]')).toBeNull();
  });

  it("draws the finished band with the gallery", () => {
    const onGallery = vi.fn();
    const onBack = vi.fn();
    const f = finished(onGallery);
    f.back = { enabled: true, onClick: onBack };
    const { container } = render(<BaseObjectiveBand {...f} />);
    expect(container.textContent).toContain("4 of 4 steps");
    fireEvent.click(screen.getByRole("button", { name: "Previous step" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Browse gallery" }));
    expect(onGallery).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "I'm stuck" })).toBeNull();
    expect(screen.queryByRole("button", { name: /read/i })).toBeNull();
  });

  it("puts back and on in the actions row on a wide screen", () => {
    const { container } = render(<BaseObjectiveBand {...props()} />);
    const row = actionsRow(container);
    for (const name of ["Previous step", "Next step", "I'm stuck"]) {
      expect(row?.contains(screen.getByRole("button", { name }))).toBe(true);
    }
    expect(row?.className).toContain("flex-wrap");
    expect(screen.queryByRole("button", { name: "Show the steps" })).toBeNull();
  });

  it("folds to one row on a phone and opens the steps", () => {
    const onOpenSteps = vi.fn();
    const p = props();
    p.compact = { onOpenSteps };
    const { container } = render(<BaseObjectiveBand {...p} />);
    const band = container.querySelector('[data-slot="objective-band"]');
    expect(band?.textContent).toContain("1/4");
    expect(band?.textContent).not.toContain("Step 1 of 4");
    expect(band?.textContent).toContain("Say hello on chain");
    fireEvent.click(screen.getByRole("button", { name: "Show the steps" }));
    expect(onOpenSteps).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "I'm stuck" })).toBeTruthy();
  });

  it("keeps the phone's actions on one row that scrolls", () => {
    const p = props();
    p.compact = { onOpenSteps: noop };
    const { container } = render(<BaseObjectiveBand {...p} />);
    const row = actionsRow(container);
    expect(row?.className).toContain("flex-nowrap");
    expect(row?.className).toContain("overflow-x-auto");
    expect(row?.className).not.toContain("flex-wrap");
  });
});
