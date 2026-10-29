import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import TutorialCover from "./TutorialCover";

const tile = (container: HTMLElement) =>
  container.firstElementChild as HTMLElement;

describe("TutorialCover", () => {
  it("is decorative", () => {
    const { container } = render(<TutorialCover name="Hello Anchor" />);
    expect(tile(container).getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector("img")).toBeNull();
  });

  it("lays an Anchor tutorial on the deep ground", () => {
    const { container } = render(
      <TutorialCover name="Hello Anchor" framework="Anchor" />
    );
    // BEDS.deep, #6858D2
    expect(tile(container).style.backgroundColor).toBe("rgb(104, 88, 210)");
  });

  it("lays a tutorial with no known framework on the haze ground", () => {
    const { container } = render(<TutorialCover name="Hello Solana" />);
    // BEDS.haze, #B8A6F5
    expect(tile(container).style.backgroundColor).toBe("rgb(184, 166, 245)");
  });

  it("paints its fields on the tile, so nothing inside runs past its edge", () => {
    const { container } = render(
      <TutorialCover name="Hello Anchor" framework="Anchor" />
    );
    // A phone's layout check reads every element's scroll width: a field
    // drawn as a child past the edge counts there even when clipped
    expect(Array.from(tile(container).children).map((c) => c.tagName)).toEqual([
      "svg",
    ]);
    expect(tile(container).style.backgroundImage).toContain("radial-gradient");
  });

  it("places the mark the same way for one name every time", () => {
    const viewBox = () =>
      render(<TutorialCover name="Hello Anchor" framework="Anchor" />)
        .container.querySelector("svg")
        ?.getAttribute("viewBox");
    expect(viewBox()).toBe(viewBox());
  });
});
