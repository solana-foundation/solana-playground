import { render, screen } from "@testing-library/react";
import { ThemeProvider, type DefaultTheme } from "styled-components";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../sidebar/explorer/Component", () => ({
  default: () => <div id="root-dir">tree</div>,
}));
vi.mock("../../sidebar/explorer/Component/useCreateItem", () => ({
  useCreateItem: () => ({ createItem: vi.fn() }),
}));

// The lessons module reaches the `@/utils` barrel, whose generated globals
// exist only in a booted app; the panel is drawn here outside a lesson
vi.mock("../lessons", () => ({
  INITIAL_LESSON_STATE: { path: null, record: [] },
  PgLesson: {
    onDidChange: () => ({ dispose: () => {} }),
    canPass: () => false,
  },
  cursorStep: () => null,
  foldRecord: () => null,
}));
vi.mock("../lessons/StepRail", () => ({ default: () => null }));

import LeftPanel from "./LeftPanel";

/** A theme that answers every key; the styles do not matter here */
const anyTheme: DefaultTheme = new Proxy(
  {},
  {
    get: (_, key) =>
      key === Symbol.toPrimitive || key === "toString"
        ? () => "inherit"
        : anyTheme,
  }
) as unknown as DefaultTheme;

const draw = (collapsed: boolean) =>
  render(
    <ThemeProvider theme={anyTheme}>
      <LeftPanel collapsed={collapsed} />
    </ThemeProvider>
  );

describe("LeftPanel in the flush frame", () => {
  it.each([false, true])(
    "has no fold strip of its own (collapsed: %s): the stage bar folds it",
    (collapsed) => {
      draw(collapsed);
      expect(
        screen.queryByRole("button", { name: /project panel/ })
      ).toBeNull();
      expect(screen.queryByRole("button", { name: "New file" })).toBeNull();
    }
  );

  it("shows the tree and its New file footer while open", () => {
    draw(false);
    expect(document.getElementById("root-dir")).not.toBeNull();
    expect(screen.getByRole("button", { name: "+ New file" })).toBeTruthy();
  });

  it("draws nothing while hidden", () => {
    const { container } = draw(true);
    // Not even its landmark: an empty, unnamed <aside> is still listed by a
    // screen reader
    expect(container.firstChild).toBeNull();
  });
});
