import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OutletContent, useOutletNode } from "@/shared/lib/outlet";

import { PHONE_PAGES } from "../model/phone-pages";
import BasePhonePager, { SWIPE_SETTLE_MS } from "./BasePhonePager";
import type { BasePhonePagerProps } from "./BasePhonePager";

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let pageWidth = 390;
const widthDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "clientWidth"
);

beforeEach(() => {
  pageWidth = 390;
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  // jsdom has no layout: the pager is as wide as the test says
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => pageWidth,
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  if (widthDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      "clientWidth",
      widthDescriptor
    );
  } else {
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  }
});

/** The fields a test sets itself; the rest are the defaults below */
type Choice = Partial<BasePhonePagerProps>;

const Harness = (choice: Choice) => {
  const stageNode = useOutletNode("flex min-h-0 flex-1 flex-col");
  const consoleNode = useOutletNode("flex min-h-0 flex-1 flex-col");
  const pager: BasePhonePagerProps = {
    page: choice.page ?? "work",
    onSwipe: choice.onSwipe ?? vi.fn(),
    onGo: choice.onGo ?? vi.fn(),
    view: choice.view ?? "code",
    onView: choice.onView ?? vi.fn(),
    title: choice.title ?? "my-program",
    file: choice.file === undefined ? null : choice.file,
    filesOpen: choice.filesOpen ?? false,
    onFilesOpenChange: choice.onFilesOpenChange ?? vi.fn(),
    stageOn: choice.stageOn ?? "work",
    menu: <nav>menu slot</nav>,
    assistant: <div>assistant slot</div>,
    files: <aside>files slot</aside>,
    stageBar: <header>stage bar</header>,
    stageNode,
    consoleNode,
    consoleOpen: choice.consoleOpen ?? false,
    home: choice.home,
    cover: choice.cover,
  };
  return (
    <>
      <OutletContent node={stageNode}>
        <div data-testid="stage-probe" />
      </OutletContent>
      <OutletContent node={consoleNode}>
        <div data-testid="console-probe" />
      </OutletContent>
      <BasePhonePager {...pager} />
    </>
  );
};

const pagerElement = (choice: Choice = {}) => <Harness {...choice} />;
const renderPager = (choice: Choice = {}) => render(pagerElement(choice));

it("has three pages, the work page in view, a bar on the work and the preview", () => {
  renderPager({ page: "work" });
  for (const name of ["Navigation", "Work", "Preview"]) {
    expect(screen.getByRole("region", { name })).toBeTruthy();
  }
  expect(screen.getAllByTestId("phone-bar")).toHaveLength(2);
  expect(screen.getByTestId("phone-pager").scrollLeft).toBe(390);
});

it("lays its pages out in PHONE_PAGES order", () => {
  renderPager();
  const label = { menu: "Navigation", work: "Work", preview: "Preview" };
  const sections = [
    ...screen.getByTestId("phone-pager").querySelectorAll("section"),
  ].map((section) => section.getAttribute("aria-label"));
  expect(sections).toEqual(PHONE_PAGES.map((page) => label[page]));
});

it("asks for the preview, then back to the code", async () => {
  const onGo = vi.fn();
  renderPager({ page: "work", onGo });
  await userEvent.click(
    screen.getByRole("button", { name: "Preview the build" })
  );
  expect(onGo).toHaveBeenLastCalledWith("preview");
  await userEvent.click(
    screen.getByRole("button", { name: "Back to the code" })
  );
  expect(onGo).toHaveBeenLastCalledWith("work");
  await userEvent.click(screen.getByRole("button", { name: "Menu" }));
  expect(onGo).toHaveBeenLastCalledWith("menu");
});

it("switches Chat and Code", async () => {
  const onView = vi.fn();
  renderPager({ view: "code", onView });
  await userEvent.click(
    within(screen.getByRole("radiogroup", { name: "Show" })).getByRole(
      "radio",
      { name: "Chat" }
    )
  );
  expect(onView).toHaveBeenCalledWith("chat");
});

it("names the open file on the picker and opens Files", async () => {
  const onFilesOpenChange = vi.fn();
  renderPager({ file: { dir: "src/", name: "lib.rs" }, onFilesOpenChange });
  await userEvent.click(
    screen.getByRole("button", { name: "Files, lib.rs open" })
  );
  expect(onFilesOpenChange).toHaveBeenCalledWith(true);
});

