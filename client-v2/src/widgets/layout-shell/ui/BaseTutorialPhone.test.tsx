import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { requireFor } from "@/test-utils/require-for";

import type { TutorialPhoneSlot, TutorialSpace } from "./BaseLayoutShell";
import BaseTutorialPhone from "./BaseTutorialPhone";

interface Drawn {
  space: TutorialSpace;
  onSpace: TutorialPhoneSlot["onSpace"];
  chat: ReactNode;
  consoleNode: HTMLDivElement;
  consoleOpen: boolean;
  tablet: boolean;
  stageNode?: HTMLDivElement;
}

const tree = (drawn: Drawn) => (
  <BaseTutorialPhone
    phone={{
      head: <header>head</header>,
      chat: drawn.chat,
      space: drawn.space,
      onSpace: drawn.onSpace,
    }}
    stageNode={drawn.stageNode ?? document.createElement("div")}
    consoleNode={drawn.consoleNode}
    consoleOpen={drawn.consoleOpen}
    tablet={drawn.tablet}
  />
);

/** The phone in `space`, with a plain feed and the console folded */
const draw = (space: TutorialSpace, onSpace: Drawn["onSpace"]) =>
  render(
    tree({
      space,
      onSpace,
      chat: <p>the feed</p>,
      consoleNode: document.createElement("div"),
      consoleOpen: false,
      tablet: false,
    })
  );

const region = (name: string) => screen.getByRole("region", { name });
const isInert = (el: Element) => el.hasAttribute("inert");
const strip = () =>
  requireFor("the strip")(region("Chat").parentElement as HTMLElement);
const viewport = () =>
  requireFor("the viewport")(strip().parentElement as HTMLElement);

interface Point {
  x: number;
  y: number;
}

/** A touch that goes down at one point and lifts at another */
const swipe = ({
  from,
  to,
  on = viewport(),
}: {
  from: Point;
  to: Point;
  on?: Element;
}) => {
  fireEvent.pointerDown(on, {
    clientX: from.x,
    clientY: from.y,
    pointerType: "touch",
  });
  fireEvent.pointerUp(on, {
    clientX: to.x,
    clientY: to.y,
    pointerType: "touch",
  });
};

describe("the spaces", () => {
  it("shows Chat and leaves Code inert by default", () => {
    draw("chat", vi.fn());
    expect(screen.getByTestId("tutorial-phone")).toBeTruthy();
    expect(isInert(region("Chat"))).toBe(false);
    expect(isInert(region("Code"))).toBe(true);
    expect(strip().className).not.toContain("-translate-x-1/2");
  });

  it("slides to Code and leaves Chat inert", () => {
    draw("code", vi.fn());
    expect(strip().className).toContain("-translate-x-1/2");
    expect(isInert(region("Chat"))).toBe(true);
    expect(isInert(region("Code"))).toBe(false);
  });

  it("holds the head and the chat it is given", () => {
    draw("chat", vi.fn());
    expect(screen.getByText("head")).toBeTruthy();
    expect(screen.getByText("the feed").closest("section")).toBe(
      region("Chat")
    );
  });

  it("folds the console to its bar and opens it to a share of the page", () => {
    const consoleNode = document.createElement("div");
    const drawn = (consoleOpen: boolean): Drawn => ({
      space: "code",
      onSpace: vi.fn(),
      chat: <p>the feed</p>,
      consoleNode,
      consoleOpen,
      tablet: false,
    });
    const { rerender } = render(tree(drawn(false)));
    const box = () => consoleNode.parentElement as HTMLElement;
    // Below 768 px the bar is a finger's 44 px (`BaseConsoleDrawer`'s
    // `max-md:h-11`), as on the pager; a 28 px fold cut its foot off
    expect(box().style.height).toBe("44px");
    expect(box().className).toContain("overflow-hidden");
    rerender(tree(drawn(true)));
    expect(box().style.height).toBe("");
    expect(box().className).toContain("max-h-[42dvh]");
  });

  it("folds the console to the wide bar's 28 px in the tablet band", () => {
    const consoleNode = document.createElement("div");
    render(
      tree({
        space: "code",
        onSpace: vi.fn(),
        chat: <p>the feed</p>,
        consoleNode,
        consoleOpen: false,
        tablet: true,
      })
    );
    const box = consoleNode.parentElement as HTMLElement;
    expect(box.style.height).toBe("28px");
  });
});

