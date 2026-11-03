// An input's label: its name in mono, its type quiet beside it, modifiers as tags.
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import InputLabel from "./InputLabel";

const tags = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-slot="tag"]')).map(
    (t) => t.textContent
  );
const type = (container: HTMLElement) =>
  container.querySelector('[data-slot="input-type"]');

it("labels name the type, then mut and signer as tags", () => {
  const { container } = render(
    <InputLabel name="authority" type="publicKey" isMut isSigner />
  );
  expect(screen.getByText("authority").className).toContain("font-mono");
  expect(type(container)?.textContent).toBe("publicKey");
  expect(tags(container)).toEqual(["mut", "signer"]);
});

// A modifier is a fact about the account, not a warning
it("mut and signer take the neutral tag", () => {
  const { container } = render(
    <InputLabel name="authority" type="publicKey" isMut isSigner />
  );
  const variants = Array.from(
    container.querySelectorAll('[data-slot="tag"]')
  ).map((t) => t.getAttribute("data-variant"));
  expect(variants).toEqual(["neutral", "neutral"]);
});

it("a plain input carries its type alone", () => {
  const { container } = render(<InputLabel name="amount" type="u64" />);
  expect(type(container)?.textContent).toBe("u64");
  expect(tags(container)).toEqual([]);
});

// A seed still being picked has no type yet (`FromSeed`)
it("an empty type draws nothing for it", () => {
  const { container } = render(<InputLabel name="seed(1)" type="" />);
  expect(type(container)).toBeNull();
});
