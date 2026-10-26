import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { BaseEditorTab } from "./BaseEditorTab";
import { BaseEditorTabs } from "./BaseEditorTabs";

const FILES = ["a.rs", "b.rs", "c.rs"];

/** Every `scrollIntoView` call: the element and its options */
const scrolled = vi.fn();
const original = Element.prototype.scrollIntoView;
// jsdom lays nothing out and has no `scrollIntoView`
beforeAll(() => {
  Element.prototype.scrollIntoView = function (
    this: Element,
    arg?: boolean | ScrollIntoViewOptions
  ) {
    scrolled(this, arg);
  };
});
afterEach(() => scrolled.mockReset());
afterAll(() => {
  Element.prototype.scrollIntoView = original;
});

/** The row with `current` as the current tab and a Wallet button in `end` */
const row = (current: string, onSelect: (name: string) => void) => (
  <BaseEditorTabs
    id="tabs"
    current={`/${current}`}
    end={<button type="button">Wallet</button>}
  >
    {FILES.map((name) => (
      <BaseEditorTab
        key={name}
        path={`/${name}`}
        name={name}
        icon={null}
        current={name === current}
        menuOpen={false}
        onSelect={() => onSelect(name)}
        onClose={vi.fn()}
      />
    ))}
  </BaseEditorTabs>
);

/** Three tabs, `b.rs` current, and a Wallet button in `end` */
const setup = () => {
  const onSelect = vi.fn();
  const view = render(row("b.rs", onSelect));
  const tab = (name: string) => screen.getByRole("tab", { name });
  return { onSelect, tab, view, user: userEvent.setup() };
};

/** The tab a trigger sits in, close button and all */
const frameOf = (trigger: HTMLElement) =>
  trigger.closest('[data-slot="editor-tab"]');

/** The row's scroller, laid out as `scrollWidth` wide in `clientWidth` */
const layOut = (scrollWidth: number, clientWidth: number) => {
  const list = screen.getByRole("tablist");
  Object.defineProperty(list, "scrollWidth", { value: scrollWidth });
  Object.defineProperty(list, "clientWidth", { value: clientWidth });
  return list;
};

describe("BaseEditorTabs", () => {
  it("holds only the tabs in the tab list; end sits beside it", () => {
    setup();
    const list = screen.getByRole("tablist");
    expect(
      within(list)
        .getAllByRole("tab")
        .map((tab) => tab.textContent)
    ).toEqual(FILES);
    const wallet = screen.getByRole("button", { name: "Wallet" });
    expect(list.contains(wallet)).toBe(false);
    expect(document.getElementById("tabs")!.contains(wallet)).toBe(true);
    expect(document.getElementById("tabs")!.contains(list)).toBe(true);
  });

  it("moves focus with the arrow keys, wrapping, and opens nothing", async () => {
    const { onSelect, tab, user } = setup();
    tab("b.rs").focus();

    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(tab("c.rs"));
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(tab("a.rs"));
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(tab("c.rs"));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("moves focus to the first tab on Home and the last on End", async () => {
    const { onSelect, tab, user } = setup();
    tab("b.rs").focus();

    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(tab("a.rs"));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(tab("c.rs"));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("opens the focused tab's file on Enter", async () => {
    const { onSelect, tab, user } = setup();
    tab("b.rs").focus();

    await user.keyboard("{ArrowRight}{Enter}");

    expect(onSelect.mock.calls).toEqual([["c.rs"]]);
  });

  it("moves from a tab's close button to the next trigger", async () => {
    const { tab, user } = setup();
    screen.getByRole("button", { name: "Close a.rs" }).focus();

    await user.keyboard("{ArrowRight}");

    expect(document.activeElement).toBe(tab("b.rs"));
  });
});

describe("BaseEditorTabs scrolling", () => {
  it("scrolls the current tab, close included, into view on mount", () => {
    const { tab } = setup();
    expect(scrolled.mock.calls).toEqual([
      [frameOf(tab("b.rs")), { block: "nearest", inline: "nearest" }],
    ]);
  });

  it("scrolls the new current tab into view when it changes", () => {
    const { tab, view } = setup();
    scrolled.mockReset();

    view.rerender(row("c.rs", vi.fn()));

    expect(scrolled.mock.calls).toEqual([
      [frameOf(tab("c.rs")), { block: "nearest", inline: "nearest" }],
    ]);
  });

  it("turns a vertical wheel into a sideways scroll when the row overflows", () => {
    setup();
    const list = layOut(600, 200);

    const passed = fireEvent.wheel(list, { deltaY: 120, deltaX: 0 });

    expect(list.scrollLeft).toBe(120);
    expect(passed).toBe(false);
  });

  it("leaves the wheel alone when the row fits", () => {
    setup();
    const list = layOut(200, 200);

    const passed = fireEvent.wheel(list, { deltaY: 120, deltaX: 0 });

    expect(list.scrollLeft).toBe(0);
    expect(passed).toBe(true);
  });

  it("leaves a mostly sideways wheel to the browser", () => {
    setup();
    const list = layOut(600, 200);

    const passed = fireEvent.wheel(list, { deltaY: 10, deltaX: 40 });

    expect(list.scrollLeft).toBe(0);
    expect(passed).toBe(true);
  });
});
