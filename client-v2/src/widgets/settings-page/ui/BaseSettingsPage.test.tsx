import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import BaseSettingRow from "./BaseSettingRow";
import BaseSettingsPage from "./BaseSettingsPage";
import type { SettingsSection } from "./BaseSettingsPage";

const TITLES = [
  "Network",
  "Project",
  "Block Explorer",
  "Build",
  "Connection",
  "Editor",
  "Notification",
  "Server",
  "Test UI",
  "UI",
  "Wallet",
  "Experimental",
];

const sections: SettingsSection[] = TITLES.map((title) => ({
  id: title.toLowerCase().replace(/ /g, "-"),
  title,
  content: <p>{`${title} content`}</p>,
}));

const scrollIntoView = vi.fn();
beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(() => {
  scrollIntoView.mockReset();
});

const draw = (props: { phone?: boolean; current?: string } = {}) => {
  const onPick = vi.fn();
  const onBack = vi.fn();
  render(
    <BaseSettingsPage
      sections={sections}
      current={props.current ?? "network"}
      onPick={onPick}
      onCurrentChange={vi.fn()}
      onBack={onBack}
      phone={props.phone ?? false}
      focus="page"
      onEscape={vi.fn()}
    />
  );
  return { onPick, onBack };
};

const sectionList = () =>
  screen.getByRole("navigation", { name: "Settings sections" });

it("lists every section and marks the current one", () => {
  draw({ current: "editor" });
  const list = within(sectionList());
  const buttons = list.getAllByRole("button");
  expect(buttons.map((b) => b.textContent)).toEqual(TITLES);
  const editor = list.getByRole("button", { name: "Editor" });
  expect(editor.getAttribute("aria-current")).toBe("true");
  const network = list.getByRole("button", { name: "Network" });
  expect(network.hasAttribute("aria-current")).toBe(false);
});

it("a pick scrolls the section into view", async () => {
  const { onPick } = draw();
  await userEvent.click(
    within(sectionList()).getByRole("button", { name: "Editor" })
  );
  expect(onPick).toHaveBeenCalledExactlyOnceWith("editor");
  const editor = screen.getByRole("region", { name: "Editor" });
  expect(scrollIntoView.mock.contexts).toEqual([editor]);
});