it("reports a swipe once it settles on another page", () => {
  vi.useFakeTimers();
  const onSwipe = vi.fn();
  renderPager({ page: "work", onSwipe });
  const pager = screen.getByTestId("phone-pager");
  pager.scrollLeft = 780;
  fireEvent.scroll(pager);
  vi.advanceTimersByTime(SWIPE_SETTLE_MS);
  expect(onSwipe).toHaveBeenCalledWith("preview");
});

// New project's gallery opens from the menu page as the pager moves to Work:
// the dialog cuts the smooth scroll short and the snap pulls the pages back
it("finishes its own move that something cut short, not a swipe", () => {
  vi.useFakeTimers();
  const onSwipe = vi.fn();
  const { rerender } = renderPager({ page: "menu", onSwipe });
  const pager = screen.getByTestId("phone-pager");
  rerender(pagerElement({ page: "work", onSwipe }));
  pager.scrollLeft = 0;
  fireEvent.scroll(pager);
  vi.advanceTimersByTime(SWIPE_SETTLE_MS);
  expect(onSwipe).not.toHaveBeenCalled();
  expect(pager.scrollLeft).toBe(390);
});

// A swipe's own report re-renders the pager on the page it already shows:
// nothing moves, so nothing is left to finish
it("reports a swipe after the last one's report, with no input in between", () => {
  vi.useFakeTimers();
  const onSwipe = vi.fn();
  const { rerender } = renderPager({ page: "work", onSwipe });
  const pager = screen.getByTestId("phone-pager");
  pager.scrollLeft = 780;
  fireEvent.scroll(pager);
  vi.advanceTimersByTime(SWIPE_SETTLE_MS);
  expect(onSwipe).toHaveBeenLastCalledWith("preview");
  rerender(pagerElement({ page: "preview", onSwipe }));
  pager.scrollLeft = 390;
  fireEvent.scroll(pager);
  vi.advanceTimersByTime(SWIPE_SETTLE_MS);
  expect(onSwipe).toHaveBeenLastCalledWith("work");
});

it("hands its move to the user at a wheel, and reports the swipe", () => {
  vi.useFakeTimers();
  const onSwipe = vi.fn();
  const { rerender } = renderPager({ page: "menu", onSwipe });
  const pager = screen.getByTestId("phone-pager");
  rerender(pagerElement({ page: "work", onSwipe }));
  fireEvent.wheel(pager);
  pager.scrollLeft = 0;
  fireEvent.scroll(pager);
  vi.advanceTimersByTime(SWIPE_SETTLE_MS);
  expect(onSwipe).toHaveBeenCalledWith("menu");
});

it.each([
  ["a swipe past the middle of the next page", 600, "preview"],
  ["a swipe short of the middle of the next page", 500, null],
] as const)("rounds %s to the nearest page", (_, scrollLeft, expected) => {
  vi.useFakeTimers();
  const onSwipe = vi.fn();
  renderPager({ page: "work", onSwipe });
  const pager = screen.getByTestId("phone-pager");
  pager.scrollLeft = scrollLeft;
  fireEvent.scroll(pager);
  vi.advanceTimersByTime(SWIPE_SETTLE_MS);
  if (expected) expect(onSwipe).toHaveBeenCalledWith(expected);
  else expect(onSwipe).not.toHaveBeenCalled();
});

it("settles when the system cancels the touch, as when it lifts", () => {
  vi.useFakeTimers();
  const onSwipe = vi.fn();
  renderPager({ page: "work", onSwipe });
  const pager = screen.getByTestId("phone-pager");
  fireEvent.touchStart(pager);
  pager.scrollLeft = 780;
  fireEvent.scroll(pager);
  vi.advanceTimersByTime(SWIPE_SETTLE_MS * 3);
  expect(onSwipe).not.toHaveBeenCalled();
  fireEvent.touchCancel(pager);
  vi.advanceTimersByTime(SWIPE_SETTLE_MS);
  expect(onSwipe).toHaveBeenCalledWith("preview");
});

