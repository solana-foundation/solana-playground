import { isValidElement } from "react";
import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

// The connected Homes pull in the `@/utils` barrel; the slot only picks one
vi.mock("./Home", () => ({ default: () => null }));
vi.mock("./PhoneHome", () => ({ default: () => null }));

import Home from "./Home";
import { homeSlot } from "./home-slot";
import PhoneHome from "./PhoneHome";

const openAssistant = () => {};
const onContinue = vi.fn();

/** What the slot draws, asserted to be one element */
const drawn = (slot: ReturnType<typeof homeSlot>) => {
  const node = slot?.({ openAssistant });
  expect(isValidElement(node)).toBe(true);
  return node as ReactElement<{ onAsk: () => void; onContinue?: () => void }>;
};

it.each(["wide", "compact", "phone"] as const)(
  "gives no Home once the work shows (%s)",
  (viewport) => {
    expect(homeSlot("work", viewport, onContinue)).toBeUndefined();
  }
);

it.each(["wide", "compact", "phone"] as const)(
  "holds Home's place with a spinner while the start is pending (%s)",
  (viewport) => {
    render(
      <>{homeSlot("pending", viewport, onContinue)?.({ openAssistant })}</>
    );
    expect(screen.getByRole("status", { name: "Loading" })).toBeTruthy();
  }
);

it("draws the phone's Home on a phone, opening the assistant from its composer", () => {
  const home = drawn(homeSlot("home", "phone", onContinue));
  expect(home.type).toBe(PhoneHome);
  expect(home.props.onAsk).toBe(openAssistant);
  expect(home.props.onContinue).toBe(onContinue);
});

it.each(["wide", "compact"] as const)(
  "draws the desktop Home on %s",
  (viewport) => {
    const home = drawn(homeSlot("home", viewport, onContinue));
    expect(home.type).toBe(Home);
    expect(home.props.onAsk).toBe(openAssistant);
  }
);
