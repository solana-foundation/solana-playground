import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shared/ui/tooltip";
import { requireFor } from "@/test-utils/require-for";

import type { ComposerContextChip } from "./BaseAssistantComposer";
import { BaseAssistantComposer } from "./BaseAssistantComposer";

interface Setup {
  busy?: boolean;
  value?: string;
  placeholder?: string;
  chips?: ComposerContextChip[];
  focusRequest?: number;
  sendBlocked?: string | null;
  addable?: { path: string; add(): void }[];
}

/** The Base with its value held the way the connected composer holds it */
const setup = ({
  busy = false,
  value = "",
  placeholder = "Ask about this project…",
  chips = [],
  focusRequest = 0,
  sendBlocked = null,
  addable = [],
}: Setup = {}) => {
  const onSend = vi.fn();
  const onStop = vi.fn();
  const onSources = vi.fn();
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
          sendBlocked={sendBlocked}
          onSources={onSources}
          addable={addable}
          focusPicked={() => false}
        />
      </TooltipProvider>
    );
  };
  const view = render(<Harness />);
  return {
    onSend,
    onStop,
    onSources,
    user: userEvent.setup(),
    view,
  };
};

/** A chip, by its short label */
const chipOf = (label: string) => {
  // The tooltip's trigger renames the chip's `data-slot`; the chip is the tab stop
  const chip = screen.getByText(label).closest<HTMLElement>('[tabindex="0"]');
  if (!chip) throw new Error(`no chip labelled ${label}`);
  return chip;
};

const input = () =>
  screen.getByRole("textbox", { name: "Message the assistant" });

/**
 * Opens + › Add a file from the keyboard, as the submenu's own focus: jsdom
 * has no pointer geometry for Radix's grace area, so a click into the
 * submenu closes it first
 */
const openAddFile = async (user: ReturnType<typeof userEvent.setup>) => {
  screen.getByRole("menuitem", { name: "Add a file" }).focus();
  await user.keyboard("{ArrowRight}");
};

