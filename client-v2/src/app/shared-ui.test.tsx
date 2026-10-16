// The design-system components in shared/ui mount and respond in client-v2
// as installed: React 19, our aliases and jsdom, with no edit by hand.
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Button } from "@/shared/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/shared/ui/resizable";
import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/shared/ui/sidebar";

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
});
