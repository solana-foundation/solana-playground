import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { useOnClickOutside } from "./useOnClickOutside";

const IGNORED = ".ignored";

const Probe = ({ cb }: { cb: () => void }) => {
  const ref = useRef<HTMLDivElement>(null);
  useOnClickOutside(ref, cb, true, IGNORED);
  return <div ref={ref}>inside</div>;
};

describe("useOnClickOutside with an ignore selector", () => {
  it("does not fire for a press inside the ignored element ", () => {
    const cb = vi.fn();
    render(
      <>
        <Probe cb={cb} />
        <div className="ignored">
          <span data-testid="item">Rename</span>
        </div>
        <span data-testid="elsewhere">elsewhere</span>
      </>
    );

    fireEvent.mouseDown(screen.getByTestId("item"));
    expect(cb).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByTestId("elsewhere"));
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe("useOnClickOutside and toasts", () => {
  it("does not fire for a press on a toast", () => {
    const cb = vi.fn();
    render(
      <>
        <Probe cb={cb} />
        <section data-sonner-toaster="">
          <button>Change endpoint</button>
        </section>
      </>
    );

    fireEvent.mouseDown(
      screen.getByRole("button", { name: "Change endpoint" })
    );
    expect(cb).not.toHaveBeenCalled();
  });
});
