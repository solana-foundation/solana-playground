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

/**
 * Lays the row out `width` px wide from `rowLeft`, and each tab named in
 * `tabs` at its `[left, right]`; every other element is 0x0, as jsdom lays
 * nothing out
 */
const placeTabs = (
  width: number,
  tabs: Record<string, [number, number]>,
  rowLeft = 0
) =>
  vi
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: Element) {
      if (this.getAttribute("role") === "tablist") {
        return new DOMRect(rowLeft, 0, width, 40);
      }
      const name = this.querySelector('[role="tab"]')?.textContent ?? "";
      const [left, right] = tabs[name] ?? [0, 0];
      return new DOMRect(left, 0, right - left, 40);
    });

describe("BaseEditorTabs scrolling", () => {
  afterEach(() => vi.restoreAllMocks());

  it("scrolls the row by the least that shows the current tab, close included, on mount", () => {
    placeTabs(200, { "b.rs": [250, 330] });
    setup();
    expect(screen.getByRole("tablist").scrollLeft).toBe(130);
  });

  it("scrolls the row back to a current tab before its start", () => {
    const { view } = setup();
    const list = screen.getByRole("tablist");
    list.scrollLeft = 300;
    placeTabs(200, { "c.rs": [-80, -10] });

    view.rerender(row("c.rs", vi.fn()));

    expect(list.scrollLeft).toBe(220);
  });

  // On a phone the row sits on a pager page, a window's width or more along
  it("measures the tab against the row wherever the row is", () => {
    placeTabs(200, { "b.rs": [643, 723] }, 393);
    setup();
    expect(screen.getByRole("tablist").scrollLeft).toBe(130);
  });

  it("brings a tab wider than the row in by its start", () => {
    const { view } = setup();
    const list = screen.getByRole("tablist");
    list.scrollLeft = 300;
    placeTabs(200, { "c.rs": [-50, 250] });

    view.rerender(row("c.rs", vi.fn()));

    expect(list.scrollLeft).toBe(250);
  });

  it("leaves the row alone when the current tab is whole in it", () => {
    placeTabs(200, { "b.rs": [60, 140] });
    setup();
    expect(screen.getByRole("tablist").scrollLeft).toBe(0);
  });

  // On a phone the row sits in the pager: scrolling the containers around
  // it would move the pager back to the work page under a swipe (HOO-2290)
  it("scrolls nothing around the row", () => {
    placeTabs(200, { "b.rs": [250, 330] });
    setup();
    expect(scrolled).not.toHaveBeenCalled();
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
