// An input's label: its name in mono, its type and modifiers as tags.
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import InputLabel from "./InputLabel";

const tags = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-slot="tag"]')).map(
    (t) => t.textContent
  );

it("labels name the type, mut and signer as tags", () => {
  const { container } = render(
    <InputLabel name="authority" type="publicKey" isMut isSigner />
  );
  expect(screen.getByText("authority").className).toContain("font-mono");
  expect(tags(container)).toEqual(["publicKey", "mut", "signer"]);
});

// `Tag` sets its text in capitals; a type is code and keeps its own case
it("the type tag keeps the type's case, in mono", () => {
  const { container } = render(
    <InputLabel name="authority" type="publicKey" />
  );
  const type = container.querySelector('[data-slot="tag"]')!;
  expect(type.className).toContain("normal-case");
  expect(type.className).toContain("font-mono");
});

it("a plain input carries its type alone", () => {
  const { container } = render(<InputLabel name="amount" type="u64" />);
  expect(tags(container)).toEqual(["u64"]);
});

// A seed still being picked has no type yet (`FromSeed`)
it("an empty type draws no tag", () => {
  const { container } = render(<InputLabel name="seed(1)" type="" />);
  expect(tags(container)).toEqual([]);
});