it("does not settle while a finger is down, only once it lifts", () => {
  vi.useFakeTimers();
  const onSwipe = vi.fn();
  renderPager({ page: "work", onSwipe });
  const pager = screen.getByTestId("phone-pager");
  fireEvent.touchStart(pager);
  pager.scrollLeft = 585;
  fireEvent.scroll(pager);
  vi.advanceTimersByTime(SWIPE_SETTLE_MS * 3);
  expect(onSwipe).not.toHaveBeenCalled();
  pager.scrollLeft = 780;
  fireEvent.touchEnd(pager);
  vi.advanceTimersByTime(SWIPE_SETTLE_MS);
  expect(onSwipe).toHaveBeenCalledWith("preview");
});

it("does not settle while a finger is down in the stage, a portaled outlet", () => {
  vi.useFakeTimers();
  const onSwipe = vi.fn();
  renderPager({ page: "work", onSwipe });
  const pager = screen.getByTestId("phone-pager");
  // The stage's React parent is the harness, not the pager; its DOM node is
  // inside the pager
  fireEvent.touchStart(screen.getByTestId("stage-probe"));
  pager.scrollLeft = 585;
  fireEvent.scroll(pager);
  vi.advanceTimersByTime(SWIPE_SETTLE_MS * 3);
  expect(onSwipe).not.toHaveBeenCalled();
  pager.scrollLeft = 780;
  fireEvent.touchEnd(screen.getByTestId("stage-probe"));
  vi.advanceTimersByTime(SWIPE_SETTLE_MS);
  expect(onSwipe).toHaveBeenCalledWith("preview");
});

it("makes every section but the current page inert", () => {
  const { rerender } = renderPager({ page: "work" });
  const inertOf = (name: string) =>
    screen.getByRole("region", { name }).hasAttribute("inert");
  expect([inertOf("Navigation"), inertOf("Work"), inertOf("Preview")]).toEqual([
    true,
    false,
    true,
  ]);
  rerender(pagerElement({ page: "menu" }));
  expect([inertOf("Navigation"), inertOf("Work"), inertOf("Preview")]).toEqual([
    false,
    true,
    true,
  ]);
});

it("does not report its own scroll to the page it was given", () => {
  vi.useFakeTimers();
  const onSwipe = vi.fn();
  const { rerender } = renderPager({ page: "work", onSwipe });
  rerender(pagerElement({ page: "preview", onSwipe }));
  fireEvent.scroll(screen.getByTestId("phone-pager"));
  vi.advanceTimersByTime(SWIPE_SETTLE_MS);
  expect(onSwipe).not.toHaveBeenCalled();
});

it("aligns instantly on load and smoothly after", () => {
  // jsdom has no scrolling: record what the element's scroll-behavior is at
  // each write of `scrollLeft`
  const original = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollLeft"
  )!;
  const behaviors: string[] = [];
  Object.defineProperty(Element.prototype, "scrollLeft", {
    configurable: true,
    get() {
      return original.get!.call(this);
    },
    set(value: number) {
      behaviors.push((this as HTMLElement).style.scrollBehavior);
      original.set!.call(this, value);
    },
  });
  try {
    const { rerender } = renderPager({ page: "work" });
    rerender(pagerElement({ page: "preview" }));
  } finally {
    Object.defineProperty(Element.prototype, "scrollLeft", original);
  }
  expect(behaviors).toEqual(["auto", ""]);
});

it("re-aligns to its page when the window resizes", () => {
  renderPager({ page: "preview" });
  pageWidth = 600;
  fireEvent(window, new Event("resize"));
  expect(screen.getByTestId("phone-pager").scrollLeft).toBe(1200);
});

it("shows the stage on the page it is on", () => {
  const { rerender } = renderPager({ stageOn: "work" });
  expect(
    within(screen.getByRole("region", { name: "Work" })).getByTestId(
      "stage-probe"
    )
  ).toBeTruthy();
  rerender(pagerElement({ stageOn: "preview" }));
  expect(
    within(screen.getByRole("region", { name: "Preview" })).getByTestId(
      "stage-probe"
    )
  ).toBeTruthy();
});

it("keeps the console on the preview page", () => {
  renderPager();
  expect(
    within(screen.getByRole("region", { name: "Preview" })).getByTestId(
      "console-probe"
    )
  ).toBeTruthy();
});

