// The program settings' imports and the IDL's init button: a failure is
// reported and leaves the control usable.
import type { ReactElement } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, type DefaultTheme } from "styled-components";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  report: vi.fn(),
  anchor: vi.fn(),
  update: vi.fn(),
  fetchIdl: vi.fn(),
  noop: () => ({ dispose: () => undefined }),
}));

// The real barrels pull in the whole playground; the settings read only these
vi.mock("../../../../../utils", () => ({
  PgCommand: { anchor: { execute: mocks.anchor } },
  PgCommon: {
    transition: (promise: Promise<unknown>) => promise,
    batchChanges: (fn: () => void) => {
      fn();
      return { dispose: () => undefined };
    },
    getDataUrl: () => "data:",
    isPk: () => true,
  },
  PgProgramInfo: {
    idl: { name: "counter" },
    pk: { toBase58: () => "pk" },
    update: mocks.update,
    fetchIdl: mocks.fetchIdl,
    onDidChange: mocks.noop,
    onDidChangePk: mocks.noop,
  },
  PgWallet: { current: { publicKey: "me" }, onDidChangeCurrent: mocks.noop },
  PgWeb3: { Keypair: { fromSecretKey: () => ({}) } },
}));
vi.mock("../../../../../hooks", () => ({ useRenderOnChange: () => null }));
vi.mock("../../../../../components/Input", () => ({ default: () => null }));
vi.mock("../../../../../components/Icons", () => ({ Warning: () => null }));
vi.mock("@/widgets/overlays", () => ({ ModalFrame: () => null }));
vi.mock("@/shared/ui/copy-button", () => ({ CopyButton: () => null }));
vi.mock("@/shared/lib/report-button-failure", () => ({
  reportButtonFailure: mocks.report,
}));

import IDL from "./IDL";
import ProgramBinary from "./ProgramBinary";
import ProgramID from "./ProgramID";

/** A theme that answers every key; the styles do not matter here */
const anyTheme: DefaultTheme = new Proxy(
  {},
  {
    get: (_, key) =>
      key === Symbol.toPrimitive || key === "toString"
        ? () => "inherit"
        : anyTheme,
  }
) as unknown as DefaultTheme;

const renderIn = (ui: ReactElement) =>
  render(<ThemeProvider theme={anyTheme}>{ui}</ThemeProvider>);

/** Picks a file through the hidden input of the import button */
const pick = async (container: HTMLElement, file: File) => {
  const input = container.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement;
  await act(async () => fireEvent.change(input, { target: { files: [file] } }));
};

afterEach(() => vi.clearAllMocks());

describe("IDL settings", () => {
  it("reports a malformed idl.json and does not name it as imported", async () => {
    mocks.fetchIdl.mockResolvedValue({ authority: { equals: () => true } });
    const { container } = renderIn(<IDL />);

    await pick(container, new File(["{"], "idl.json"));

    expect(mocks.report).toHaveBeenCalledWith(expect.any(SyntaxError));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(screen.queryByText("idl.json")).toBeNull();
  });

  it("accepts a click again after a failed initialization", async () => {
    mocks.fetchIdl.mockResolvedValue(null);
    const failure = new Error("wallet rejected");
    mocks.anchor.mockRejectedValue(failure);
    renderIn(<IDL />);
    const init = await screen.findByRole("button", { name: "Initialize" });

    await act(async () => fireEvent.click(init));

    expect(mocks.report).toHaveBeenCalledWith(failure);
    const again = screen.getByRole("button", { name: "Initialize" });
    expect((again as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("program binary settings", () => {
  it("reports a binary that cannot be read", async () => {
    const failure = new Error("unreadable");
    const file = new File([""], "program.so");
    vi.spyOn(file, "arrayBuffer").mockRejectedValue(failure);
    const { container } = renderIn(<ProgramBinary />);

    await pick(container, file);

    expect(mocks.report).toHaveBeenCalledWith(failure);
    expect(screen.queryByText("program.so")).toBeNull();
  });
});

describe("program id settings", () => {
  it("reports a keypair file that is not a keypair", async () => {
    const { container } = renderIn(<ProgramID />);

    await pick(container, new File(["[1, 2, 3]"], "keypair.json"));

    expect(mocks.report).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Invalid keypair" })
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
