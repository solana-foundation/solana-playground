// The CLI deploy guide, connected: the cluster it opens on, the commands per
// tool and cluster, and the events of opening and copying.
import { act, fireEvent, render, screen } from "@testing-library/react";
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
vi.mock("@/hooks", () => ({
  useRenderOnChange: () => ({ name: "hello_anchor", instructions: [] }),
}));

import CliDeployGuide from "./CliDeployGuide";
import type { CliDeployGuideProps } from "./CliDeployGuide";

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
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn(async () => undefined) },
  });
});
afterEach(() => {
  resetTelemetry();
  vi.unstubAllGlobals();
});

const props = (p: {
  from: CliDeployGuideProps["from"];
  cluster: string | null;
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

const commands = () =>
  Array.from(document.querySelectorAll('[data-slot="code-block-line"]')).map(
    (line) => line.textContent
  );

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
    again(null);
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
    expect(screen.getByText("Build successfully first.")).toBeTruthy();
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
    });
  });

  it("renders nothing while closed", () => {
    renderGuide(
      <CliDeployGuide
        {...props({ from: null, cluster: "devnet", built: true })}
      />
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sent.events).toEqual([]);
  });
});
