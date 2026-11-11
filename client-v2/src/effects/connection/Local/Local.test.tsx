import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PgCommon, PgConnection, PgView } from "../../../utils";
import { Local } from "./Local";

// The utils barrel needs build-time globals the unit runner does not define.
vi.mock("../../../utils", () => ({
  PgCommon: {
    getOS: vi.fn(() => "MacOS"),
    getBrowser: vi.fn(() => "Chrome"),
  },
  PgConnection: {
    onDidChangeIsConnected: vi.fn(() => ({ dispose: () => {} })),
  },
  PgView: { closeModal: vi.fn() },
}));

// The frame is the overlay system's; what is under test is the body.
vi.mock("@/widgets/overlays", () => ({
  ModalFrame: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  useModalId: () => "localnet",
}));

// The markdown renderer pulls the editor's theme; the steps' text is enough.
vi.mock("../../../components/Markdown", () => ({
  default: ({ children }: { children: string }) => <pre>{children}</pre>,
}));

beforeEach(() => {
  vi.mocked(PgCommon.getOS).mockReturnValue("MacOS");
  vi.mocked(PgCommon.getBrowser).mockReturnValue("Chrome");
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("Connect to Localnet", () => {
  it("closes itself once Localnet connects", () => {
    render(<Local />);
    const [onChange] = vi.mocked(PgConnection.onDidChangeIsConnected).mock
      .calls[0] as unknown as [(isConnected: boolean) => void];
    onChange(true);

    expect(PgView.closeModal).toHaveBeenCalledExactlyOnceWith(
      undefined,
      "localnet"
    );
  });

  it("starts a validator that accepts Playground's programs", () => {
    render(<Local />);

    // Agave 4.x turns SIMD-0500 on at genesis and refuses the SBPF v0
    // programs the build server makes, so the plain command never deploys.
    expect(
      screen.queryByText(
        /solana-test-validator --deactivate-feature B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g/
      )
    ).not.toBeNull();
  });

  it("gives Surfpool's own steps when Surfpool is the network picked", () => {
    render(<Local surfpool />);

    expect(screen.queryByText("Unable to connect to Surfpool")).not.toBeNull();
    expect(screen.queryByText(/surfpool start/)).not.toBeNull();
    expect(screen.queryByText(/solana-test-validator/)).toBeNull();
  });

  it("shows the browser-blocking note without an accordion", () => {
    render(<Local />);

    expect(screen.queryByText("Having issues?")).toBeNull();
    expect(
      screen.queryByText(/your browser is\s+blocking localhost access/)
    ).not.toBeNull();
    expect(screen.queryByText("Brave Browser")).toBeNull();
  });

  it("shows the Brave step under the note in Brave", () => {
    vi.mocked(PgCommon.getBrowser).mockReturnValue("Brave");
    render(<Local />);

    expect(screen.queryByText("Brave Browser")).not.toBeNull();
  });

  it("leaves the note out in Firefox", () => {
    vi.mocked(PgCommon.getBrowser).mockReturnValue("Firefox");
    render(<Local />);

    expect(screen.queryByText(/blocking localhost access/)).toBeNull();
  });

  it.each<[ReturnType<typeof PgCommon.getOS>, string]>([
    ["MacOS", "Install Solana toolchain (macOS)"],
    ["Windows", "Install Solana toolchain (Windows)"],
    ["Linux", "Install Solana toolchain (Linux)"],
    [undefined, "Install Solana toolchain (Other)"],
  ])("names the toolchain step for %s", (os, step) => {
    vi.mocked(PgCommon.getOS).mockReturnValue(os);
    render(<Local />);

    expect(screen.getByText(/Install Solana toolchain/).textContent).toContain(
      step
    );
  });
});
