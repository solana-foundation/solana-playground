import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The utils barrel reads a build-time global and cannot load under vitest;
// the real `PgCommon` is all the select needs besides a spy-able `PgView`
vi.mock("@/utils", async () => {
  const { PgCommon } = await import("@/utils/common");
  return { PgCommon, PgView: { setModal: () => {} }, PgSettings: {} };
});

// Only the select is under test: the modal and tooltip pull in the theme,
// which needs the same build-time global
vi.mock("@/views/flow/settings/CustomSetting", () => ({
  CustomSetting: () => null,
}));
vi.mock("@/components/Tooltip", () => ({ default: () => null }));
vi.mock("@/hooks", () => ({ useRenderOnChange: () => {} }));

import { PgView } from "@/utils";
import { SettingControl, SettingSetterSelect } from "./SettingControl";

// Radix Select calls these while opening; jsdom implements none of them
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const setting = (over: { value: string; custom?: boolean }) => {
  let value = over.value;
  return {
    id: "connection.endpoint",
    name: "Endpoint",
    default: "devnet",
    values: [
      "devnet",
      { name: "Others", values: [{ name: "Local", value: "local" }] },
    ],
    custom: over.custom
      ? { parse: (v: string) => v, Component: undefined }
      : undefined,
    getValue: () => value,
    setValue: vi.fn((v: string) => {
      value = v;
    }),
    onChange: () => ({ dispose: () => {} }),
  };
};

describe("SettingSetterSelect", () => {
  it("shows the current value in a combobox", () => {
    render(<SettingSetterSelect {...setting({ value: "devnet" })} />);

    expect(screen.getByRole("combobox", { name: "Endpoint" }).textContent).toBe(
      "Devnet"
    );
  });

  it("lists groups with their labels", async () => {
    const user = userEvent.setup();
    render(<SettingSetterSelect {...setting({ value: "devnet" })} />);

    const combobox = screen.getByRole("combobox", { name: "Endpoint" });
    combobox.focus();
    await user.keyboard("{ArrowDown}");

    const group = await screen.findByRole("group", { name: "Others" });
    expect(within(group).getByRole("option", { name: "Local" })).toBeTruthy();
  });

  it("sets the picked value", async () => {
    const user = userEvent.setup();
    const s = setting({ value: "devnet" });
    render(<SettingSetterSelect {...s} />);

    await user.click(screen.getByRole("combobox", { name: "Endpoint" }));
    await user.click(await screen.findByRole("option", { name: "Local" }));

    expect(s.setValue).toHaveBeenCalledWith("local");
  });

  it("shows Custom for a value no option has, when custom is allowed", () => {
    render(
      <SettingSetterSelect
        {...setting({ value: "https://my.rpc", custom: true })}
      />
    );

    expect(screen.getByRole("combobox", { name: "Endpoint" }).textContent).toBe(
      "Custom"
    );
  });

  it("opens the custom modal on Custom, without setting a value", async () => {
    const user = userEvent.setup();
    const setModal = vi.spyOn(PgView, "setModal").mockResolvedValue(null);
    const s = setting({ value: "devnet", custom: true });
    render(<SettingSetterSelect {...s} />);

    await user.click(screen.getByRole("combobox", { name: "Endpoint" }));
    await user.click(await screen.findByRole("option", { name: "Custom" }));

    expect(setModal).toHaveBeenCalledTimes(1);
    expect(s.setValue).not.toHaveBeenCalled();
  });

  it("reopens the custom modal when Custom is picked while current", async () => {
    const user = userEvent.setup();
    const setModal = vi.spyOn(PgView, "setModal").mockResolvedValue(null);
    setModal.mockClear();
    render(
      <SettingSetterSelect
        {...setting({ value: "https://my.rpc", custom: true })}
      />
    );

    await user.click(screen.getByRole("combobox", { name: "Endpoint" }));
    await user.click(await screen.findByRole("option", { name: "Custom" }));

    expect(setModal).toHaveBeenCalledTimes(1);
  });

  it("stays controlled and shows no option for a value no option has, without custom", () => {
    // Radix says so through `console.warn`, React through `console.error`
    const consoleWarn = vi.spyOn(console, "warn");
    const consoleError = vi.spyOn(console, "error");
    let current = "devnet";
    const s = setting({ value: "devnet" });
    s.getValue = () => current;
    const { rerender } = render(<SettingSetterSelect {...s} />);

    // a stored value the options no longer list, e.g. from an older build
    current = "gone";
    rerender(<SettingSetterSelect {...s} />);

    expect(screen.getByRole("combobox", { name: "Endpoint" }).textContent).toBe(
      ""
    );
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });
});

describe("an on/off setting", () => {
  it("is a checkbox named by its setting, as the prototype draws it", async () => {
    let on = true;
    const setValue = vi.fn((v: boolean) => {
      on = v;
    });
    render(
      <SettingControl
        id="build.improveErrors"
        name="Improve errors"
        default={true}
        getValue={() => on}
        setValue={setValue}
        onChange={() => ({ dispose: () => {} })}
      />
    );

    const box = screen.getByRole("checkbox", { name: "Improve errors" });
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("switch")).toBeNull();
    await userEvent.click(box);
    expect(setValue).toHaveBeenCalledWith(false);
  });
});
