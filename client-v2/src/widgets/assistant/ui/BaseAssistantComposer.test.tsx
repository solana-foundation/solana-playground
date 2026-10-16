import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shared/ui/tooltip";
import { BaseAssistantComposer } from "./BaseAssistantComposer";

interface Setup {
  busy?: boolean;
  value?: string;
  placeholder?: string;
  chips?: Array<{ label: string; title: string }>;
  focusRequest?: number;
}

/** The Base with its value held the way the connected composer holds it */
const setup = ({
  busy = false,
  value = "",
  placeholder = "Ask about this project…",
  chips = [],
  focusRequest = 0,
}: Setup = {}) => {
  const onSend = vi.fn();
  const onStop = vi.fn();
  const Harness = () => {
    const [text, setText] = useState(value);
    return (
      <TooltipProvider>
        <BaseAssistantComposer
          chips={chips}
          value={text}
          onValueChange={setText}
          onSend={onSend}
          onStop={onStop}
          busy={busy}
          placeholder={placeholder}
          model={<span>model slot</span>}
          effort={<span>effort slot</span>}
          focusRequest={focusRequest}
        />
      </TooltipProvider>
    );
  };
  const view = render(<Harness />);
  return { onSend, onStop, user: userEvent.setup(), view };
};

const input = () =>
  screen.getByRole("textbox", { name: "Message the assistant" });

describe("BaseAssistantComposer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the typed text once on Enter", async () => {
    const { onSend, user } = setup();
    await user.type(input(), "hello{Enter}");
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("hello");
  });

  it("does not send on Shift+Enter", async () => {
    const { onSend, user } = setup();
    await user.type(input(), "hello{Shift>}{Enter}{/Shift}");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows Stop while busy, and pressing it stops", async () => {
    const { onStop, onSend, user } = setup({ busy: true, value: "draft" });
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("neither sends nor stops on Enter during a turn", async () => {
    const { onStop, onSend, user } = setup({ busy: true, value: "draft" });
    await user.type(input(), "{Enter}");
    expect(onSend).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
  });

  it("keeps the input editable during a turn", () => {
    setup({ busy: true });
    expect(input()).toHaveProperty("disabled", false);
  });

  it("enables Send for a value the parent put in", () => {
    setup({ value: "Explain this build error" });
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty(
      "disabled",
      false
    );
  });

  it("disables Send while there is nothing to send", () => {
    setup();
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty(
      "disabled",
      true
    );
  });

  it("renders each chip focusable, explained by a tooltip on focus", async () => {
    // The tooltip's positioning watches its trigger's size
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    const { user } = setup({
      chips: [
        { label: "3 files", title: "Every path is sent" },
        { label: "idl", title: "The built program's interface" },
      ],
    });
    const files = screen.getByText("3 files");
    expect(files.getAttribute("tabindex")).toBe("0");
    expect(files.getAttribute("title")).toBeNull();
    await user.tab();
    expect(document.activeElement).toBe(files);
    expect(
      (await screen.findAllByText("Every path is sent")).length
    ).toBeGreaterThan(0);
    expect(screen.getByText("idl").getAttribute("tabindex")).toBe("0");
  });

  it("renders no context list without chips", () => {
    const { view } = setup();
    expect(
      view.container.querySelector('[data-slot="composer-context"]')
    ).toBeNull();
  });

  it("follows the placeholder it is given", () => {
    setup({ placeholder: "Working…" });
    expect(input().getAttribute("placeholder")).toBe("Working…");
  });

  it("renders the model and effort slots, the footer, and no Add", () => {
    setup();
    expect(screen.getByText("model slot")).toBeTruthy();
    expect(screen.getByText("effort slot")).toBeTruthy();
    expect(
      screen.getByText("Nothing is written to your project without your click")
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add context" })).toBeNull();
  });

  it("focuses the input when asked, and not on mount", () => {
    const composer = (focusRequest: number) => (
      <BaseAssistantComposer
        chips={[]}
        value=""
        onValueChange={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        busy={false}
        placeholder="Ask"
        model={null}
        effort={null}
        focusRequest={focusRequest}
      />
    );
    const { rerender } = render(composer(0));
    expect(document.activeElement).not.toBe(input());
    rerender(composer(1));
    expect(document.activeElement).toBe(input());
  });
});