/** Picks a file in the open Add a file submenu */
const pickFile = async (
  user: ReturnType<typeof userEvent.setup>,
  path: string
) => {
  screen.getByRole("menuitem", { name: path }).focus();
  await user.keyboard("{Enter}");
};

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

  it("stops a running turn on Escape, and keeps the draft", async () => {
    const { onStop, user } = setup({ busy: true, value: "draft" });
    input().focus();
    await user.keyboard("{Escape}");
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(input()).toHaveProperty("value", "draft");
  });

  it("does nothing on Escape with no turn running", async () => {
    const { onStop, user } = setup({ value: "draft" });
    input().focus();
    await user.keyboard("{Escape}");
    expect(onStop).not.toHaveBeenCalled();
    expect(input()).toHaveProperty("value", "draft");
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

  it("disables Send with text in while nothing can take the message, and sends nothing", async () => {
    // Pointing at the blocked Send opens its tooltip, whose positioning
    // watches the trigger's size
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    const { onSend, user } = setup({
      value: "Explain this build error",
      sendBlocked: "Connect a model to send",
    });
    const send = screen.getByRole("button", { name: "Send" });
    expect(send.getAttribute("aria-disabled")).toBe("true");
    await user.type(input(), "{Enter}");
    await user.click(send);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("names why Send is disabled to the input, for a screen reader", () => {
    setup({ sendBlocked: "Connect a model to send" });
    const reason = input().getAttribute("aria-describedby");
    expect(reason).toBeTruthy();
    const description = document.getElementById(
      requireFor("the describing id")(reason)
    );
    expect(description?.textContent).toBe("Connect a model to send");
  });

  it("shows Stop, and no blocked Send, during a turn", async () => {
    const { onStop, user } = setup({
      busy: true,
      sendBlocked: "Connect a model to send",
    });
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(input().hasAttribute("aria-describedby")).toBe(false);
  });

  it("says why Send is disabled, on focus", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    const { user } = setup({
      value: "hello",
      sendBlocked: "Connect a model to send",
    });
    await user.click(input());
    // Past +, which sits before the model
    await user.tab();
    await user.tab();
    const send = screen.getByRole("button", { name: "Send" });
    expect(document.activeElement).toBe(send);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Connect a model to send"
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
        {
          label: "3 files",
          title: "Every path is sent",
          spoken: "Sent with this message: the paths of all 3 files",
        },
        {
          label: "idl",
          title: "The built program's interface",
          spoken: "Sent with this message: the built program's interface",
        },
      ],
    });
    const files = chipOf("3 files");
    expect(files.getAttribute("tabindex")).toBe("0");
    expect(files.getAttribute("title")).toBeNull();
    await user.tab();
    expect(document.activeElement).toBe(files);
    expect(
      (await screen.findAllByText("Every path is sent")).length
    ).toBeGreaterThan(0);
    expect(chipOf("idl").getAttribute("tabindex")).toBe("0");
  });

  it("names each chip by what it sends, for a screen reader", () => {
    setup({
      chips: [
        {
          label: "lib.rs active",
          title: "The tab you are looking at",
          spoken: "Sent with this message: lib.rs, the open file, in full",
        },
      ],
    });
    const chip = chipOf("lib.rs active");
    // What a screen reader reads is the spoken name, not the short label
    expect(
      within(chip).getByText("lib.rs active").getAttribute("aria-hidden")
    ).toBe("true");
    expect(
      within(chip).getByText(
        "Sent with this message: lib.rs, the open file, in full"
      ).className
    ).toContain("sr-only");
  });

  it("removes a chip that offers it, with a 44 px target on a phone", async () => {
    // Pressing it focuses the chip, whose tooltip watches its size
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    const run = vi.fn();
    const { user } = setup({
      chips: [
        {
          label: "lib.rs active",
          title: "The tab you are looking at",
          spoken: "Sent with this message: lib.rs, the open file, in full",
          remove: { label: "Remove lib.rs from the context", run },
        },
        { label: "3 files", title: "Every path", spoken: "Sent: all 3 paths" },
      ],
    });
    const remove = screen.getByRole("button", {
      name: "Remove lib.rs from the context",
    });
    expect(remove.className).toContain("before:-inset-y-3.5");
    expect(chipOf("lib.rs active").className).toContain(
      "before:-inset-y-[11px]"
    );
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(1);
    await user.click(remove);
    expect(run).toHaveBeenCalledTimes(1);
    // The button goes with its chip; the keyboard lands in the input
    expect(document.activeElement).toBe(input());
  });

  it("puts focus in the input when the removed chip goes away", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    const Removable = () => {
      const [kept, setKept] = useState(true);
      return (
        <TooltipProvider>
          <BaseAssistantComposer
            chips={
              kept
                ? [
                    {
                      label: "lib.rs",
                      title: "The tab you are looking at",
                      spoken: "Sent with this message: lib.rs",
                      remove: {
                        label: "Remove lib.rs from the context",
                        run: () => setKept(false),
                      },
                    },
                  ]
                : []
            }
            value=""
            onValueChange={vi.fn()}
            onSend={vi.fn()}
            onStop={vi.fn()}
            busy={false}
            placeholder="Ask"
            model={undefined}
            effort={undefined}
            onSources={vi.fn()}
            addable={[]}
            focusPicked={() => false}
          />
        </TooltipProvider>
      );
    };
    render(<Removable />);
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", {
        name: "Remove lib.rs from the context",
      })
    );

    expect(screen.queryByText("lib.rs")).toBeNull();
    expect(document.activeElement).toBe(input());
  });

  describe("the + menu", () => {
    it("offers Add a file and Sources and tools, and no Connect", async () => {
      const { user, onSources } = setup();
      await user.click(screen.getByRole("button", { name: "Add context" }));
      const items = screen.getAllByRole("menuitem").map((i) => i.textContent);
      expect(items).toEqual(["Add a file", "Sources and toolsS"]);
      await user.click(
        screen.getByRole("menuitem", { name: /Sources and tools/ })
      );
      expect(onSources).toHaveBeenCalledTimes(1);
    });
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

  it("renders the model and effort slots, the footer, and Add", () => {
    setup();
    expect(screen.getByText("model slot")).toBeTruthy();
    expect(screen.getByText("effort slot")).toBeTruthy();
    expect(
      screen.getByText("Nothing is written to your project without your click")
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add context" })).toBeTruthy();
  });

  it("lists the files outside the context under Add a file, and adds the one picked", async () => {
    const add = vi.fn();
    const { user } = setup({
      addable: [
        { path: "tests/anchor.test.ts", add },
        { path: "client/client.ts", add: vi.fn() },
      ],
    });

    await user.click(screen.getByRole("button", { name: "Add context" }));
    await openAddFile(user);
    expect(
      screen.getByRole("menuitem", { name: "client/client.ts" })
    ).toBeTruthy();
    await pickFile(user, "tests/anchor.test.ts");

    expect(add).toHaveBeenCalledTimes(1);
  });

  it("says every file is in the context when none is left to add", async () => {
    const { user } = setup({ addable: [] });

    await user.click(screen.getByRole("button", { name: "Add context" }));
    await openAddFile(user);

    expect(screen.getByText("Every file is in the context")).toBeTruthy();
  });

  it("keeps a typed letter in the file list from picking Sources", async () => {
    const { user, onSources } = setup({
      addable: [{ path: "src/lib.rs", add: vi.fn() }],
    });

    await user.click(screen.getByRole("button", { name: "Add context" }));
    await openAddFile(user);
    await user.keyboard("s");

    expect(onSources).not.toHaveBeenCalled();
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
        onSources={vi.fn()}
        addable={[]}
        focusPicked={() => false}
      />
    );
    const { rerender } = render(composer(0));
    expect(document.activeElement).not.toBe(input());
    rerender(composer(1));
    expect(document.activeElement).toBe(input());
  });
});
