import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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
    <BaseModelMenu
      model={model}
      options={options}
      onPick={onPick}
      onConnect={onConnect}
      disabled={disabled}
    />
  );
  return { onPick, onConnect, user: userEvent.setup() };
};

describe("BaseModelMenu", () => {
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
});
