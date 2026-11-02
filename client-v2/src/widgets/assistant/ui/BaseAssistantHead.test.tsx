import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shared/ui/tooltip";
import { BaseAssistantHead } from "./BaseAssistantHead";
import type { ForgetKey } from "./BaseAssistantHead";
import type { HeadLabel } from "../model/head-label";

interface HeadChoice {
  wide?: boolean;
  canWiden?: boolean;
  /** What the caller's `focusPicked` does; takes focus by default */
  focusPicked?: () => boolean;
  forgetKey?: ForgetKey;
  label?: HeadLabel;
}

const HOSTED: HeadLabel = {
  kind: "model",
  lead: "Assistant · ",
  model: "GLM 5.3 Flash",
  tail: " · hosted",
};

const LONG = "deepseek/deepseek-chat-v3.1-terminus-instruct:free";

const KEYED_LONG: HeadLabel = {
  kind: "model",
  lead: "",
  model: LONG,
  tail: " · your OpenRouter key",
};

/** jsdom lays nothing out, so whether the head's model name is cut is stated */
const cutName = (cut: boolean) => {
  const text = screen.getByText(LONG);
  Object.defineProperty(text, "scrollWidth", { value: cut ? 300 : 100 });
  Object.defineProperty(text, "clientWidth", { value: 100 });
  return text;
};

const setup = (choice: HeadChoice = {}) => {
  const onSources = vi.fn();
  const onConnect = vi.fn();
  const focusPicked = vi.fn(() => choice.focusPicked?.() ?? true);
  const onWiden = vi.fn();
  const onHide = vi.fn();
  const onForgetKey = vi.fn();
  render(
    <TooltipProvider>
      <BaseAssistantHead
        label={choice.label ?? HOSTED}
        onSources={onSources}
        onConnect={onConnect}
        connectLabel="Connect a model…"
        focusPicked={focusPicked}
        wide={choice.wide ?? false}
        onWiden={onWiden}
        onHide={onHide}
        canWiden={choice.canWiden ?? true}
        forgetKey={choice.forgetKey ?? "none"}
        onForgetKey={onForgetKey}
      />
    </TooltipProvider>
  );
  return {
    onSources,
    onConnect,
    focusPicked,
    onWiden,
    onHide,
    onForgetKey,
    user: userEvent.setup(),
  };
};

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const more = () => screen.getByRole("button", { name: "More" });

