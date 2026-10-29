import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as logMemory,
  resetLogger,
} from "@/shared/lib/logger";
import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import { PgCommon } from "@/utils/common";
import { PgView } from "@/utils/view";
import { ModalFrame } from "./ModalFrame";
import { ModalHost } from "./ModalHost";

let sent: ReturnType<typeof memoryProvider>;
beforeEach(() => {
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
});
afterEach(() => {
  vi.restoreAllMocks();
  resetTelemetry();
  // Dialogs a test leaves open would otherwise sit under the next test's
  act(() => {
    while (PgView.getOpenModals().length) PgView.closeTopModal();
  });
});

const PENDING = "pending";

/** What `promise` has settled to by the time queued microtasks have run */
const settled = async (promise: Promise<unknown>) =>
  Promise.race([promise, PgCommon.sleep(0).then(() => PENDING)]);

const Info = () => (
  <ModalFrame name="info" title="Info">
    <p>Nothing to do</p>
  </ModalFrame>
);

/** A dialog with typed state that opens a second one on top of itself */
const Outer = () => {
  const [value, setValue] = useState("");
  return (
    <ModalFrame
      name="outer"
      title="Outer"
      buttonProps={{
        text: "Next",
        onSubmit: () => PgView.setModal(Info),
        noCloseOnSubmit: true,
      }}
    >
      <input
        aria-label="Outer name"
        value={value}
        onChange={(ev) => setValue(ev.target.value)}
      />
    </ModalFrame>
  );
};

/** Opens a dialog and returns the promise of its answer */
const open = (body: Parameters<typeof PgView.setModal>[0]) => {
  let answer!: Promise<unknown>;
  act(() => {
    answer = PgView.setModal(body);
  });
  return answer;
};

it("should show a dialog opened with PgView.setModal", () => {
  render(<ModalHost />);

  open(Info);

  expect(screen.getByRole("dialog", { name: "Info" })).toBeTruthy();
  expect(screen.getByText("Nothing to do")).toBeTruthy();
});

it("should close on Escape and answer null", async () => {
  render(<ModalHost />);
  const answer = open(Info);

  act(() => {
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  });

  await expect(answer).resolves.toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("should answer with what the submit returned", async () => {
  const Ask = () => (
    <ModalFrame
      name="ask"
      title="Ask"
      buttonProps={{ text: "Yes", onSubmit: () => "yes" }}
    />
  );
  render(<ModalHost />);
  const answer = open(Ask);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
  });

  await expect(answer).resolves.toBe("yes");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("should show a stacked dialog and bring back the first with its text", async () => {
  render(<ModalHost />);
  const outer = open(Outer);
  fireEvent.change(screen.getByRole("textbox", { name: "Outer name" }), {
    target: { value: "draft" },
  });

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
  });

  expect(screen.getAllByRole("dialog").length).toBe(1);
  expect(screen.getByRole("dialog", { name: "Info" })).toBeTruthy();

  // Async: Info's answer settles Outer's submit, which ends its busy state
  await act(async () => {
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  });

  expect(screen.getByRole("dialog", { name: "Outer" })).toBeTruthy();
  expect(
    (screen.getByRole("textbox", { name: "Outer name" }) as HTMLInputElement)
      .value
  ).toBe("draft");
  // Closing Info answered Info's caller only
  await expect(settled(outer)).resolves.toBe(PENDING);
  // The first dialog stayed mounted, so it reported opening only once
  expect(
    sent.events
      .filter((event) => event.name === "overlay_modal_opened")
      .map((event) => event.params)
  ).toEqual([{ name: "outer" }, { name: "info" }]);
});

it("should fire onDidOpenModal on each open", () => {
  const opened = vi.fn();
  const listener = PgView.onDidOpenModal(opened);
  render(<ModalHost />);

  open(Info);
  open(Info);

  expect(opened).toHaveBeenCalledTimes(2);
  listener.dispose();
});

