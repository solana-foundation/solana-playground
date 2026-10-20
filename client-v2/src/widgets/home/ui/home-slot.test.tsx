import { isValidElement } from "react";
import type { ReactElement } from "react";
import { expect, it, vi } from "vitest";

// The connected Homes pull in the `@/utils` barrel; the slot only picks one
vi.mock("./Home", () => ({ default: () => null }));
vi.mock("./PhoneHome", () => ({ default: () => null }));

import Home from "./Home";
import { homeSlot, isHomeShown } from "./home-slot";
import PhoneHome from "./PhoneHome";

const openAssistant = () => {};

/** What the slot draws, asserted to be one element */
const drawn = (slot: ReturnType<typeof homeSlot>) => {
  const node = slot?.({ openAssistant });
  expect(isValidElement(node)).toBe(true);
  return node as ReactElement<{ onAsk: () => void }>;
};

it.each(["wide", "compact", "phone"] as const)(
  "gives no Home once the work shows (%s)",
  (viewport) => {
    expect(homeSlot("work", viewport)).toBeUndefined();
  }
);

it.each(["wide", "compact", "phone"] as const)(
  "keeps Home's place empty while the start is pending (%s)",
  (viewport) => {
    const slot = homeSlot("pending", viewport);
    expect(slot).toBeDefined();
    expect(slot?.({ openAssistant })).toBeNull();
  }
);

it("draws the phone's Home on a phone, opening the assistant from its composer", () => {
  const home = drawn(homeSlot("home", "phone"));
  expect(home.type).toBe(PhoneHome);
  expect(home.props.onAsk).toBe(openAssistant);
});

it.each(["wide", "compact"] as const)(
  "draws the desktop Home on %s",
  (viewport) => {
    const home = drawn(homeSlot("home", viewport));
    expect(home.type).toBe(Home);
    expect(home.props.onAsk).toBe(openAssistant);
  }
);

it.each([
  ["home", true],
  ["pending", false],
  ["work", false],
] as const)("counts %s as Home shown: %s", (start, shown) => {
  expect(isHomeShown(start)).toBe(shown);
});