describe("a swipe", () => {
  it("goes to Code on a long, flat swipe left in Chat", () => {
    const onSpace = vi.fn();
    draw("chat", onSpace);
    swipe({ from: { x: 200, y: 100 }, to: { x: 120, y: 110 } });
    expect(onSpace).toHaveBeenCalledWith("code", "swipe");
  });

  it("goes back to Chat on a swipe right in Code", () => {
    const onSpace = vi.fn();
    draw("code", onSpace);
    swipe({ from: { x: 120, y: 100 }, to: { x: 200, y: 110 } });
    expect(onSpace).toHaveBeenCalledWith("chat", "swipe");
  });

  it.each([
    {
      when: "too short",
      space: "chat",
      from: { x: 200, y: 100 },
      to: { x: 160, y: 100 },
    },
    {
      when: "too steep",
      space: "chat",
      from: { x: 200, y: 100 },
      to: { x: 120, y: 160 },
    },
    // Where the browser's own back gesture starts
    {
      when: "from the left edge",
      space: "code",
      from: { x: 10, y: 100 },
      to: { x: 90, y: 100 },
    },
    {
      when: "it goes the way of the space already shown",
      space: "chat",
      from: { x: 120, y: 100 },
      to: { x: 200, y: 100 },
    },
  ] as const)("is ignored when $when", ({ space, from, to }) => {
    const onSpace = vi.fn();
    draw(space, onSpace);
    swipe({ from, to });
    expect(onSpace).not.toHaveBeenCalled();
  });

  it("is ignored when it starts inside something that scrolls sideways", () => {
    const onSpace = vi.fn();
    render(
      tree({
        space: "chat",
        onSpace,
        chat: (
          <pre data-testid="code-block" style={{ overflowX: "auto" }}>
            <code>a long line</code>
          </pre>
        ),
        consoleNode: document.createElement("div"),
        consoleOpen: false,
        tablet: false,
      })
    );
    const block = screen.getByTestId("code-block");
    Object.defineProperty(block, "scrollWidth", { value: 900 });
    Object.defineProperty(block, "clientWidth", { value: 300 });
    swipe({
      from: { x: 200, y: 100 },
      to: { x: 120, y: 100 },
      on: screen.getByText("a long line"),
    });
    expect(onSpace).not.toHaveBeenCalled();
  });

  // The shell portals Code's stage into its node: React's pointer events
  // from it never reach this component, so the swipe listens on the DOM
  const stageWith = (html: string) => {
    const stageNode = document.createElement("div");
    stageNode.innerHTML = html;
    return stageNode;
  };
  const drawCode = (onSpace: Drawn["onSpace"], stageNode: HTMLDivElement) =>
    render(
      tree({
        space: "code",
        onSpace,
        chat: <p>the feed</p>,
        consoleNode: document.createElement("div"),
        consoleOpen: false,
        tablet: false,
        stageNode,
      })
    );

  it("goes back to Chat on a swipe that starts in the stage the shell put in Code", () => {
    const onSpace = vi.fn();
    const stageNode = stageWith('<div data-testid="editor">fn hello()</div>');
    drawCode(onSpace, stageNode);
    swipe({
      from: { x: 120, y: 100 },
      to: { x: 200, y: 110 },
      on: screen.getByTestId("editor"),
    });
    expect(onSpace).toHaveBeenCalledWith("chat", "swipe");
  });

  it("is ignored in an editor whose lines are wider than it", () => {
    const onSpace = vi.fn();
    const stageNode = stageWith(
      '<div class="monaco-scrollable-element"><div class="lines-content"><span data-testid="line">a long line</span></div></div>'
    );
    drawCode(onSpace, stageNode);
    const scroller = requireFor("the editor's scroller")(
      stageNode.querySelector(".monaco-scrollable-element")
    );
    const lines = requireFor("the editor's lines")(
      stageNode.querySelector(".lines-content")
    );
    Object.defineProperty(scroller, "clientWidth", { value: 300 });
    Object.defineProperty(lines, "scrollWidth", { value: 900 });
    swipe({
      from: { x: 120, y: 100 },
      to: { x: 200, y: 100 },
      on: screen.getByTestId("line"),
    });
    expect(onSpace).not.toHaveBeenCalled();
  });

  it("is ignored from a mouse, which drags to select", () => {
    const onSpace = vi.fn();
    draw("chat", onSpace);
    fireEvent.pointerDown(viewport(), {
      clientX: 200,
      clientY: 100,
      pointerType: "mouse",
    });
    fireEvent.pointerUp(viewport(), {
      clientX: 120,
      clientY: 100,
      pointerType: "mouse",
    });
    expect(onSpace).not.toHaveBeenCalled();
  });
});