it("should not close on Escape while the submit runs, and answer once it settles", async () => {
  let finish!: (value: string) => void;
  const Slow = () => (
    <ModalFrame
      name="slow"
      title="Slow"
      buttonProps={{
        text: "Save",
        onSubmit: () => new Promise<string>((resolve) => (finish = resolve)),
      }}
    />
  );
  render(<ModalHost />);
  const answer = open(Slow);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });
  act(() => {
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  });
  expect(screen.getByRole("dialog", { name: "Slow" })).toBeTruthy();

  await act(async () => finish("saved"));

  await expect(answer).resolves.toBe("saved");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("should close a dialog that throws while rendering, report it, tell the user and answer null", async () => {
  const logs = logMemory();
  initLogger({ providers: [logs] });
  vi.spyOn(console, "error").mockImplementation(() => {});
  const toast = vi.spyOn(PgView, "setToast").mockImplementation(() => {});
  const Broken = (): never => {
    throw new Error("render failed");
  };
  render(
    <>
      <p>the IDE</p>
      <ModalHost />
    </>
  );

  const answer = open(Broken);

  await expect(answer).resolves.toBeNull();
  expect(screen.getByText("the IDE")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    logs.entries.map((entry) => ({ ns: entry.ns, report: entry.report }))
  ).toEqual([{ ns: "overlays:modal-host", report: true }]);
  expect(toast).toHaveBeenCalledTimes(1);
  expect(toast.mock.calls[0][1].options.name).toBe("modal-failed");
  resetLogger();
});

it("should close the dialog that throws, not the one on top of it", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  let breakLower!: () => void;
  const Fragile = () => {
    const [broken, setBroken] = useState(false);
    breakLower = () => setBroken(true);
    if (broken) throw new Error("render failed");
    return <ModalFrame name="fragile" title="Fragile" />;
  };
  render(<ModalHost />);
  const lower = open(Fragile);
  const upper = open(Info);

  act(() => breakLower());

  await expect(settled(lower)).resolves.toBeNull();
  await expect(settled(upper)).resolves.toBe(PENDING);
  expect(screen.getByRole("dialog", { name: "Info" })).toBeTruthy();
});

it("should keep the dialogs open across a remount of the host", async () => {
  const first = render(<ModalHost />);
  const answer = open(Info);

  first.unmount();
  render(<ModalHost />);

  expect(screen.getByRole("dialog", { name: "Info" })).toBeTruthy();
  act(() => {
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  });
  await expect(answer).resolves.toBeNull();
});

it("should open a dialog that replaces another of its kind with fresh state", () => {
  render(<ModalHost />);
  open(Outer);
  fireEvent.change(screen.getByRole("textbox", { name: "Outer name" }), {
    target: { value: "draft" },
  });

  act(() => {
    PgView.closeTopModal();
    PgView.setModal(Outer);
  });

  expect(
    (screen.getByRole("textbox", { name: "Outer name" }) as HTMLInputElement)
      .value
  ).toBe("");
});

it("should answer a submit that settles under another dialog to its own caller", async () => {
  let finish!: (value: string) => void;
  const Slow = () => (
    <ModalFrame
      name="slow"
      title="Slow"
      buttonProps={{
        text: "Save",
        onSubmit: () => new Promise<string>((resolve) => (finish = resolve)),
      }}
    />
  );
  render(<ModalHost />);
  const slow = open(Slow);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });
  const info = open(Info);

  await act(async () => finish("saved"));

  await expect(settled(slow)).resolves.toBe("saved");
  await expect(settled(info)).resolves.toBe(PENDING);
  expect(screen.getByRole("dialog", { name: "Info" })).toBeTruthy();
});

