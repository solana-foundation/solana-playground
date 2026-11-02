// The send button's play shape: the ring around it must not be drawn at
// all, since any crop of the ring's box still leaves slivers of the ring in
// its corners. A file of its own: the installed component is never edited by
// hand.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LogoMark, LogoPlay } from "./logo";

/** The subpaths of every path an svg draws, each from its `M` */
const subpaths = (svg: Element) =>
  [...svg.querySelectorAll("path")].flatMap((p) =>
    (p.getAttribute("d") ?? "").split(/(?=M)/).map((s) => s.trim())
  );

describe("LogoPlay", () => {
  it("draws the mark's play shape without its ring", () => {
    const mark = subpaths(render(<LogoMark />).container.firstElementChild!);
    const play = subpaths(render(<LogoPlay />).container.firstElementChild!);
    // The ring is the mark's first two subpaths: its outer edge and its hole
    const ring = mark.slice(0, 2);

    expect(play).toEqual(mark.slice(2));
    ring.forEach((edge) => expect(play).not.toContain(edge));
  });
});
