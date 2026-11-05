import { expect, test } from "@playwright/test";

import { LAYOUT_BREAKPOINTS } from "../src/shared/lib/hooks/use-viewport";
import { DESK, PHONE, TABLET, WIDE_DESK } from "./viewports";

test("each window size sits in the viewport class it is named for", () => {
  expect(PHONE.width).toBeLessThan(LAYOUT_BREAKPOINTS.phone);
  expect(TABLET.width).toBeGreaterThanOrEqual(LAYOUT_BREAKPOINTS.phone);
  expect(TABLET.width).toBeLessThan(LAYOUT_BREAKPOINTS.compact);
  expect(DESK.width).toBeGreaterThanOrEqual(LAYOUT_BREAKPOINTS.compact);
  expect(WIDE_DESK.width).toBeGreaterThan(DESK.width);
});
