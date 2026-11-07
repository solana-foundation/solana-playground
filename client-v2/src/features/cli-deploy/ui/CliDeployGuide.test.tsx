// The CLI deploy guide, connected: the cluster it opens on, the commands per
// tool and cluster, and the events of opening and copying.
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import { TooltipProvider } from "@/shared/ui/tooltip";

vi.mock("@/utils", () => ({
  PgExplorer: { currentWorkspaceName: "hello" },
  PgProgramInfo: {
    onDidChangeIdl: "idl",
    onDidChangeUuid: () => ({ dispose: () => undefined }),
    uuid: "u",
  },
  PgServer: { deploy: vi.fn() },
}));
// The IDL Playground holds; a test without one sets it to `null`
let idl: { name: string; instructions: unknown[] } | null;
vi.mock("@/hooks", () => ({
  useRenderOnChange: () => idl,
}));

import type { CliDeployGuideProps } from "./CliDeployGuide";
import CliDeployGuide from "./CliDeployGuide";

const PROGRAM_ID = "6PNd3SLJU8V6mqVmDNaV6x2UR6A8ZedA3p5FPrBjAVkj";

let sent: ReturnType<typeof memoryProvider>;
beforeEach(() => {
  // The segmented controls measure their thumb; jsdom has no observer
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  idl = { name: "hello_anchor", instructions: [] };
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
  // Defined, not assigned: user-event leaves a getter-only clipboard behind
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  });
});
afterEach(() => {
  resetTelemetry();
  vi.unstubAllGlobals();
});

const props = (p: {
  from: CliDeployGuideProps["from"];
  cluster: string | undefined;
  built: boolean;
}): CliDeployGuideProps => ({
  from: p.from,
  onClose: vi.fn(),
  cluster: p.cluster,
  built: p.built,
  programId: PROGRAM_ID,
});

const renderGuide = (ui: ReactElement) =>
  render(<TooltipProvider>{ui}</TooltipProvider>);

/** The command lines of the step titled `title` */
const linesOf = (title: string) =>
  Array.from(
    screen
      .getByRole("heading", { name: title })
      .closest("li")
      ?.querySelectorAll('[data-slot="code-block-line"]') ?? []
  ).map((line) => line.textContent);

const commands = () => linesOf("3. Run the deploy");
const idlLines = () => linesOf("3.1 Upload the IDL");

const PMP = "npx @solana-program/program-metadata@latest write idl";

const pick = (name: string) =>
  fireEvent.click(screen.getByRole("radio", { name }));

