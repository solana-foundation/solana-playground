// Renders React, so a file of its own (AGENTS.md, "a module's unit tests
// live in the module")
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import SearchBar, { SearchBarProps } from "./SearchBar";

// `utils` reads the settings the build injects, which only exist once the
// app has booted
vi.hoisted(() => {
  vi.stubGlobal("GLOBAL_SETTINGS", { default: {} });
});

// The wasm packages are built separately and absent from a plain checkout
vi.mock("../../utils/package", () => ({ PgPackage: {} }));

// A failed pick or load is told through the shared click-failure toast
const failures = vi.hoisted(() => ({ actions: [] as string[] }));
vi.mock("@/shared/lib/report-button-failure", () => ({
  reportButtonFailure: (action: string) => () => {
    failures.actions.push(action);
  },
}));

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  // Radix's popper measures its anchor and cmdk scrolls the highlighted row
  // into view; jsdom has neither
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  // jsdom lays nothing out: the field is never reported off the page
  vi.stubGlobal("IntersectionObserver", NoopResizeObserver);
  Element.prototype.scrollIntoView = () => {};
});

/** SearchBar with its value held the way its users hold it */
const Harness = (props: Omit<SearchBarProps, "value"> & { start?: string }) => {
  const { start = "", ...rest } = props;
  const [value, setValue] = useState(start);
  return (
    <SearchBar
      id="field"
      value={value}
      onChange={(ev) => setValue(ev.target.value)}
      {...rest}
    />
  );
};

const input = () => document.getElementById("field") as HTMLInputElement;
const optionNames = () =>
  screen.getAllByRole("option").map((o) => o.textContent);
const lastLabels = (fn: ReturnType<typeof vi.fn>) =>
  (fn.mock.calls.at(-1)?.[0] as { label: string }[]).map((i) => i.label);
const option = (name: string) => screen.getByRole("option", { name });

