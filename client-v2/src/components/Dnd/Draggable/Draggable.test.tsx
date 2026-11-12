import { fireEvent, render, screen } from "@testing-library/react";
import { forwardRef } from "react";
import { describe, expect, it, vi } from "vitest";

import Context from "../Context/Context";
import Draggable from "./Draggable";

type RowProps = { name: string; onClick: () => void };

const Row = forwardRef<HTMLDivElement, RowProps>(({ name, ...props }, ref) => (
  <div ref={ref} {...props}>
    {name}
  </div>
));

const renderRow = () => {
  const onClick = vi.fn();
  render(
    <Context>
      <Draggable id="row" Item={Row} itemProps={{ name: "lib.rs", onClick }} />
    </Context>
  );
  return { onClick, row: screen.getByRole("button", { name: "lib.rs" }) };
};

describe("Draggable", () => {
  it("is a button in the Tab order", () => {
    const { row } = renderRow();
    expect(row.getAttribute("tabindex")).toBe("0");
  });

  it("presses on Enter and on Space, as a button does", () => {
    const { onClick, row } = renderRow();
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("leaves other keys alone", () => {
    const { onClick, row } = renderRow();
    const typed = fireEvent.keyDown(row, { key: "a" });
    expect(typed).toBe(true);
    expect(onClick).not.toHaveBeenCalled();
  });
});