describe("features/cli-deploy/ui/CliDeployGuide", () => {
  it("opens on the current cluster with the Solana CLI command", () => {
    renderGuide(
      <CliDeployGuide
        {...props({ from: "deploy-stage", cluster: "devnet", built: true })}
      />
    );

    expect(
      screen.getByRole("dialog", { name: "Deploy from your machine" })
    ).toBeTruthy();
    expect(commands()).toEqual([
      "solana program deploy hello_anchor.so --program-id hello_anchor-keypair.json --url devnet",
    ]);
    expect(screen.getByText(PROGRAM_ID)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download .so" })).toBeTruthy();
    expect(sent.events).toEqual([
      expect.objectContaining({
        name: "cli_guide_opened",
        params: { from: "deploy-stage" },
      }),
    ]);
  });

  it("opens on Mainnet from the mainnet warning", () => {
    renderGuide(
      <CliDeployGuide
        {...props({ from: "mainnet-warning", cluster: "devnet", built: true })}
      />
    );

    expect(commands()[0]).toContain("--url mainnet-beta");
  });

  it("opens on Devnet from a cluster it has no line for", () => {
    renderGuide(
      <CliDeployGuide
        {...props({ from: "deploy-stage", cluster: "localnet", built: true })}
      />
    );

    expect(commands()[0]).toContain("--url devnet");
  });

  it("offers Mainnet, Devnet and Testnet, and opens on Playground's Testnet", () => {
    renderGuide(
      <CliDeployGuide
        {...props({ from: "deploy-stage", cluster: "testnet", built: true })}
      />
    );

    expect(
      screen
        .getAllByRole("radio")
        .map((r) => r.textContent)
        .filter((t) => ["Mainnet", "Devnet", "Testnet"].includes(t ?? ""))
    ).toEqual(["Mainnet", "Devnet", "Testnet"]);
    expect(commands()[0]).toContain("--url testnet");
  });

  it("gives Anchor's commands for the picked cluster", () => {
    renderGuide(
      <CliDeployGuide
        {...props({ from: "deploy-stage", cluster: "devnet", built: true })}
      />
    );
    pick("Anchor");
    pick("Mainnet");

    expect(commands()).toEqual([
      "mkdir -p target/deploy && cp hello_anchor.so hello_anchor-keypair.json target/deploy/",
      "anchor deploy --provider.cluster mainnet",
    ]);
  });

  it("opens again on the opening cluster, keeping the tool", () => {
    const { rerender } = renderGuide(
      <CliDeployGuide
        {...props({ from: "deploy-stage", cluster: "devnet", built: true })}
      />
    );
    pick("Anchor");
    pick("Mainnet");
    const again = (from: CliDeployGuideProps["from"]) =>
      rerender(
        <TooltipProvider>
          <CliDeployGuide
            {...props({ from, cluster: "devnet", built: true })}
          />
        </TooltipProvider>
      );
    again(undefined);
    again("deploy-stage");

    expect(commands()[1]).toBe("anchor deploy --provider.cluster devnet");
    expect(
      sent.events.filter((e) => e.name === "cli_guide_opened")
    ).toHaveLength(2);
  });

  it("keeps the user's cluster when Playground's changes while open", () => {
    const { rerender } = renderGuide(
      <CliDeployGuide
        {...props({ from: "deploy-stage", cluster: "devnet", built: true })}
      />
    );
    pick("Mainnet");
    rerender(
      <TooltipProvider>
        <CliDeployGuide
          {...props({ from: "deploy-stage", cluster: "localnet", built: true })}
        />
      </TooltipProvider>
    );

    expect(commands()[0]).toContain("--url mainnet-beta");
  });

  it("offers no download before a build succeeded", () => {
    renderGuide(
      <CliDeployGuide
        {...props({ from: "deploy-stage", cluster: "devnet", built: false })}
      />
    );

    expect(screen.queryByRole("button", { name: "Download .so" })).toBeNull();
    expect(
      screen.getByText("Build successfully first to download the program.")
    ).toBeTruthy();
    // A loaded IDL needs no build, and step 3.1 names the file it saves
    expect(screen.getByRole("button", { name: "Download IDL" })).toBeTruthy();
  });

  it("names the printed id for a deploy without the project's keypair", () => {
    renderGuide(
      <CliDeployGuide
        {...props({ from: "deploy-stage", cluster: "devnet", built: true })}
      />
    );

    expect(
      screen.getByText(/a deploy without the project's keypair/i).textContent
    ).toContain("the program id it printed");
  });

  it("leaves the program id to fill in when the project has none", () => {
    renderGuide(
      <CliDeployGuide
        from="deploy-stage"
        onClose={vi.fn()}
        cluster="devnet"
        built
        programId={undefined}
      />
    );

    expect(idlLines()).toEqual([
      `${PMP} <program-id> hello_anchor.json --rpc https://api.devnet.solana.com`,
    ]);
    expect(
      screen.getByText(/Put the program id the deploy printed/)
    ).toBeTruthy();
  });

  it("counts a copy with its tool and cluster", async () => {
    renderGuide(
      <CliDeployGuide
        {...props({ from: "deploy-stage", cluster: "devnet", built: true })}
      />
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Copy the deploy command" })
      );
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "solana program deploy hello_anchor.so --program-id hello_anchor-keypair.json --url devnet"
    );
    expect(sent.events.map((e) => e.name)).toEqual([
      "cli_guide_opened",
      "cli_command_copied",
    ]);
    expect(sent.events[1].params).toEqual({
      tool: "solana",
      cluster: "devnet",
      step: "deploy",
    });
  });

  it("copies Anchor's two lines as one script", async () => {
    renderGuide(
      <CliDeployGuide
        {...props({ from: "mainnet-warning", cluster: "devnet", built: true })}
      />
    );
    pick("Anchor");
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Copy the deploy command" })
      );
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "mkdir -p target/deploy && cp hello_anchor.so hello_anchor-keypair.json target/deploy/\nanchor deploy --provider.cluster mainnet"
    );
    expect(sent.events[1].params).toEqual({
      tool: "anchor",
      cluster: "mainnet",
      step: "deploy",
    });
  });

  it("gives the Program Metadata IDL upload for the picked cluster", () => {
    renderGuide(
      <CliDeployGuide
        {...props({ from: "mainnet-warning", cluster: "devnet", built: true })}
      />
    );

    expect(idlLines()).toEqual([
      `${PMP} ${PROGRAM_ID} hello_anchor.json --rpc https://api.mainnet-beta.solana.com`,
    ]);
  });

  it("adds anchor idl init below Program Metadata for Anchor", () => {
    renderGuide(
      <CliDeployGuide
        {...props({ from: "deploy-stage", cluster: "devnet", built: true })}
      />
    );
    pick("Anchor");

    expect(idlLines()).toEqual([
      `${PMP} ${PROGRAM_ID} hello_anchor.json --rpc https://api.devnet.solana.com`,
      `anchor idl init -f hello_anchor.json ${PROGRAM_ID} --provider.cluster devnet`,
    ]);
  });

  it("counts a copy of the IDL upload as step idl", async () => {
    renderGuide(
      <CliDeployGuide
        {...props({ from: "deploy-stage", cluster: "devnet", built: true })}
      />
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Copy the IDL upload command" })
      );
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      `${PMP} ${PROGRAM_ID} hello_anchor.json --rpc https://api.devnet.solana.com`
    );
    expect(sent.events[1].params).toEqual({
      tool: "solana",
      cluster: "devnet",
      step: "idl",
    });
  });

  it("counts a copy of Anchor's IDL command as step idl", async () => {
    renderGuide(
      <CliDeployGuide
        {...props({ from: "deploy-stage", cluster: "devnet", built: true })}
      />
    );
    pick("Anchor");
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Copy the Anchor IDL command" })
      );
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      `anchor idl init -f hello_anchor.json ${PROGRAM_ID} --provider.cluster devnet`
    );
    expect(sent.events[1].params).toEqual({
      tool: "anchor",
      cluster: "devnet",
      step: "idl",
    });
  });

  it("counts no IDL download when the browser refuses the file", () => {
    vi.stubGlobal("URL", {
      createObjectURL: () => {
        throw new Error("blocked");
      },
      revokeObjectURL: vi.fn(),
    });
    renderGuide(
      <CliDeployGuide
        {...props({ from: "deploy-stage", cluster: "devnet", built: true })}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Download IDL" }));

    expect(sent.events.map((e) => e.name)).not.toContain("cli_idl_downloaded");
  });

  it("offers Download IDL beside Download .so and saves <program>.json", async () => {
    const createObjectURL = vi.fn(() => "blob:idl");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe("hello_anchor.json");
      });
    renderGuide(
      <CliDeployGuide
        {...props({ from: "deploy-stage", cluster: "devnet", built: true })}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Download IDL" }));

    expect(click).toHaveBeenCalledTimes(1);
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0];
    expect(blob.type).toBe("application/json");
    expect(JSON.parse(await blob.text())).toEqual({
      name: "hello_anchor",
      instructions: [],
    });
    expect(sent.events.map((e) => e.name)).toContain("cli_idl_downloaded");
    click.mockRestore();
  });

  it("offers no IDL upload and no IDL download without an IDL", async () => {
    // eslint-disable-next-line unicorn/no-null -- the hook's value with no IDL
    idl = null;
    renderGuide(
      <CliDeployGuide
        {...props({ from: "deploy-stage", cluster: "devnet", built: true })}
      />
    );

    expect(idlLines()).toEqual([]);
    expect(screen.getByText("This program has no IDL to upload.")).toBeTruthy();
    // Off but focusable, so its title still reaches keyboard users
    const download = screen.getByRole("button", { name: "Download IDL" });
    expect(download.getAttribute("aria-disabled")).toBe("true");
    expect((download as HTMLButtonElement).disabled).toBe(false);
    expect(download.getAttribute("aria-describedby")).toBe(
      screen.getByText("This program has no IDL to upload.").id
    );
    // Neither a press nor the keys a button answers save anything
    const user = userEvent.setup();
    await user.click(download);
    download.focus();
    expect(document.activeElement).toBe(download);
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(sent.events.map((e) => e.name)).not.toContain("cli_idl_downloaded");
  });

  it("renders nothing while closed", () => {
    renderGuide(
      <CliDeployGuide
        {...props({ from: undefined, cluster: "devnet", built: true })}
      />
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sent.events).toEqual([]);
  });
});
