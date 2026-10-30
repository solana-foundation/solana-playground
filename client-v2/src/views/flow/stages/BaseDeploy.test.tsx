// The Deploy stage drawn from props: the empty stage before a deployment,
// the result block after one, and the one brand action at the end.
import {
  fireEvent,
  render as rtlRender,
  screen,
  within,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shared/ui/tooltip";
import BaseDeploy from "./BaseDeploy";
import type {
  BaseDeployProps,
  DeployDetails,
  DeployStatus,
} from "./BaseDeploy";
import type { DeployRecord } from "../state/deploy-history";
import type { DeployRunState } from "@/commands/deploy/run";

const PROGRAM_ID = "6PNd3SLJU8V6mqVmDNaV6x2UR6A8ZedA3p5FPrBjAVkj";

const SHORT_ID = "6PNd…AVkj";
const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

const record = (
  id: string,
  signature: string | null,
  cluster = "devnet"
): DeployRecord => ({
  id,
  workspace: "counter",
  cluster,
  programId: PROGRAM_ID,
  signature,
  at: Date.UTC(2026, 9, 15),
});

const IDLE_RUN: DeployRunState = {
  step: null,
  percent: 0,
  funds: false,
  upgrade: false,
};

const NO_DETAILS: DeployDetails = {
  upgradable: null,
  authority: null,
  programSize: null,
};

/** Every prop, named; each test passes what it is about */
const props = (state: {
  built: boolean;
  deploy: DeployStatus;
  history: DeployRecord[];
  details?: DeployDetails;
  /** devnet unless the test is about the cluster */
  cluster?: string | null;
  onOpenCliGuide?: BaseDeployProps["onOpenCliGuide"];
  run?: DeployRunState;
  funding?: BaseDeployProps["funding"];
  backup?: boolean;
  payer?: BaseDeployProps["payer"];
}): BaseDeployProps => ({
  cluster: state.cluster === undefined ? "devnet" : state.cluster,
  built: state.built,
  deploy: state.deploy,
  programId: PROGRAM_ID,
  details: state.details ?? NO_DETAILS,
  history: state.history,
  payer:
    state.payer === undefined
      ? { address: WALLET, balance: 4.2, playground: true }
      : state.payer,
  run: state.run ?? IDLE_RUN,
  funding: state.funding ?? null,
  backup: state.backup ?? false,
  staleBuild: false,
  addressUrl: (id, cluster) => `https://explorer.test/${cluster}/address/${id}`,
  txUrl: (sig, cluster) => `https://explorer.test/${cluster}/tx/${sig}`,
  onDeploy: vi.fn(),
  onSignIn: vi.fn(),
  onSaveKeypair: vi.fn(),
  onDismissBackup: vi.fn(),
  onStaleBuildAnswer: vi.fn(),
  onInteract: vi.fn(),
  idlUpload: <button>Upload IDL</button>,
  onOpenCliGuide: state.onOpenCliGuide ?? vi.fn(),
});

/** The app gives every screen a tooltip provider; the copy button needs one */
const withTooltips = (ui: ReactElement) => (
  <TooltipProvider>{ui}</TooltipProvider>
);
const render = (ui: ReactElement) => {
  const result = rtlRender(withTooltips(ui));
  return {
    container: result.container,
    rerender: (next: ReactElement) => result.rerender(withTooltips(next)),
  };
};

const brandButtons = (container: HTMLElement) =>
  container.querySelectorAll('[data-slot="brand-button"]');

const lastIsActions = (container: HTMLElement) =>
  container
    .querySelector('[data-slot="stage-empty"]')
    ?.lastElementChild?.getAttribute("data-slot");

const mainnetWarning = () =>
  screen.queryByRole("alert", { name: "Mainnet deploy warning" });

describe("BaseDeploy", () => {
  it("warns on mainnet without holding Deploy", () => {
    const { container } = render(
      <BaseDeploy
        {...props({
          built: true,
          deploy: "idle",
          history: [],
          cluster: "mainnet-beta",
        })}
      />
    );

    const warning = mainnetWarning();
    expect(warning?.textContent).toContain("Mainnet uses real SOL");
    expect(warning?.textContent).toContain("Playground wallet");
    expect(warning?.textContent).toContain("your own machine");
    const deploy = screen.getByRole("button", {
      name: "Deploy to mainnet",
    });
    expect(deploy).toHaveProperty("disabled", false);
    expect(lastIsActions(container)).toBe("stage-empty-actions");
  });

  it("opens the CLI guide from the warning's own words", () => {
    const onOpenCliGuide = vi.fn();
    render(
      <BaseDeploy
        {...props({
          built: true,
          deploy: "idle",
          history: [],
          cluster: "mainnet-beta",
          onOpenCliGuide,
        })}
      />
    );

    const warning = mainnetWarning()!;
    expect(warning.textContent).toContain(
      "For a program that matters, deploy from your own machine with the Solana CLI or Anchor."
    );
    fireEvent.click(
      within(warning).getByRole("button", {
        name: "deploy from your own machine",
      })
    );
    expect(onOpenCliGuide).toHaveBeenCalledWith("mainnet-warning");
  });

  it.each(["devnet", "mainnet-beta"])(
    "offers the CLI guide beside Deploy on %s",
    (cluster) => {
      const onOpenCliGuide = vi.fn();
      render(
        <BaseDeploy
          {...props({
            built: false,
            deploy: "idle",
            history: [],
            cluster,
            onOpenCliGuide,
          })}
        />
      );

      fireEvent.click(
        screen.getByRole("button", { name: "Deploy with the CLI" })
      );
      expect(onOpenCliGuide).toHaveBeenCalledWith("deploy-stage");
    }
  );

  it("warns on mainnet before a build too", () => {
    render(
      <BaseDeploy
        {...props({
          built: false,
          deploy: "idle",
          history: [],
          cluster: "mainnet-beta",
        })}
      />
    );

    expect(mainnetWarning()).toBeTruthy();
  });

  it("keeps the warning beside a failed deploy's alert", () => {
    render(
      <BaseDeploy
        {...props({
          built: true,
          deploy: "failed",
          history: [record("a", null)],
          cluster: "mainnet-beta",
        })}
      />
    );

    expect(mainnetWarning()).toBeTruthy();
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });

  it.each(["devnet", null])("does not warn on %s", (cluster) => {
    render(
      <BaseDeploy
        {...props({ built: true, deploy: "idle", history: [], cluster })}
      />
    );

    expect(mainnetWarning()).toBeNull();
  });

  it("holds Deploy until a build succeeded", () => {
    const { container } = render(
      <BaseDeploy {...props({ built: false, deploy: "idle", history: [] })} />
    );

    expect(
      screen.getByRole("heading", { name: "Nothing deployed yet" })
    ).toBeTruthy();
    const deploy = screen.getByRole("button", { name: "Deploy to devnet" });
    expect(deploy).toHaveProperty("disabled", true);
    expect(deploy.getAttribute("title")).toBe("Build successfully first");
    expect(lastIsActions(container)).toBe("stage-empty-actions");
  });

  it("deploys a built program and names its id", () => {
    const p = props({ built: true, deploy: "idle", history: [] });
    const { container } = render(<BaseDeploy {...p} />);

    fireEvent.click(screen.getByRole("button", { name: "Deploy to devnet" }));
    expect(p.onDeploy).toHaveBeenCalled();
    expect(screen.getByText(PROGRAM_ID)).toBeTruthy();
    expect(brandButtons(container)).toHaveLength(1);
  });

  it("holds the button while a first deploy runs", () => {
    render(
      <BaseDeploy {...props({ built: true, deploy: "running", history: [] })} />
    );

    const busy = screen.getByRole("button", { name: "Deploying..." });
    expect(busy).toHaveProperty("disabled", true);
    expect(busy.getAttribute("aria-busy")).toBe("true");
  });

  it("calls a deploy over an earlier one an upgrade", () => {
    render(
      <BaseDeploy
        {...props({
          built: true,
          deploy: "running",
          history: [record("a", null)],
        })}
      />
    );

    expect(screen.getByRole("button", { name: "Upgrading..." })).toBeTruthy();
  });

  it("says a failed deploy failed", () => {
    render(
      <BaseDeploy {...props({ built: true, deploy: "failed", history: [] })} />
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Deploy failed - see the console."
    );
  });

  it("shows the latest deployment's program id to copy", () => {
    const p = props({
      built: true,
      deploy: "idle",
      history: [record("a", "5sig")],
    });
    const { container } = render(<BaseDeploy {...p} />);

    const result = screen.getByRole("status", { name: "Deploy result" });
    expect(result.textContent).toContain("Deployed to devnet");
    expect(result.querySelector("code")?.textContent).toBe(SHORT_ID);
    expect(result.querySelector('[data-slot="copy-button"]')).toBeTruthy();
    const explorer = within(result).getByRole("link", {
      name: `View latest deployment (${PROGRAM_ID}) on Explorer (devnet)`,
    });
    expect(explorer.textContent).toBe("View on Explorer (devnet)");
    expect(explorer.getAttribute("href")).toBe(
      `https://explorer.test/devnet/address/${PROGRAM_ID}`
    );
    expect(
      within(result).getByRole("link", {
        name: "View latest deployment transaction (5sig) on Explorer (devnet)",
      }).textContent
    ).toBe("Transaction (devnet)");

    fireEvent.click(within(result).getByRole("button", { name: "Interact" }));
    expect(p.onInteract).toHaveBeenCalled();

    expect(brandButtons(container)).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Redeploy to devnet" })
    ).toBeTruthy();
    expect(lastIsActions(container)).toBe("stage-empty-actions");
  });

  it("shows on-chain details only when they are known", () => {
    const { rerender } = render(
      <BaseDeploy
        {...props({
          built: true,
          deploy: "idle",
          history: [record("a", null)],
        })}
      />
    );
    expect(screen.queryByText("Upgradable")).toBeNull();
    expect(screen.queryByText("Authority")).toBeNull();

    rerender(
      <BaseDeploy
        {...props({
          built: true,
          deploy: "idle",
          history: [record("a", null)],
          details: {
            upgradable: true,
            authority: "Auth111",
            programSize: 2048,
          },
        })}
      />
    );
    expect(screen.getByText("Upgradable")).toBeTruthy();
    expect(screen.getByText("Auth111")).toBeTruthy();
    expect(screen.getByText("2,048 bytes")).toBeTruthy();
  });

  it("lists every deployment in the history", () => {
    render(
      <BaseDeploy
        {...props({
          built: true,
          deploy: "idle",
          history: [record("a", null), record("b", null)],
        })}
      />
    );

    const history = screen.getByRole("region", { name: "History" });
    expect(
      within(history).getAllByRole("link", {
        name: `View deployment (${PROGRAM_ID}) on Explorer (devnet)`,
      })
    ).toHaveLength(2);
  });

  it("opens each history record on its own network, whatever is picked now", () => {
    render(
      <BaseDeploy
        {...props({
          built: true,
          deploy: "idle",
          cluster: "testnet",
          history: [record("a", null, "testnet"), record("b", null, "devnet")],
        })}
      />
    );

    const history = screen.getByRole("region", { name: "History" });
    const links = within(history).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      "Explorer (testnet)",
      "Explorer (devnet)",
    ]);
    expect(links[1].getAttribute("href")).toBe(
      `https://explorer.test/devnet/address/${PROGRAM_ID}`
    );
  });

  it("leaves out an Explorer link the explorer cannot open", () => {
    const p = props({
      built: true,
      deploy: "idle",
      history: [record("a", "5sig", "playnet")],
    });
    p.addressUrl = () => null;
    p.txUrl = () => null;
    render(<BaseDeploy {...p} />);

    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("says an upgrade kept the program id, and what the deploy cost", () => {
    const upgraded: DeployRecord = {
      id: "a",
      workspace: "counter",
      cluster: "devnet",
      programId: PROGRAM_ID,
      signature: null,
      at: Date.UTC(2026, 9, 15),
      cost: 1_420_000_000,
      upgraded: true,
    };
    render(
      <BaseDeploy
        {...props({ built: true, deploy: "idle", history: [upgraded] })}
      />
    );

    const result = screen.getByRole("status", { name: "Deploy result" });
    expect(result.textContent).toContain(
      "Upgraded. The program id stays the same."
    );
    expect(result.textContent).toContain("1.42 SOL");
  });

  it("names the wallet that pays, or says one is created on the first deploy", () => {
    const { rerender } = render(
      <BaseDeploy {...props({ built: true, deploy: "idle", history: [] })} />
    );
    expect(screen.getByLabelText("Who pays").textContent).toBe(
      "Deploys from your Playground wallet · 7xKX…gAsU · 4.20 SOL"
    );

    rerender(
      <BaseDeploy
        {...props({ built: true, deploy: "idle", history: [], payer: null })}
      />
    );
    expect(screen.getByLabelText("Who pays").textContent).toBe(
      "Deploys from a Playground wallet created on your first deploy."
    );
    expect(
      screen.getByRole("button", { name: "Deploy to devnet" })
    ).toHaveProperty("disabled", false);
  });

  it("shows the run's steps while it deploys", () => {
    render(
      <BaseDeploy
        {...props({
          built: true,
          deploy: "running",
          history: [],
          run: { step: "write", percent: 40, funds: true, upgrade: false },
        })}
      />
    );

    expect(
      screen.getByRole("status", { name: "Deploy progress" }).textContent
    ).toContain("Writing program, 40%");
    expect(screen.queryByLabelText("Who pays")).toBeNull();
  });

  it("shows why the wallet could not be funded, not a console failure", () => {
    const p = props({
      built: true,
      deploy: "failed",
      history: [],
      funding: {
        reason: "airdrop_failed",
        balance: 0,
        needed: 1_000_000_000,
        address: WALLET,
        cause: "429",
      },
    });
    render(<BaseDeploy {...p} />);

    const card = screen.getByRole("alert", { name: "Not enough SOL" });
    expect(card.textContent).toContain("Not enough devnet SOL");
    expect(screen.queryByText("Deploy failed - see the console.")).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Try again" }));
    expect(p.onDeploy).toHaveBeenCalledOnce();
  });

  it("offers the keypair backup under the result when asked to", () => {
    const p = props({
      built: true,
      deploy: "idle",
      history: [record("a", null)],
      backup: true,
    });
    render(<BaseDeploy {...p} />);

    const line = screen.getByLabelText("Keypair backup");
    fireEvent.click(within(line).getByRole("button", { name: "Save keypair" }));
    expect(p.onSaveKeypair).toHaveBeenCalledOnce();
  });

  /** The prototype's first deploy: the pill, Upload IDL and the CLI guide under it */
  it("before the first deploy it has no history, only Upload IDL and the CLI guide", () => {
    const { container } = render(
      <BaseDeploy {...props({ built: true, deploy: "idle", history: [] })} />
    );

    expect(screen.queryByRole("region", { name: "History" })).toBeNull();
    const actions = container.querySelector<HTMLElement>(
      '[data-slot="stage-empty-actions"]'
    )!;
    const labels = [...actions.querySelectorAll("button")].map(
      (b) => b.textContent
    );
    expect(labels).toEqual([
      "Deploy to devnet",
      "Upload IDL",
      "Deploy with the CLI",
    ]);
  });

  /** After a deploy the stage reports: the history, and Upload IDL beside the pill */
  it("after a deploy it shows the history and keeps Upload IDL", () => {
    const { container } = render(
      <BaseDeploy
        {...props({
          built: true,
          deploy: "idle",
          history: [record("a", null)],
        })}
      />
    );

    expect(screen.getByRole("region", { name: "History" })).toBeTruthy();
    const actions = container.querySelector<HTMLElement>(
      '[data-slot="stage-empty-actions"]'
    )!;
    expect(
      within(actions).getByRole("button", { name: "Upload IDL" })
    ).toBeTruthy();
  });

  it("writes a dash, not two hyphens", () => {
    render(
      <BaseDeploy {...props({ built: false, deploy: "idle", history: [] })} />
    );

    expect(
      screen.getByText(
        "Build the program first \u2014 the stepper unlocks Deploy once it compiles cleanly."
      )
    ).toBeTruthy();
  });

  it("says nothing deployed once", () => {
    render(
      <BaseDeploy {...props({ built: true, deploy: "idle", history: [] })} />
    );

    expect(screen.getAllByText(/Nothing deployed yet/)).toHaveLength(1);
  });

  /** Redeploy is the screen's accent; Interact is a quiet next step */
  it("keeps Interact quiet beside the brand Deploy", () => {
    render(
      <BaseDeploy
        {...props({
          built: true,
          deploy: "idle",
          history: [record("a", null)],
        })}
      />
    );

    expect(
      screen
        .getByRole("button", { name: "Interact" })
        .getAttribute("data-variant")
    ).toBe("outline");
  });
});
