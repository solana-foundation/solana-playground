// The window's pattern: its light follows the pointer from one animation
// frame loop, which must stop once the light has caught up and must leave
// nothing behind when the pattern unmounts. A file of its own: it renders
// React, and the installed component is never edited by hand.
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Pattern } from "./pattern";

/** Runs queued frames by hand, so the test decides when the loop ticks */
const frames = () => {
  const queue = new Map<number, FrameRequestCallback>();
  let next = 1;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    queue.set(next, cb);
    return next++;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => queue.delete(id));
  return {
    pending: () => queue.size,
    /** Runs every queued frame once; returns how many ran */
    flush: () => {
      const due = [...queue.entries()];
      queue.clear();
      due.forEach(([, cb]) => cb(0));
      return due.length;
    },
  };
};

const move = (x: number, y: number) =>
  window.dispatchEvent(
    new PointerEvent("pointermove", { clientX: x, clientY: y })
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shared/ui/pattern", () => {
  it("lights where the pointer is, then stops its loop", () => {
    const raf = frames();
    const { container } = render(<Pattern />);
    const root = container.querySelector<HTMLElement>('[data-slot="pattern"]')!;

    move(120, 80);
    let ran = 0;
    while (raf.pending() && ran < 500) ran += raf.flush();

    expect(raf.pending()).toBe(0);
    expect(root.style.getPropertyValue("--lx")).toBe("120.0px");
    expect(root.style.getPropertyValue("--ly")).toBe("80.0px");
  });

  it("leaves no listener and no frame behind when it unmounts", () => {
    const raf = frames();
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<Pattern />);

    move(10, 10);
    unmount();

    const added = add.mock.calls.filter(([type]) => type === "pointermove");
    const removed = remove.mock.calls.filter(
      ([type]) => type === "pointermove"
    );
    expect(removed.map(([, fn]) => fn)).toEqual(added.map(([, fn]) => fn));
    expect(raf.pending()).toBe(0);
  });
});