describe("focus after a dialog closes", () => {
  it("should return focus to the button that opened the dialog", async () => {
    render(
      <>
        <button onClick={() => void PgView.setModal(Info)}>Open info</button>
        <ModalHost />
      </>
    );
    const opener = screen.getByRole("button", { name: "Open info" });
    opener.focus();
    act(() => opener.click());
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Info" })).toBeTruthy()
    );

    act(() => {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    });

    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("should return focus to a menu's trigger when an item of the menu opened it", async () => {
    // A menu closes when one of its items is picked, so the item is gone by
    // the time the dialog closes; its trigger names it through aria-controls
    const Menu = () => {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button aria-controls="actions-menu">Actions</button>
          {open && (
            <div role="menu" id="actions-menu">
              <button
                role="menuitem"
                onClick={() => {
                  void PgView.setModal(Info);
                  setOpen(false);
                }}
              >
                Show info
              </button>
            </div>
          )}
        </>
      );
    };
    render(
      <>
        <Menu />
        <ModalHost />
      </>
    );
    const item = screen.getByRole("menuitem", { name: "Show info" });
    item.focus();
    act(() => item.click());
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Info" })).toBeTruthy()
    );

    act(() => {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    });

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Actions" })
      )
    );
  });

  it("should keep focus in the dialog below when the one on top closes", async () => {
    render(<ModalHost />);
    open(Outer);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    });

    act(() => {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    });

    await waitFor(() =>
      expect(
        screen
          .getByRole("dialog", { name: "Outer" })
          .contains(document.activeElement)
      ).toBe(true)
    );
  });

  it("should return focus to what opened a dialog another one followed", async () => {
    const Confirm = () => (
      <ModalFrame
        name="confirm"
        title="Confirm"
        buttonProps={{ text: "Yes", onSubmit: () => "yes" }}
      />
    );
    render(
      <>
        <button
          onClick={async () => {
            if (await PgView.setModal(Confirm)) void PgView.setModal(Info);
          }}
        >
          Delete
        </button>
        <ModalHost />
      </>
    );
    const opener = screen.getByRole("button", { name: "Delete" });
    opener.focus();
    act(() => opener.click());
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Yes" }));
    });
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Info" })).toBeTruthy()
    );

    act(() => {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    });

    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("should not focus the opener while another dialog has taken its place", async () => {
    render(
      <>
        <button onClick={() => void PgView.setModal(Info)}>Open info</button>
        <ModalHost />
      </>
    );
    const opener = screen.getByRole("button", { name: "Open info" });
    opener.focus();
    act(() => opener.click());
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Info" })).toBeTruthy()
    );
    const focused = vi.fn();
    opener.addEventListener("focus", focused);

    act(() => {
      PgView.closeTopModal();
      void PgView.setModal(Outer);
    });

    await waitFor(() =>
      expect(
        screen
          .getByRole("dialog", { name: "Outer" })
          .contains(document.activeElement)
      ).toBe(true)
    );
    await act(async () => {
      await PgCommon.sleep(10);
    });
    expect(focused).not.toHaveBeenCalled();
  });

  it("should return focus to the trigger of a menu a submenu opened from", async () => {
    const Menus = () => {
      // Picking an item closes the menu and the menus above it
      const [open, setOpen] = useState(true);
      return (
        <>
          <button aria-controls="outer-menu">More</button>
          {open && (
            <>
              <div role="menu" id="outer-menu">
                <button role="menuitem" aria-controls="inner-menu">
                  Export
                </button>
              </div>
              <div role="menu" id="inner-menu">
                <button
                  role="menuitem"
                  onClick={() => {
                    void PgView.setModal(Info);
                    setOpen(false);
                  }}
                >
                  As zip
                </button>
              </div>
            </>
          )}
        </>
      );
    };
    render(
      <>
        <Menus />
        <ModalHost />
      </>
    );
    const item = screen.getByRole("menuitem", { name: "As zip" });
    item.focus();
    act(() => item.click());
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Info" })).toBeTruthy()
    );

    act(() => {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    });

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "More" })
      )
    );
  });
});

describe("focus after a dialog opened from a context menu", () => {
  /** A context menu: its trigger names no menu, so the right-click is the opener */
  const ContextMenu = ({ children }: { children: React.ReactNode }) => {
    const [open, setOpen] = useState(false);
    return (
      <div onContextMenu={() => setOpen(true)}>
        {children}
        {open && (
          <div role="menu">
            <button
              role="menuitem"
              onClick={() => {
                void PgView.setModal(Info);
                setOpen(false);
              }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
    );
  };

  const pickDeleteThenCancel = async () => {
    const item = await screen.findByRole("menuitem", { name: "Delete" });
    item.focus();
    act(() => item.click());
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Info" })).toBeTruthy()
    );
    act(() => {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    });
  };

  it("should return focus to the explorer row the menu was opened on", async () => {
    render(
      <>
        <ContextMenu>
          {/* dnd-kit's attributes make every row a tabbable button */}
          <div
            className={PgView.classNames.FILE}
            role="button"
            tabIndex={0}
            data-testid="row"
          >
            <span>lib.rs</span>
          </div>
        </ContextMenu>
        <ModalHost />
      </>
    );
    fireEvent.contextMenu(screen.getByText("lib.rs"));

    await pickDeleteThenCancel();

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("row"))
    );
  });

  it("should return focus to the editor tab the menu was opened on", async () => {
    render(
      <>
        <ContextMenu>
          <div role="presentation">
            <button role="tab">
              <span>lib.rs</span>
            </button>
          </div>
        </ContextMenu>
        <ModalHost />
      </>
    );
    fireEvent.contextMenu(screen.getByText("lib.rs"));

    await pickDeleteThenCancel();

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("tab"))
    );
  });
});
