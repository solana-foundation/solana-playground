import { fireEvent, render, screen } from "@testing-library/react";

import { BaseStepRail, railStatus } from "./BaseStepRail";
import type { RailRow } from "./BaseStepRail";

describe("railStatus", () => {
  it("maps confirmed marks to done", () => {
    expect(railStatus("proved", { isCurrent: false, atFrontier: false })).toBe(
      "done"
    );
    expect(
      railStatus("attested", { isCurrent: false, atFrontier: false })
    ).toBe("done");
  });

  it("maps a passed mark to skipped", () => {
    expect(railStatus("passed", { isCurrent: false, atFrontier: false })).toBe(
      "skipped"
    );
  });

  it("maps open to locked unless it is the cursor or the frontier", () => {
    expect(railStatus("open", { isCurrent: true, atFrontier: false })).toBe(
      "current"
    );
    expect(railStatus("open", { isCurrent: false, atFrontier: false })).toBe(
      "locked"
    );
  });

  it("marks the frontier next once the cursor walked back from it", () => {
    expect(railStatus("open", { isCurrent: false, atFrontier: true })).toBe(
      "next"
    );
    expect(railStatus("open", { isCurrent: true, atFrontier: true })).toBe(
      "current"
    );
  });

  it("lets the cursor win over a skipped mark", () => {
    expect(railStatus("passed", { isCurrent: true, atFrontier: false })).toBe(
      "current"
    );
  });
});

describe("BaseStepRail", () => {
  const rows: RailRow[] = [
    {
      id: "a",
      objective: "Write it",
      meta: "ran",
      status: "done",
      canGo: true,
    },
    {
      id: "b",
      objective: "Deploy it",
      meta: "deploy",
      status: "current",
      canGo: false,
    },
  ];

  it("carries status on the items and marks the current one", () => {
    const { container } = render(<BaseStepRail rows={rows} onGo={vi.fn()} />);
    const items = container.querySelectorAll('[data-slot="step-rail-item"]');
    expect(items[0].getAttribute("data-status")).toBe("done");
    expect(items[1].getAttribute("data-status")).toBe("current");
    expect(items[0].getAttribute("aria-current")).toBeNull();
    expect(items[1].getAttribute("aria-current")).toBe("step");
  });

  it("makes a canGo row a button that calls onGo with its id", () => {
    const onGo = vi.fn();
    render(<BaseStepRail rows={rows} onGo={onGo} />);
    fireEvent.click(screen.getByRole("button", { name: /Write it/ }));
    expect(onGo).toHaveBeenCalledWith("a");
  });

  it("draws the next step as not done, without the locked dimming", () => {
    const next: RailRow = {
      id: "c",
      objective: "Test it",
      meta: "run the tests",
      status: "next",
      canGo: true,
    };
    const { container } = render(<BaseStepRail rows={[next]} onGo={vi.fn()} />);
    const item = container.querySelector('[data-slot="step-rail-item"]')!;
    expect(item.getAttribute("data-status")).toBe("locked");
    expect(item.className).toContain("data-[status=locked]:opacity-100");
    expect(item.className).not.toContain("data-[status=locked]:opacity-50");
  });

  it("gives a row that cannot be entered no button", () => {
    render(<BaseStepRail rows={rows} onGo={vi.fn()} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Deploy it/ })).toBeNull();
  });
});
