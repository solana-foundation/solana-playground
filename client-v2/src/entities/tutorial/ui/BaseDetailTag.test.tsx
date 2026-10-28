import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { BaseDetailTag } from "./BaseDetailTag";

const tagOf = (text: string) => screen.getByText(text).closest("[data-slot]");

it("tints a known level by its colour", () => {
  render(<BaseDetailTag kind="level" label="Advanced" />);
  expect(tagOf("Advanced")?.getAttribute("data-variant")).toBe("info");
});

it("marks an unknown level as an error", () => {
  render(<BaseDetailTag kind="level" label="Expert" />);
  expect(tagOf("Expert")?.getAttribute("data-variant")).toBe("error");
});

it("shows a framework's icon before its name, in a box rather than a tag", () => {
  render(
    <BaseDetailTag
      kind="framework"
      label="Anchor"
      icon={<img alt="" data-testid="icon" />}
    />
  );
  const tag = tagOf("Anchor");
  expect(tag?.getAttribute("data-slot")).toBe("detail");
  expect(tag?.firstElementChild).toBe(screen.getByTestId("icon"));
});

it("renders a plain box without an icon", () => {
  render(<BaseDetailTag kind="categories" label="NFT" />);
  const tag = tagOf("NFT");
  expect(tag?.getAttribute("data-slot")).toBe("detail");
  expect(tag?.children.length).toBe(0);
});

it("takes a round icon's class from the caller", () => {
  render(
    <BaseDetailTag
      kind="framework"
      label="Seahorse"
      icon={<img alt="" />}
      className="[&>img]:rounded-full"
    />
  );
  expect(tagOf("Seahorse")?.className).toContain("[&>img]:rounded-full");
});
