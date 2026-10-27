import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { PgExplorer } from "../../../../utils";
import { useResetCtxSelected } from "./useResetCtxSelected";

// The utils barrel needs build-time globals the unit runner does not define.
vi.mock("../../../../utils", () => ({
  PgExplorer: { removeCtxSelectedEl: vi.fn() },
  PgCommon: { isNonNullish: (v: unknown) => v != null },
}));

const Probe = () => {
  const ref = useRef<HTMLDivElement>(null);
  useResetCtxSelected(ref);
  return <div ref={ref}>explorer</div>;
};

describe("useResetCtxSelected", () => {
  it("keeps the selection on a press inside the menu and clears it elsewhere", () => {
    const clear = vi.mocked(PgExplorer.removeCtxSelectedEl);
    clear.mockClear();
    render(
      <>
        <Probe />
        <div data-slot="context-menu-content">
          <span data-testid="item">Rename</span>
        </div>
        <span data-testid="elsewhere">elsewhere</span>
      </>
    );

    fireEvent.mouseDown(screen.getByTestId("item"));
    expect(clear).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByTestId("elsewhere"));
    expect(clear).toHaveBeenCalledTimes(1);
  });
});
