// The design-system components in shared/ui mount and respond in client-v2
// as installed: React 19, our aliases and jsdom, with no edit by hand.
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppProviders } from "./App";
import { Button } from "@/shared/ui/button";
import { Field, FieldLabel } from "@/shared/ui/field";
import { NativeSelect, NativeSelectOption } from "@/shared/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/shared/ui/resizable";
import { Segmented, SegmentedItem } from "@/shared/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/shared/ui/sidebar";
import { Stepper, StepperItem, StepperList } from "@/shared/ui/stepper";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

// jsdom has neither, every browser has both. `useIsMobile` reads
// `window.innerWidth` and only subscribes through `matchMedia`, so the stub
// needs no answer; the width decides. The panel group measures itself with a
// `ResizeObserver`.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function noopMatchMedia(query: string) {
  return {
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  };
}

// Below `use-mobile`'s 768px breakpoint; jsdom's own width is 1024.
const PHONE_WIDTH = 500;

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  vi.stubGlobal("matchMedia", noopMatchMedia);
  // A React warning during render (an unknown prop after a dependency bump)
  // is a failure here, not noise.
  consoleError = vi.spyOn(console, "error");
});

afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
  vi.unstubAllGlobals();
});

function renderShell() {
  return render(
    <SidebarProvider>
      <Sidebar>
        <SidebarContent>Explorer</SidebarContent>
      </Sidebar>
      <SidebarInset>
        <SidebarTrigger />
      </SidebarInset>
    </SidebarProvider>
  );
}

describe("shared/ui", () => {
  it("collapses the sidebar from its trigger on a desktop width", () => {
    const { container } = renderShell();
    const sidebar = container.querySelector('[data-slot="sidebar"]');
    expect(sidebar?.getAttribute("data-state")).toBe("expanded");

    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));

    expect(sidebar?.getAttribute("data-state")).toBe("collapsed");
  });

  it("opens the sidebar as a sheet from its trigger on a phone width", () => {
    vi.stubGlobal("innerWidth", PHONE_WIDTH);
    renderShell();
    expect(screen.queryByText("Explorer")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));

    const sheet = document.querySelector(
      '[data-slot="sidebar"][data-mobile="true"]'
    );
    expect(sheet?.textContent).toContain("Explorer");
  });

  it("renders two resizable panels with a handle between them", () => {
    const { container } = render(
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel>Editor</ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel>Terminal</ResizablePanel>
      </ResizablePanelGroup>
    );

    expect(
      container.querySelectorAll('[data-slot="resizable-panel"]')
    ).toHaveLength(2);
    expect(
      container.querySelectorAll('[data-slot="resizable-handle"]')
    ).toHaveLength(1);
  });

  it("renders a button outside the sidebar with its own data-slot", () => {
    render(<Button>Build</Button>);

    expect(
      screen.getByRole("button", { name: "Build" }).getAttribute("data-slot")
    ).toBe("button");
  });

  it("shows a tooltip 500 ms after the pointer reaches its trigger", () => {
    vi.useFakeTimers();
    try {
      render(
        <AppProviders>
          <Tooltip>
            <TooltipTrigger asChild>
              <button>Refresh</button>
            </TooltipTrigger>
            <TooltipContent>Reload the panel</TooltipContent>
          </Tooltip>
        </AppProviders>
      );

      fireEvent.pointerMove(screen.getByRole("button", { name: "Refresh" }));
      act(() => {
        vi.advanceTimersByTime(499);
      });
      expect(screen.queryByRole("tooltip")).toBeNull();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.getByRole("tooltip").textContent).toContain(
        "Reload the panel"
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the controls, as installed", () => {
  it("mount with their data-slot names", () => {
    render(
      <>
        <Stepper value="build">
          <StepperList>
            <StepperItem value="build">Build</StepperItem>
          </StepperList>
        </Stepper>
        <Select value="a">
          <SelectTrigger aria-label="Pick">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="a">A</SelectItem>
          </SelectContent>
        </Select>
        <NativeSelect aria-label="Native">
          <NativeSelectOption value="x">X</NativeSelectOption>
        </NativeSelect>
        <RadioGroup aria-label="Radios">
          <RadioGroupItem value="r" aria-label="R" />
        </RadioGroup>
        <Field>
          <FieldLabel htmlFor="f">F</FieldLabel>
          <input id="f" />
        </Field>
      </>
    );
    expect(
      screen.getByRole("tab", { name: /Build/ }).getAttribute("data-slot")
    ).toBe("stepper-item");
    expect(
      screen.getByRole("combobox", { name: "Pick" }).getAttribute("data-slot")
    ).toBe("select-trigger");
    expect(
      screen.getByRole("combobox", { name: "Native" }).getAttribute("data-slot")
    ).toBe("native-select");
    expect(
      screen.getByRole("radio", { name: "R" }).getAttribute("data-slot")
    ).toBe("radio-group-item");
    expect(
      screen.getByLabelText("F").closest('[data-slot="field"]')
    ).not.toBeNull();
  });
});

describe("Segmented, a choice of a few", () => {
  function renderChoice(onValueChange: (value: string) => void) {
    return render(
      <Segmented
        variant="chips"
        aria-label="Network"
        value="devnet"
        onValueChange={onValueChange}
      >
        <SegmentedItem value="devnet">Devnet</SegmentedItem>
        <SegmentedItem value="testnet">Testnet</SegmentedItem>
        <SegmentedItem value="localnet">Localnet</SegmentedItem>
      </Segmented>
    );
  }

  it("picks the next one with the right arrow and moves focus to it", async () => {
    const onValueChange = vi.fn();
    renderChoice(onValueChange);
    act(() => screen.getByRole("radio", { name: "Devnet" }).focus());

    await userEvent.keyboard("{ArrowRight}");

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith("testnet");
    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: "Testnet" })
    );
  });

  it("picks the last one with End", async () => {
    const onValueChange = vi.fn();
    renderChoice(onValueChange);
    act(() => screen.getByRole("radio", { name: "Devnet" }).focus());

    await userEvent.keyboard("{End}");

    expect(onValueChange).toHaveBeenCalledWith("localnet");
  });

  it("picks nothing when focus lands on an item without an arrow key", async () => {
    const onValueChange = vi.fn();
    renderChoice(onValueChange);

    act(() => screen.getByRole("radio", { name: "Testnet" }).focus());
    await userEvent.tab({ shift: true });
    await userEvent.tab();

    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("picks once on a click", async () => {
    const onValueChange = vi.fn();
    renderChoice(onValueChange);

    await userEvent.click(screen.getByRole("radio", { name: "Testnet" }));

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith("testnet");
  });

  it("does not pick on a later focus after an arrow that moved nothing", async () => {
    const onValueChange = vi.fn();
    render(
      <Segmented aria-label="One" value="only" onValueChange={onValueChange}>
        <SegmentedItem value="only">Only</SegmentedItem>
      </Segmented>
    );
    const only = screen.getByRole("radio", { name: "Only" });
    act(() => only.focus());
    await userEvent.keyboard("{ArrowRight}");
    act(() => only.blur());
    act(() => only.focus());

    expect(onValueChange).not.toHaveBeenCalled();
  });
});