it("leaves the menu page's head to the navigation, which draws its own close", () => {
  renderPager({ page: "menu" });
  const menu = screen.getByRole("region", { name: "Navigation" });
  expect(within(menu).queryByTestId("phone-bar")).toBeNull();
  expect(within(menu).getByText("menu slot")).toBeTruthy();
});

it("links the docs from the code's head, beside the file picker", () => {
  renderPager({ view: "code" });
  const link = screen.getByRole("link", { name: "Documentation" });
  expect(link.getAttribute("href")).toBe("https://solana.com/docs");
  expect(link.getAttribute("target")).toBe("_blank");
});

describe("with Home", () => {
  const home = { content: <div>home slot</div> };

  it("shows Home on the work page under Menu and the title, and has no preview page", () => {
    renderPager({ home, title: "Home" });
    const work = screen.getByRole("region", { name: "Work" });
    expect(within(work).getByText("home slot")).toBeTruthy();
    const bar = within(work).getByTestId("phone-bar");
    expect(within(bar).getByRole("button", { name: "Menu" })).toBeTruthy();
    expect(within(bar).getByText("Home")).toBeTruthy();
    expect(within(bar).queryByRole("radiogroup", { name: "Show" })).toBeNull();
    expect(
      within(bar).queryByRole("button", { name: "Preview the build" })
    ).toBeNull();
    expect(screen.queryByRole("region", { name: "Preview" })).toBeNull();
    expect(screen.getAllByTestId("phone-bar")).toHaveLength(1);
    expect(within(work).queryByText("assistant slot")).toBeNull();
    expect(screen.queryByTestId("stage-probe")).toBeNull();
    expect(screen.queryByTestId("console-probe")).toBeNull();
  });

  it("keeps the menu and the work page at their indices", () => {
    renderPager({ home, page: "work" });
    expect(screen.getByTestId("phone-pager").scrollLeft).toBe(
      PHONE_PAGES.indexOf("work") * 390
    );
  });

  it("renders no Files Sheet", () => {
    renderPager({ home, filesOpen: true });
    expect(screen.queryByRole("dialog", { name: "Files" })).toBeNull();
    expect(screen.queryByText("files slot")).toBeNull();
  });

  it("never settles a swipe on the missing preview page", () => {
    vi.useFakeTimers();
    const onSwipe = vi.fn();
    renderPager({ home, page: "work", onSwipe });
    const pager = screen.getByTestId("phone-pager");
    pager.scrollLeft = 780;
    fireEvent.scroll(pager);
    vi.advanceTimersByTime(SWIPE_SETTLE_MS);
    expect(onSwipe).not.toHaveBeenCalled();
    pager.scrollLeft = 0;
    fireEvent.scroll(pager);
    vi.advanceTimersByTime(SWIPE_SETTLE_MS);
    expect(onSwipe).toHaveBeenCalledWith("menu");
  });

  it("shows the work page when it is handed the preview", () => {
    renderPager({ home, page: "preview" });
    expect(screen.getByTestId("phone-pager").scrollLeft).toBe(390);
    expect(
      screen.getByRole("region", { name: "Work" }).hasAttribute("inert")
    ).toBe(false);
  });
});

describe("with a page over the work", () => {
  const cover = { content: <div>page slot</div> };

  it("shows the page on the work page, the work kept mounted and hidden, with no preview page", () => {
    renderPager({ cover, title: "Tutorials" });
    const work = screen.getByRole("region", { name: "Work" });
    expect(within(work).getByText("page slot")).toBeTruthy();
    const bar = within(work).getByTestId("phone-bar");
    expect(within(bar).getByText("Tutorials")).toBeTruthy();
    expect(within(bar).queryByRole("radiogroup", { name: "Show" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Preview" })).toBeNull();
    expect(
      within(work).getByText("assistant slot").closest(".hidden")
    ).not.toBeNull();
    expect(screen.getByTestId("stage-probe")).toBeTruthy();
  });

  it("stands in Home's place", () => {
    renderPager({ home: { content: <div>home slot</div> }, cover });
    expect(screen.getByText("page slot")).toBeTruthy();
    expect(screen.queryByText("home slot")).toBeNull();
  });
});