describe("BaseAssistantHead", () => {
  beforeEach(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
  afterEach(() => vi.unstubAllGlobals());

  it("reads the model in use", () => {
    setup();
    expect(
      screen.getByRole("heading", {
        name: "Assistant · GLM 5.3 Flash · hosted",
      })
    ).toBeTruthy();
  });

  it("reads Assistant alone with no model", () => {
    setup({ label: { kind: "plain", text: "Assistant" } });
    expect(screen.getByRole("heading", { name: "Assistant" })).toBeTruthy();
  });

  it("cuts only the model's name, keeping the words around it whole", () => {
    setup({
      label: KEYED_LONG,
    });
    expect(screen.getByText(LONG).className).toContain("truncate");
    expect(screen.getByText(LONG).hasAttribute("data-overflow")).toBe(true);
    expect(screen.getByText("· your OpenRouter key").className).toContain(
      "shrink-0"
    );
  });

  it("shows a cut model name whole in a tooltip on hover", async () => {
    const { user } = setup({
      label: KEYED_LONG,
    });
    await user.hover(cutName(true));
    expect((await screen.findByRole("tooltip")).textContent).toBe(LONG);
  });

  it("shows no tooltip for a model name that fits", async () => {
    const { user } = setup({ label: KEYED_LONG });
    await user.hover(cutName(false));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("lists the three items under More, Clear conversation disabled", async () => {
    const { user } = setup();
    await user.click(more());
    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Sources and toolsS",
      "Connect a model…K",
      "Clear conversation",
    ]);
    expect(
      screen
        .getByRole("menuitem", { name: "Clear conversation" })
        .getAttribute("aria-disabled")
    ).toBe("true");
  });

  it("says why Clear conversation is disabled", async () => {
    const { user } = setup();
    await user.click(more());
    const item = screen.getByRole("menuitem", { name: "Clear conversation" });
    // The item takes no pointer events while disabled; its wrapper does
    await user.hover(item.parentElement!);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Coming soon"
    );
  });

  it("offers Forget key only while a key is held, and forgets it", async () => {
    const { user, onForgetKey } = setup({ forgetKey: "ready" });
    await user.click(more());
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent)
    ).toEqual([
      "Sources and toolsS",
      "Connect a model…K",
      "Forget key",
      "Clear conversation",
    ]);
    await user.click(screen.getByRole("menuitem", { name: "Forget key" }));
    expect(onForgetKey).toHaveBeenCalledTimes(1);
  });

  it("keeps Forget key disabled during a turn, and says why", async () => {
    const { user, onForgetKey } = setup({ forgetKey: "busy" });
    await user.click(more());
    const item = screen.getByRole("menuitem", { name: "Forget key" });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    // The item takes no pointer events while disabled; its wrapper does
    await user.hover(item.parentElement!);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Finish this turn first"
    );
    expect(onForgetKey).not.toHaveBeenCalled();
  });

  it("opens Sources and tools and Connect a model from their items", async () => {
    const { user, onSources, onConnect } = setup();
    await user.click(more());
    await user.click(
      screen.getByRole("menuitem", { name: /Sources and tools/ })
    );
    expect(onSources).toHaveBeenCalledTimes(1);
    await user.click(more());
    await user.click(screen.getByRole("menuitem", { name: /Connect a model/ }));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it("hands focus to the picked view once the menu has closed", async () => {
    const field = document.createElement("input");
    document.body.append(field);
    try {
      // The view Connect a model opened takes focus, as the widget's does
      const { user, focusPicked } = setup({
        focusPicked: () => {
          field.focus();
          return true;
        },
      });
      await user.click(more());
      await user.click(
        screen.getByRole("menuitem", { name: /Connect a model/ })
      );
      expect(screen.queryByRole("menu")).toBeNull();
      expect(focusPicked).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(field);
    } finally {
      field.remove();
    }
  });

  it("gives focus back to More when the picked view takes none", async () => {
    const { user } = setup({ focusPicked: () => false });
    await user.click(more());
    await user.keyboard("s");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(more());
  });

  it("gives focus back to More when the menu is dismissed", async () => {
    const { user, focusPicked } = setup();
    await user.click(more());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(focusPicked).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(more());
  });

  it("picks Sources and tools with S while the menu is open, and closes it", async () => {
    const { user, onSources, onConnect } = setup();
    await user.click(more());
    await user.keyboard("s");
    expect(onSources).toHaveBeenCalledTimes(1);
    expect(onConnect).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("picks Connect a model with K while the menu is open, and closes it", async () => {
    const { user, onSources, onConnect } = setup();
    await user.click(more());
    await user.keyboard("K");
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onSources).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("leaves S and K alone with the menu closed", async () => {
    const { user, onSources, onConnect } = setup();
    more().focus();
    await user.keyboard("sk");
    expect(onSources).not.toHaveBeenCalled();
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("leaves S with a modifier to the browser", async () => {
    const { user, onSources } = setup();
    await user.click(more());
    await user.keyboard("{Meta>}s{/Meta}");
    expect(onSources).not.toHaveBeenCalled();
  });

  it("widens, and its label follows wide", async () => {
    const { user, onWiden } = setup();
    await user.click(
      screen.getByRole("button", { name: "Widen the assistant" })
    );
    expect(onWiden).toHaveBeenCalledTimes(1);
  });

  it("offers to narrow once wide", () => {
    setup({ wide: true });
    expect(
      screen.getByRole("button", { name: "Narrow the assistant" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Widen the assistant" })
    ).toBeNull();
  });

  it("offers no Widen where it cannot widen", () => {
    setup({ canWiden: false });
    expect(screen.queryByRole("button", { name: /Widen|Narrow/ })).toBeNull();
  });

  it("hides as Collapse assistant", async () => {
    const { user, onHide } = setup();
    await user.click(
      screen.getByRole("button", { name: "Collapse assistant" })
    );
    expect(onHide).toHaveBeenCalledTimes(1);
  });
});

it("is the frame's 44 px column bar", () => {
  setup();
  const head = screen.getByRole("heading", {
    name: "Assistant · GLM 5.3 Flash · hosted",
  }).parentElement!;
  expect(head.className).toMatch(/\bh-11\b/);
  expect(head.className).toMatch(/\bborder-b\b/);
});