it("a picked section stays current while the scroll it caused settles", async () => {
  // A section near the end cannot scroll to the top, so the one before it
  // still crosses the band the list follows
  let report: IntersectionObserverCallback = () => undefined;
  class ReportingObserver {
    constructor(callback: IntersectionObserverCallback) {
      report = callback;
    }
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal("IntersectionObserver", ReportingObserver);
  const onCurrentChange = vi.fn();
  render(
    <BaseSettingsPage
      sections={sections}
      current="network"
      onPick={vi.fn()}
      onCurrentChange={onCurrentChange}
      onBack={vi.fn()}
      phone={false}
      focus="page"
      onEscape={vi.fn()}
    />
  );
  const ui = screen.getByRole("region", { name: "UI" });
  const crossing = [{ target: ui, isIntersecting: true }];
  const observer = {} as IntersectionObserver;

  await userEvent.click(
    within(sectionList()).getByRole("button", { name: "Experimental" })
  );
  act(() =>
    report(crossing as unknown as IntersectionObserverEntry[], observer)
  );
  expect(onCurrentChange).not.toHaveBeenCalled();

  // The user scrolls on their own: the list follows again
  fireEvent.wheel(ui);
  act(() =>
    report(crossing as unknown as IntersectionObserverEntry[], observer)
  );
  expect(onCurrentChange).toHaveBeenCalledExactlyOnceWith("ui");
  vi.unstubAllGlobals();
});

it("Back to app calls onBack", async () => {
  const { onBack } = draw();
  await userEvent.click(screen.getByRole("button", { name: "Back to app" }));
  expect(onBack).toHaveBeenCalledOnce();
});

it("is the region named Settings, headed Settings", () => {
  draw();
  const page = screen.getByRole("region", { name: "Settings" });
  // `getBy` throws when the heading is missing
  within(page).getByRole("heading", { level: 1, name: "Settings" });
});

it("on a phone there is no section list, and the bar carries Back to app and the title", () => {
  draw({ phone: true });
  expect(
    screen.queryByRole("navigation", { name: "Settings sections" })
  ).toBeNull();
  const bar = within(screen.getByTestId("settings-bar"));
  bar.getByRole("button", { name: "Back to app" });
  bar.getByRole("heading", { level: 1, name: "Settings" });
});

const layoutOf = (name: string) =>
  screen.getByText(name).closest("[data-layout]")?.getAttribute("data-layout");

it("a small control, such as a checkbox, stays beside the text on a phone", () => {
  render(
    <BaseSettingRow
      name="Word wrap"
      control={<button>toggle</button>}
      small
      phone
    />
  );
  expect(layoutOf("Word wrap")).toBe("inline");
});

it("a row puts its control beside the text, and under it on a phone", () => {
  const { rerender } = render(
    <BaseSettingRow
      name="Word wrap"
      description="Wrap long lines"
      control={<button>toggle</button>}
      phone={false}
    />
  );
  expect(layoutOf("Word wrap")).toBe("inline");
  screen.getByText("Wrap long lines");
  rerender(
    <BaseSettingRow name="Word wrap" control={<button>toggle</button>} phone />
  );
  expect(layoutOf("Word wrap")).toBe("stacked");
});

const chip = (name: string, checked: boolean) => (
  <button key={name} role="radio" aria-checked={checked}>
    {name}
  </button>
);

const drawFocused = (props: {
  focus: "page" | "network";
  modalUp?: boolean;
  chips: { name: string; checked: boolean }[];
}) => {
  const onEscape = vi.fn();
  const content = (
    <div role="radiogroup" aria-label="Network">
      {props.chips.map((c) => chip(c.name, c.checked))}
    </div>
  );
  render(
    <BaseSettingsPage
      sections={[{ id: "network", title: "Network", content }]}
      current="network"
      onPick={vi.fn()}
      onCurrentChange={vi.fn()}
      onBack={vi.fn()}
      phone={false}
      focus={props.focus}
      onEscape={props.modalUp ? null : onEscape}
    />
  );
  return onEscape;
};

const DEVNET_TESTNET = [
  { name: "Devnet", checked: false },
  { name: "Testnet", checked: true },
];

it('focus "network" lands on the checked network', () => {
  drawFocused({ focus: "network", chips: DEVNET_TESTNET });
  expect(document.activeElement?.textContent).toBe("Testnet");
});

it("an endpoint no chip lists focuses the first chip", () => {
  drawFocused({
    focus: "network",
    chips: [
      { name: "Devnet", checked: false },
      { name: "Testnet", checked: false },
    ],
  });
  expect(document.activeElement?.textContent).toBe("Devnet");
});

it('focus "page" lands on the heading', () => {
  drawFocused({ focus: "page", chips: DEVNET_TESTNET });
  expect(document.activeElement).toBe(
    screen.getByRole("heading", { level: 1, name: "Settings" })
  );
});

it("Escape closes", async () => {
  const onEscape = drawFocused({ focus: "page", chips: DEVNET_TESTNET });
  await userEvent.keyboard("{Escape}");
  expect(onEscape).toHaveBeenCalledOnce();
});

it("Escape that a layer above already took (an open select) leaves the page open", async () => {
  const onEscape = drawFocused({ focus: "page", chips: DEVNET_TESTNET });
  // Radix's layers handle Escape on the capture phase and prevent it
  const takeIt = (ev: KeyboardEvent) => ev.preventDefault();
  document.addEventListener("keydown", takeIt, { capture: true });
  await userEvent.keyboard("{Escape}");
  document.removeEventListener("keydown", takeIt, { capture: true });
  expect(onEscape).not.toHaveBeenCalled();
});

it("Escape while a modal is up leaves the page open", async () => {
  const onEscape = drawFocused({
    focus: "page",
    modalUp: true,
    chips: DEVNET_TESTNET,
  });
  await userEvent.keyboard("{Escape}");
  expect(onEscape).not.toHaveBeenCalled();
});
