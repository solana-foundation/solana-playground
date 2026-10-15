import { render } from "@testing-library/react";
import { expect, it } from "vitest";

import Logomark from "./Logomark";

it("draws the design system's mark, hidden from assistive technology", () => {
  const { container } = render(<Logomark aria-hidden="true" />);
  const mark = container.querySelector("[data-slot=logo-mark]");
  expect(mark).toBeTruthy();
  expect(mark?.getAttribute("aria-hidden")).toBe("true");
});
