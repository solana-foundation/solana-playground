import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shared/ui/tooltip";
import type { ModelOption, ModelShown } from "../model/choice";
import { BaseModelMenu } from "./BaseModelMenu";

const options: ModelOption[] = [
  { provider: "default", model: null, label: "GLM 5.3 Flash" },
  { provider: "anthropic", model: "claude-sonnet-5-5", label: "Sonnet 5.5" },
];

const shownDefault: ModelShown = {
  kind: "default",
  label: "GLM 5.3 Flash",
  connected: true,
};

const setup = (model: ModelShown, disabled = false) => {
  const onPick = vi.fn();
  const onConnect = vi.fn();
  render(
    <TooltipProvider>
      <BaseModelMenu
        model={model}
        options={options}
        onPick={onPick}
        onConnect={onConnect}
        disabled={disabled}
      />
    </TooltipProvider>
  );
  return { onPick, onConnect, user: userEvent.setup() };
};

const LONG = "deepseek/deepseek-chat-v3.1-terminus-instruct:free";

const shownLong: ModelShown = {
  kind: "keyed",
  provider: "openrouter",
  model: LONG,
  label: LONG,
  effort: null,
};

/** jsdom lays nothing out, so whether the trigger's name is cut is stated */
const cutName = (cut: boolean) => {
  const text = screen.getByText(LONG);
  Object.defineProperty(text, "scrollWidth", { value: cut ? 300 : 100 });
  Object.defineProperty(text, "clientWidth", { value: 100 });
};

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("BaseModelMenu", () => {
  beforeEach(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
  afterEach(() => vi.unstubAllGlobals());

  it("names the shown model on the trigger", () => {
    setup(shownDefault);
    expect(screen.getByRole("button", { name: /GLM 5.3 Flash/ })).toBeTruthy();
  });

  it("lists the options and the connect entry when opened", async () => {
    const { user } = setup(shownDefault);
    await user.click(screen.getByRole("button", { name: /GLM 5.3 Flash/ }));
    expect(screen.getByText("Model")).toBeTruthy();
    expect(
      screen.getByRole("menuitemradio", { name: /Sonnet 5.5/ })
    ).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: "Connect with a key…" })
    ).toBeTruthy();
  });

  it("marks only the hosted default with a no-key hint", async () => {
    const { user } = setup(shownDefault);
    await user.click(screen.getByRole("button", { name: /GLM 5.3 Flash/ }));
    expect(screen.getAllByText("no key needed").length).toBe(1);
    const item = screen.getByRole("menuitemradio", { name: /GLM 5.3 Flash/ });
    expect(item.textContent).toContain("no key needed");
    const sonnet = screen.getByRole("menuitemradio", { name: /Sonnet 5.5/ });
    expect(sonnet.textContent).not.toContain("no key needed");
  });

  it("checks the default option when the default is shown", async () => {
    const { user } = setup(shownDefault);
    await user.click(screen.getByRole("button", { name: /GLM 5.3 Flash/ }));
    const checked = screen.getAllByRole("menuitemradio", { checked: true });
    expect(checked.length).toBe(1);
    expect(checked[0].textContent).toContain("GLM 5.3 Flash");
  });

  it("checks the keyed option matching provider and model id", async () => {
    const { user } = setup({
      kind: "keyed",
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      label: "Sonnet 5.5",
      effort: null,
    });
    await user.click(screen.getByRole("button", { name: /Sonnet 5.5/ }));
    const checked = screen.getAllByRole("menuitemradio", { checked: true });
    expect(checked.length).toBe(1);
    expect(checked[0].textContent).toContain("Sonnet 5.5");
  });

  it("checks by model id when two options share a label", async () => {
    const onPick = vi.fn();
    render(
      <TooltipProvider>
        <BaseModelMenu
          model={{
            kind: "keyed",
            provider: "openrouter",
            model: "vendor/model-b",
            label: "Model",
            effort: null,
          }}
          options={[
            { provider: "openrouter", model: "vendor/model-a", label: "Model" },
            { provider: "openrouter", model: "vendor/model-b", label: "Model" },
          ]}
          onPick={onPick}
          onConnect={vi.fn()}
          disabled={false}
        />
      </TooltipProvider>
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Model" }));
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
    ]);
  });

  it("hands the picked option to onPick", async () => {
    const { user, onPick } = setup(shownDefault);
    await user.click(screen.getByRole("button", { name: /GLM 5.3 Flash/ }));
    await user.click(screen.getByRole("menuitemradio", { name: /Sonnet 5.5/ }));
    expect(onPick).toHaveBeenCalledWith({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      label: "Sonnet 5.5",
    });
  });

  it("calls onConnect from the key entry", async () => {
    const { user, onConnect } = setup(shownDefault);
    await user.click(screen.getByRole("button", { name: /GLM 5.3 Flash/ }));
    await user.click(
      screen.getByRole("menuitem", { name: "Connect with a key…" })
    );
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it("renders a plain Connect a model button for none, with no menu", async () => {
    const { user, onConnect } = setup({ kind: "none" });
    await user.click(screen.getByRole("button", { name: "Connect a model" }));
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("renders a quiet disabled button while checking, with no menu", async () => {
    const { user, onConnect } = setup({ kind: "checking" });
    const button = screen.getByRole("button", { name: "Checking the model…" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Connect a model" })
    ).toBeNull();
    await user.click(button);
    expect(onConnect).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("disables the trigger", () => {
    setup(shownDefault, true);
    expect(
      screen
        .getByRole("button", { name: /GLM 5.3 Flash/ })
        .hasAttribute("disabled")
    ).toBe(true);
  });

  it("caps the trigger and ends a long name in an ellipsis, keeping it whole for screen readers", () => {
    setup(shownLong);
    const trigger = screen.getByRole("button", { name: LONG });
    expect(trigger.className).toContain("max-w-48");
    expect(trigger.getAttribute("data-slot")).toBe("composer-model");
    const text = screen.getByText(LONG);
    expect(text.hasAttribute("data-overflow")).toBe(true);
    expect(text.className).toContain("truncate");
  });

  it("shows a cut name whole in a tooltip on focus, and still opens the menu", async () => {
    const { user } = setup(shownLong);
    cutName(true);
    await user.tab();
    expect((await screen.findByRole("tooltip")).textContent).toBe(LONG);
    await user.click(screen.getByRole("button", { name: LONG }));
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("shows no tooltip for a name that fits", async () => {
    const { user } = setup(shownLong);
    cutName(false);
    await user.tab();
    await user.hover(screen.getByRole("button", { name: LONG }));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("lists a long name whole in the menu, wrapping it", async () => {
    const { user } = setup(shownDefault);
    await user.click(screen.getByRole("button", { name: /GLM 5.3 Flash/ }));
    const sonnet = screen.getByRole("menuitemradio", { name: /Sonnet 5.5/ });
    const label = sonnet.querySelector("[data-slot=menu-item-text]");
    expect(label?.className).toContain("[overflow-wrap:anywhere]");
  });

  it("reports the menu open on the trigger, under the tooltip's trigger", async () => {
    const { user } = setup(shownLong);
    const trigger = screen.getByRole("button", { name: LONG });
    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("data-state")).toBe("open");
  });
});
