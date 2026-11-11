// The IDL's two doors: download what the build produced, and upload a file
// into the browser by picking it.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requireFor } from "../../../test-utils/require-for";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  idl: null as unknown,
  subscribedTo: vi.fn(),
  setStage: vi.fn(),
}));

vi.mock("../state/stage", () => ({ PgFlow: { setStage: mocks.setStage } }));

vi.mock("../../../utils", () => ({
  PgCommon: { getDataUrl: () => "data:application/json," },
  PgProgramInfo: { update: mocks.update, onDidChangeIdl: "idl" },
}));
// Stands in for `useRenderOnChange`'s subscription: the IDL is shared state,
// and every mounted instance re-reads it on a change
const listeners = new Set<() => void>();
const setIdl = (idl: unknown) => {
  mocks.idl = idl;
  listeners.forEach((l) => l());
};
vi.mock("../../../hooks", async () => {
  const { useEffect, useReducer } = await import("react");
  return {
    useRenderOnChange: (event: unknown) => {
      mocks.subscribedTo(event);
      const [, rerender] = useReducer((n: number) => n + 1, 0);
      useEffect(() => {
        listeners.add(rerender);
        return () => {
          listeners.delete(rerender);
        };
      }, []);
      return mocks.idl;
    },
  };
});
vi.mock("@/shared/lib/logger", () => ({
  createLogger: () => ({
    warn: mocks.warn,
    error: mocks.error,
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import IdlActions, {
  loadIdlFile,
  openInteract,
  useIdlName,
} from "./IdlActions";

const COUNTER_IDL = JSON.stringify({ name: "counter", instructions: [] });

const jsonFile = (text: string, name = "idl.json") =>
  new File([text], name, { type: "application/json" });

const pick = (container: HTMLElement, file: File) =>
  fireEvent.change(
    requireFor("the file input")(container.querySelector('input[type="file"]')),
    { target: { files: [file] } }
  );

beforeEach(() => {
  mocks.update.mockImplementation(({ idl }: { idl: unknown }) => setIdl(idl));
});

afterEach(() => {
  mocks.idl = null;
  mocks.update.mockReset();
  vi.clearAllMocks();
});

describe("IdlActions", () => {
  /** The prototype's secondary action, a button rather than a drop zone */
  it("offers Upload IDL, which says nothing reaches the chain", () => {
    const { container } = render(<IdlActions mode="upload" />);

    expect(container.querySelector('[data-slot="drop-zone"]')).toBeNull();
    const button = screen.getByRole("button", { name: "Upload IDL" });
    expect(button.getAttribute("title")).toBe(
      "Replaces the IDL this browser uses in Interact \u2014 nothing is written on-chain"
    );
  });

  /** Outlined where it is the way in; under Deploy's pill, a link */
  it("draws Upload IDL outlined, or as a link when asked", () => {
    const { rerender } = render(<IdlActions mode="upload" />);
    expect(
      screen
        .getByRole("button", { name: "Upload IDL" })
        .getAttribute("data-variant")
    ).toBe("outline");

    rerender(<IdlActions mode="upload" look="link" />);
    expect(
      screen
        .getByRole("button", { name: "Upload IDL" })
        .getAttribute("data-variant")
    ).toBe("link");
  });

  it("uses an IDL picked through it", async () => {
    const { container } = render(<IdlActions mode="upload" />);

    pick(container, jsonFile(COUNTER_IDL));

    expect(await screen.findByText("IDL \u00b7 counter")).toBeTruthy();
    expect(mocks.update).toHaveBeenCalledWith({
      idl: { name: "counter", instructions: [] },
    });
  });

  it("refuses a file that is not JSON, and logs it", async () => {
    const { container } = render(<IdlActions mode="upload" />);

    pick(container, jsonFile("not json", "notes.txt"));

    expect(
      await screen.findByText("That file is not an Anchor IDL.")
    ).toBeTruthy();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalled();
  });

  it("refuses JSON without instructions", async () => {
    const { container } = render(<IdlActions mode="upload" />);

    pick(container, jsonFile(JSON.stringify({ name: "x" })));

    expect(
      await screen.findByText("That file is not an Anchor IDL.")
    ).toBeTruthy();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalled();
  });

  /** The loaded IDL is shared, so every step that offers Upload IDL names it */
  it("names an IDL loaded before it mounted", () => {
    mocks.idl = { name: "counter", instructions: [] };
    render(<IdlActions mode="upload" />);

    expect(screen.getByText("IDL \u00b7 counter")).toBeTruthy();
  });

  it("names an Anchor 1.x IDL by its metadata", () => {
    mocks.idl = { metadata: { name: "vault" }, instructions: [] };
    render(<IdlActions mode="upload" />);

    expect(screen.getByText("IDL \u00b7 vault")).toBeTruthy();
  });

  /** A deploy adds `metadata.address` to a legacy IDL, and no name */
  it("names a deployed legacy IDL by its own name", () => {
    mocks.idl = {
      name: "counter",
      metadata: { address: "6PNd" },
      instructions: [],
    };
    render(<IdlActions mode="upload" />);

    expect(screen.getByText("IDL \u00b7 counter")).toBeTruthy();
  });

  it("says an IDL is loaded when it carries no name", () => {
    mocks.idl = { instructions: [] };
    render(<IdlActions mode="upload" />);

    expect(screen.getByText("IDL loaded")).toBeTruthy();
  });

  it("shows nothing beside the button while no IDL is loaded", () => {
    render(<IdlActions mode="upload" />);

    expect(screen.queryByRole("status")).toBeNull();
  });

  /** Deploy and Interact each mount their own Upload IDL */
  it("shows an IDL uploaded on one step on the other", async () => {
    const deploy = render(<IdlActions mode="upload" />).container;
    const interact = render(<IdlActions mode="upload" />).container;

    pick(deploy, jsonFile(COUNTER_IDL));

    await vi.waitFor(() =>
      expect(within(interact).getByText("IDL \u00b7 counter")).toBeTruthy()
    );
    expect(mocks.subscribedTo).toHaveBeenCalledWith("idl");
  });

  it("drops a refusal once a good file is picked on the same step", async () => {
    const { container } = render(<IdlActions mode="upload" />);

    pick(container, jsonFile("not json"));
    expect(
      await screen.findByText("That file is not an Anchor IDL.")
    ).toBeTruthy();
    pick(container, jsonFile(COUNTER_IDL));

    expect(await screen.findByText("IDL \u00b7 counter")).toBeTruthy();
    expect(screen.queryByText("That file is not an Anchor IDL.")).toBeNull();
  });

  /** A new IDL from anywhere answers the refusal: Deploy, a build */
  it("drops a refusal once the other step loads an IDL", async () => {
    const deploy = render(<IdlActions mode="upload" />).container;
    const interact = render(<IdlActions mode="upload" />).container;

    pick(interact, jsonFile("not json"));
    expect(
      await within(interact).findByText("That file is not an Anchor IDL.")
    ).toBeTruthy();
    pick(deploy, jsonFile(COUNTER_IDL));

    await vi.waitFor(() =>
      expect(within(interact).getByText("IDL \u00b7 counter")).toBeTruthy()
    );
    expect(
      within(interact).queryByText("That file is not an Anchor IDL.")
    ).toBeNull();
  });

  it("keeps a refused file to the step where it was picked", async () => {
    mocks.idl = { name: "counter", instructions: [] };
    const deploy = render(<IdlActions mode="upload" />).container;
    const interact = render(<IdlActions mode="upload" />).container;

    pick(interact, jsonFile("not json"));

    expect(
      await within(interact).findByText("That file is not an Anchor IDL.")
    ).toBeTruthy();
    expect(
      within(deploy).queryByText("That file is not an Anchor IDL.")
    ).toBeNull();
    // The refusal changed nothing: both still name the IDL in use
    expect(within(deploy).getByText("IDL \u00b7 counter")).toBeTruthy();
    expect(within(interact).getByText("IDL \u00b7 counter")).toBeTruthy();
  });

  it("offers no Download IDL until a build produced one", () => {
    const { container } = render(<IdlActions mode="download" />);

    expect(container.textContent).toBe("");
  });

  it("draws Download IDL as a link where asked", () => {
    mocks.idl = { name: "counter", instructions: [] };
    render(<IdlActions mode="download" look="link" />);

    const link = screen.getByRole("link", { name: "Download IDL" });
    expect(link.getAttribute("data-variant")).toBe("link");
  });

  it("downloads the IDL a build produced", () => {
    mocks.idl = { name: "counter", instructions: [] };
    render(<IdlActions mode="download" />);

    const link = screen.getByRole("link", { name: "Download IDL" });
    expect(link.getAttribute("download")).toBe("idl.json");
  });

  /** A throw past the checks is ours, not the user's file's */
  it("does not blame the file for a failure after it was accepted", async () => {
    mocks.update.mockImplementation(() => {
      throw new Error("listener broke");
    });
    const { container } = render(<IdlActions mode="upload" />);

    pick(container, jsonFile(COUNTER_IDL));

    // `ImportButton` reports it, through `reportButtonFailure`'s logger
    await vi.waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(expect.any(Error))
    );
    expect(screen.queryByText("That file is not an Anchor IDL.")).toBeNull();
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  /**
   * A browser fires no change for the file the input already holds, so a
   * file fixed on disk and picked again would be ignored unless the input
   * lets go of it after each pick.
   */
  it("takes the same file picked again", async () => {
    const { container } = render(<IdlActions mode="upload" />);
    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const cleared = vi.fn();
    Object.defineProperty(input, "value", {
      configurable: true,
      get: () => "",
      set: cleared,
    });

    fireEvent.change(input, { target: { files: [jsonFile("not json")] } });

    expect(
      await screen.findByText("That file is not an Anchor IDL.")
    ).toBeTruthy();
    expect(cleared).toHaveBeenCalledWith("");
  });
});

describe("IdlActions on a stage that lists the IDL", () => {
  /** Deploy names the IDL in its summary, so the button stays bare */
  it("names no IDL beside the button, yet shows a refusal", async () => {
    mocks.idl = { name: "counter", instructions: [] };
    const { container } = render(<IdlActions mode="upload-button" />);

    expect(screen.queryByRole("status")).toBeNull();
    pick(container, jsonFile("not json"));
    expect(
      await screen.findByText("That file is not an Anchor IDL.")
    ).toBeTruthy();
  });

  // The guide's drop zone loads through the same door as Upload IDL
  it("loadIdlFile loads an IDL and refuses a file that is not one", async () => {
    mocks.warn.mockClear();
    expect(
      await loadIdlFile(jsonFile(JSON.stringify({ instructions: [] })))
    ).toBe(true);
    expect(mocks.update).toHaveBeenCalledWith({ idl: { instructions: [] } });

    expect(await loadIdlFile(jsonFile("not json"))).toBe(false);
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.warn).toHaveBeenCalledOnce();
  });

  it("openInteract shows Interact", () => {
    openInteract();
    expect(mocks.setStage).toHaveBeenCalledWith("interact");
  });

  const IdlName = () => (
    <span data-testid="name">{useIdlName() ?? "none"}</span>
  );

  it.each([
    ["a legacy IDL", { name: "counter", instructions: [] }, "counter"],
    ["an Anchor 1.x IDL", { metadata: { name: "vault" } }, "vault"],
    ["an IDL with no name", { instructions: [] }, "loaded"],
    // eslint-disable-next-line unicorn/no-null -- the mocked store holds `null` for no IDL
    ["no IDL", null, "none"],
  ])("useIdlName names %s", (_, idl, shown) => {
    mocks.idl = idl;
    render(<IdlName />);

    expect(screen.getByTestId("name").textContent).toBe(shown);
  });
});
