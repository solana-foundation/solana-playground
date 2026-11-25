import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { isValidElement } from "react";
import { expect, it, vi } from "vitest";

// The connected Homes pull in the `@/utils` barrel; the slot only picks one
vi.mock("./Home", () => ({ default: () => null }));
vi.mock("./PhoneHome", () => ({ default: () => null }));
// The panel's store, which takes the question
vi.mock("../../../views/sidebar/assistant/store", () => ({
  PgAssistant: { requestPrompt: vi.fn() },
}));

import { PgAssistant } from "../../../views/sidebar/assistant/store";
import Home from "./Home";
import { homeSlot } from "./home-slot";
import PhoneHome from "./PhoneHome";

const openAssistant = vi.fn();
const onContinue = vi.fn();
const openPage = vi.fn();
const ask = { hint: undefined, sends: true };

/** What the slot draws, asserted to be one element */
const drawn = (slot: ReturnType<typeof homeSlot>) => {
  const node = slot?.({ openAssistant });
  expect(isValidElement(node)).toBe(true);
  return node as ReactElement<{
    onAsk: (text: string) => void;
    sendHint?: string;
    onContinue?: () => void;
    onOpenPage: () => void;
  }>;
};

it.each(["wide", "compact", "phone"] as const)(
  "gives no Home once the work shows (%s)",
  (viewport) => {
    expect(
      homeSlot("work", viewport, onContinue, openPage, ask)
    ).toBeUndefined();
  }
);

it.each(["wide", "compact", "phone"] as const)(
  "holds Home's place with a spinner while the start is pending (%s)",
  (viewport) => {
    render(
      <>
        {homeSlot(
          "pending",
          viewport,
          onContinue,
          openPage,
          ask
        )?.({
          openAssistant,
        })}
      </>
    );
    expect(screen.getByRole("status", { name: "Loading" })).toBeTruthy();
  }
);

it("draws the phone's Home on a phone, opening the assistant from its composer", () => {
  const home = drawn(homeSlot("home", "phone", onContinue, openPage, ask));
  expect(home.type).toBe(PhoneHome);
  expect(home.props.onContinue).toBe(onContinue);
  expect(home.props.onOpenPage).toBe(openPage);
});

it.each(["wide", "compact"] as const)(
  "draws the desktop Home on %s",
  (viewport) => {
    const home = drawn(homeSlot("home", viewport, onContinue, openPage, ask));
    expect(home.type).toBe(Home);
    expect(home.props.onOpenPage).toBe(openPage);
  }
);

it("sends the question at once when a model can answer", () => {
  vi.mocked(PgAssistant.requestPrompt).mockClear();
  openAssistant.mockClear();
  const home = drawn(homeSlot("home", "wide", onContinue, openPage, ask));
  home.props.onAsk("What is a PDA?");
  expect(openAssistant).toHaveBeenCalledOnce();
  expect(PgAssistant.requestPrompt).toHaveBeenCalledWith("What is a PDA?", {
    send: true,
  });
});

it("leaves the question in the panel's composer, and says what a send needs, while none can", () => {
  vi.mocked(PgAssistant.requestPrompt).mockClear();
  const off = {
    hint: "Sign in or add a key to send",
    sends: false,
  };
  const home = drawn(homeSlot("home", "phone", onContinue, openPage, off));
  expect(home.props.sendHint).toBe(off.hint);
  home.props.onAsk("What is a PDA?");
  expect(PgAssistant.requestPrompt).toHaveBeenCalledWith("What is a PDA?", {
    send: false,
  });
});