describe("components/SearchBar", () => {
  it("renders the field as an input group and keeps the given id", () => {
    render(<Harness items={["a"]} />);
    expect(screen.getByRole("combobox")).toBe(input());
    expect(input().closest('[data-slot="input-group"]')).not.toBeNull();
  });

  it("a field with nothing to pick is a plain textbox", () => {
    render(<Harness />);
    expect(screen.getByRole("textbox")).toBe(input());
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("opens the list on click; picking an item fills the field", async () => {
    const onSearch = vi.fn();
    render(<Harness items={["false", "true"]} onSearch={onSearch} />);
    await userEvent.click(input());

    expect(document.querySelector('[data-slot="command"]')).not.toBeNull();
    // Focus stays in the field, so typing still filters
    expect(document.activeElement).toBe(input());

    await userEvent.click(option("true"));
    expect(input().value).toBe("true");
    expect(onSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        item: expect.objectContaining({ label: "true" }),
      })
    );
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("filters by what was typed and says when nothing matches", async () => {
    render(<Harness items={["Random", "Custom"]} />);
    await userEvent.click(input());
    await userEvent.type(input(), "ran");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Random",
    ]);

    await userEvent.type(input(), "zzz");
    expect(screen.getByText("No match")).toBeTruthy();
  });

  it("drills down into an item's items, and Back returns", async () => {
    render(
      <Harness items={[{ label: "uint", items: ["u8", "u16"] }, "string"]} />
    );
    await userEvent.click(input());
    await userEvent.click(option("uint"));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "u8",
      "u16",
    ]);

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "uint",
      "string",
    ]);
  });

  it("ArrowDown then Enter picks the next item", async () => {
    render(<Harness items={["one", "two"]} />);
    await userEvent.click(input());
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(input().value).toBe("two");
  });

  it("marks the field invalid while the validator rejects the value", async () => {
    render(<Harness validator={(v) => v.length < 3} />);
    await userEvent.type(input(), "abcd");
    expect(input().getAttribute("aria-invalid")).toBe("true");

    await userEvent.clear(input());
    await userEvent.type(input(), "ab");
    expect(input().getAttribute("aria-invalid")).not.toBe("true");
  });

  it("shows an error message above the field", () => {
    render(<Harness error="Not a public key" />);
    expect(screen.getByText("Not a public key")).toBeTruthy();
    expect(input().getAttribute("aria-invalid")).toBe("true");
  });

  it("Escape puts back the last picked value when asked to", async () => {
    render(<Harness items={["kept"]} restoreIfNotSelected />);
    await userEvent.click(input());
    await userEvent.click(option("kept"));
    await userEvent.click(input());
    await userEvent.type(input(), "x");
    await userEvent.keyboard("{Escape}");
    expect(input().value).toBe("kept");
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("pasting the paste label picks that item with the pasted text", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onSearch = vi.fn();
    render(
      <Harness
        items={[{ label: "Custom", value: "" }]}
        labelToSelectOnPaste="Custom"
        onSearch={onSearch}
      />
    );
    fireEvent.paste(input(), {
      clipboardData: {
        getData: () => "So11111111111111111111111111111111111111112",
      },
    });
    await act(() => vi.runAllTimersAsync());
    vi.useRealTimers();
    expect(onSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        item: expect.objectContaining({ label: "Custom" }),
      })
    );
    expect(input().value).toBe("So11111111111111111111111111111111111111112");
  });

  it("the clear button empties the field", async () => {
    render(<Harness start="abc" />);
    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(input().value).toBe("");
  });

  it("reports the whole path of a nested pick, and nothing after Clear", async () => {
    const setSelectedItems = vi.fn();
    render(
      <Harness
        items={[{ label: "uint", items: ["u8", "u16"] }, "string"]}
        setSelectedItems={setSelectedItems}
      />
    );
    await userEvent.click(input());
    await userEvent.click(option("uint"));
    await userEvent.click(option("u8"));
    expect(lastLabels(setSelectedItems)).toEqual(["uint", "u8"]);

    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(lastLabels(setSelectedItems)).toEqual([]);
  });

  it("opens an item's own page, which picks through `search`", async () => {
    const setSelectedItems = vi.fn();
    render(
      <Harness
        setSelectedItems={setSelectedItems}
        items={[
          {
            label: "Pick",
            closeButton: true,
            DropdownComponent: ({ search }) => (
              <button onClick={() => search({ label: "Out", value: "v" })}>
                go
              </button>
            ),
          },
        ]}
      />
    );
    await userEvent.click(input());
    await userEvent.click(option("Pick"));
    // A page with a close button stays open over a press elsewhere
    fireEvent.mouseDown(document.body);
    await userEvent.click(screen.getByRole("button", { name: "go" }));

    expect(input().value).toBe("v");
    expect(lastLabels(setSelectedItems)).toEqual(["Pick", "Out"]);
  });

  it("a press outside closes the list and restores; one inside does not", async () => {
    render(<Harness items={["kept", "other"]} restoreIfNotSelected />);
    await userEvent.click(input());
    await userEvent.click(option("kept"));
    await userEvent.click(input());
    // "kep" still matches, so the list has a row to press on
    await userEvent.type(input(), "{Backspace}");

    fireEvent.mouseDown(screen.getByRole("option", { name: "kept" }));
    expect(screen.queryAllByRole("option")).not.toHaveLength(0);

    fireEvent.mouseDown(document.body);
    expect(input().value).toBe("kept");
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("closes the list when the field turns inert under a page", async () => {
    const { container } = render(<Harness items={["a"]} />);
    await userEvent.click(input());
    expect(optionNames()).toEqual(["a"]);

    await act(async () => {
      container.setAttribute("inert", "");
    });
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("a list that fails to load says so and stays where it was", async () => {
    failures.actions.length = 0;
    render(
      <Harness
        items={[
          {
            label: "Token accounts",
            items: () => Promise.reject(new Error("rpc")),
          },
        ]}
      />
    );
    await userEvent.click(input());
    await userEvent.click(option("Token accounts"));

    expect(failures.actions).toEqual(["load Token accounts"]);
    expect(optionNames()).toEqual(["Token accounts"]);
  });

  it("opens on the item already chosen, so Enter keeps it", async () => {
    render(<Harness items={["one", "two"]} initialSelectedItems="two" />);
    await userEvent.click(input());
    expect(option("two").getAttribute("data-checked")).toBe("true");
    await userEvent.keyboard("{Enter}");
    expect(input().value).toBe("two");
  });

  it("opens on mount with focus in the field when asked to", () => {
    render(<Harness items={["a"]} showSearchOnMount />);
    expect(optionNames()).toEqual(["a"]);
    expect(document.activeElement).toBe(input());
  });

  it("the search button opens the list", async () => {
    render(<Harness items={["a"]} />);
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(optionNames()).toEqual(["a"]);
  });
});
