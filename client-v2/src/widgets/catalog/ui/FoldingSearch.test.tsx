import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";

import FoldingSearch from "./FoldingSearch";

/** The search as its page holds it, with the query shown for the assertions */
const Page = () => {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <FoldingSearch
      label="tutorials"
      placeholder="Search 3 tutorials"
      query={query}
      onQuery={setQuery}
      open={open}
      onOpen={setOpen}
    />
  );
};

const field = () =>
  screen.getByRole<HTMLInputElement>("searchbox", { name: "Search tutorials" });
const glass = () => screen.getByRole("button", { name: "Search tutorials" });

it("opens on the glass and puts the focus in the field within the press", () => {
  render(<Page />);
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();

  fireEvent.click(glass());

  expect(document.activeElement).toBe(field());
  expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Search tutorials" })).toBeNull();
});

it("gives the row back on Cancel, with what was typed gone", () => {
  render(<Page />);
  fireEvent.click(glass());
  fireEvent.change(field(), { target: { value: "anchor" } });

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(field().value).toBe("");
  expect(glass()).toBeTruthy();
});

it("keeps the row while the field is cleared by hand", () => {
  render(<Page />);
  fireEvent.click(glass());
  fireEvent.change(field(), { target: { value: "a" } });
  fireEvent.change(field(), { target: { value: "" } });
  expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
});

it("takes back what was typed on Esc, then the open row", () => {
  render(<Page />);
  fireEvent.click(glass());
  fireEvent.change(field(), { target: { value: "anchor" } });

  fireEvent.keyDown(field(), { key: "Escape" });
  expect(field().value).toBe("");
  expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();

  fireEvent.keyDown(field(), { key: "Escape" });
  expect(glass()).toBeTruthy();
  // Folded, the field is out of sight: typing must not land in it
  expect(document.activeElement).toBe(glass());
});
