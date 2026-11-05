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

import type { DeployRunState } from "@/commands/deploy/run";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { requireFor } from "@/test-utils/require-for";

import type { DeployRecord } from "../state/deploy-history";
import type {
  BaseDeployProps,
  DeployDetails,
  DeployStatus,
} from "./BaseDeploy";
import BaseDeploy from "./BaseDeploy";

const PROGRAM_ID = "6PNd3SLJU8V6mqVmDNaV6x2UR6A8ZedA3p5FPrBjAVkj";

const SHORT_ID = "6PNd…AVkj";
const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

// eslint-disable-next-line unicorn/no-null -- a stored record writes an absent signature as null
const NONE = null;

const recordFor =
  (cluster: string) =>
  (id: string, signature: string | null): DeployRecord => ({
    id,
    workspace: "counter",
    cluster,
    programId: PROGRAM_ID,
    signature,
    at: Date.UTC(2026, 9, 15),
  });
const record = recordFor("devnet");

const IDLE_RUN: DeployRunState = {
  // eslint-disable-next-line unicorn/no-null -- `DeployRunState.step` is `null` while no deploy runs
  step: null,
  percent: 0,
  funds: false,
  upgrade: false,
};

const NO_DETAILS: DeployDetails = {
  upgradable: undefined,
  authority: undefined,
  programSize: undefined,
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
  details: state.details ?? NO_DETAILS,
  history: state.history,
  payer:
    "payer" in state
      ? state.payer
      : { address: WALLET, balance: 4.2, playground: true },
  run: state.run ?? IDLE_RUN,
  funding: state.funding,
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
  onGoToBuild: vi.fn(),
  onShowLog: vi.fn(),
  onChangeNetwork: vi.fn(),
  isNetworkOffered: (cluster) => cluster === "devnet" || cluster === "testnet",
  onShowNetwork: vi.fn(),
  idlName: undefined,
  idlUpload: <button>Upload IDL</button>,
  programKeypair: <section aria-label="Program id" />,
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
  it("places the Program id block under the payer line before a deploy", () => {
    render(
      <BaseDeploy {...props({ built: true, deploy: "idle", history: [] })} />
    );

    const payer = screen.getByLabelText("Who pays");
    const block = screen.getByRole("region", { name: "Program id" });
    expect(
      payer.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("places the Program id block under the history after a deploy", () => {
    render(
      <BaseDeploy
        {...props({
          built: true,
          deploy: "idle",
          history: [record("r1", "sig1")],
        })}
      />
    );

    const history = screen.getByRole("region", { name: "History" });
    const block = screen.getByRole("region", { name: "Program id" });
    expect(
      history.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(history.contains(block)).toBe(false);
  });

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

    const warning = screen.getByRole("alert", {
      name: "Mainnet deploy warning",
    });
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
          history: [record("a", NONE)],
          cluster: "mainnet-beta",
        })}
      />
    );

    expect(mainnetWarning()).toBeTruthy();
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });

  // eslint-disable-next-line unicorn/no-null -- `BaseDeployProps.cluster` is `null` until the endpoint has been read
  it.each(["devnet", null])("does not warn on %s", (cluster) => {
    render(
      <BaseDeploy
        {...props({ built: true, deploy: "idle", history: [], cluster })}
      />
    );

    expect(mainnetWarning()).toBeNull();
  });

  it("offers no Deploy until a build succeeded", () => {
    const { container } = render(
      <BaseDeploy {...props({ built: false, deploy: "idle", history: [] })} />
    );

    expect(
      screen.getByRole("heading", { name: "Nothing deployed yet" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Deploy to devnet" })
    ).toBeNull();
    expect(lastIsActions(container)).toBe("stage-empty-actions");
  });

  it("offers Go to Build, with Upload IDL, while nothing is built (Spec 03 DEP-07)", () => {
    const p = props({ built: false, deploy: "idle", history: [] });
    const { container } = render(<BaseDeploy {...p} />);

    expect(screen.getByText("Build the program first.")).toBeTruthy();
    const goToBuild = screen.getByRole("button", { name: "Go to Build" });
    fireEvent.click(goToBuild);
    expect(p.onGoToBuild).toHaveBeenCalled();
    // The pill itself, the only one
    expect(brandButtons(container)).toHaveLength(1);
    expect(brandButtons(container)[0]).toBe(goToBuild);
    // Upload IDL stays beside it, among the outlines
    expect(screen.getByRole("button", { name: "Upload IDL" })).toBeTruthy();
  });

  it("offers no Go to Build once the program is built", () => {
    render(
      <BaseDeploy {...props({ built: true, deploy: "idle", history: [] })} />
    );

    expect(screen.queryByRole("button", { name: "Go to Build" })).toBeNull();
  });

  it("deploys a built program, its id the summary's last row", () => {
    const p = props({ built: true, deploy: "idle", history: [] });
    const { container } = render(<BaseDeploy {...p} />);

    fireEvent.click(screen.getByRole("button", { name: "Deploy to devnet" }));
    expect(p.onDeploy).toHaveBeenCalled();
    // The keypair's row closes the card the network opens
    const network = screen.getByLabelText("Network");
    const row = screen.getByRole("region", { name: "Program id" });
    expect(network.closest(".rounded-xl")).toBe(row.closest(".rounded-xl"));
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
          history: [record("a", NONE)],
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
      "Could not deploy. The full log has the details."
    );
  });

  it("offers Try again and Show full log after a failed deploy (Spec 08 ANY-00)", () => {
    const p = props({
      built: true,
      deploy: "failed",
      history: [record("a", null)],
    });
    const { container } = render(<BaseDeploy {...p} />);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(p.onDeploy).toHaveBeenCalled();
    const showLog = screen.getByRole("button", { name: "Show full log" });
    fireEvent.click(showLog);
    expect(p.onShowLog).toHaveBeenCalled();
    // An outline beside the pill, as Upload IDL is
    expect(showLog.getAttribute("data-variant")).toBe("outline");
    expect(brandButtons(container)).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "Redeploy to devnet" })
    ).toBeNull();
  });

  it("offers no Show full log while no deploy failed", () => {
    render(
      <BaseDeploy {...props({ built: true, deploy: "idle", history: [] })} />
    );

    expect(screen.queryByRole("button", { name: "Show full log" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
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
    expect(
      within(result).getByRole("button", { name: "Copy the program id" })
    ).toBeTruthy();
    const explorer = within(result).getByRole("link", {
      name: `View latest deployment (${PROGRAM_ID}) on Explorer (Devnet)`,
    });
    expect(explorer.textContent).toBe("View on Explorer (Devnet)");
    expect(explorer.getAttribute("href")).toBe(
      `https://explorer.test/devnet/address/${PROGRAM_ID}`
    );
    expect(
      within(result).getByRole("link", {
        name: "View latest deployment transaction (5sig) on Explorer (Devnet)",
      }).textContent
    ).toBe("Transaction (Devnet)");

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
          history: [record("a", NONE)],
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
          history: [record("a", NONE)],
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

  it("shows the empty stage with every network's history on a network with no deployment", () => {
    const { container } = render(
      <BaseDeploy
        {...props({
          built: true,
          deploy: "idle",
          cluster: "mainnet-beta",
          history: [record("a", "5sig")],
        })}
      />
    );

    // No meta line before a deploy here: the summary's Network row names it
    expect(
      container.querySelector('[data-slot="stage-empty-meta"]')
    ).toBeNull();
    expect(screen.getByLabelText("Network").textContent).toBe(
      "NetworkMainnetChange"
    );
    expect(
      screen.getByRole("heading", { name: "Nothing on mainnet" })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Deploy to mainnet" })
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Redeploy/ })).toBeNull();
    expect(screen.queryByRole("status", { name: "Deploy result" })).toBeNull();
    expect(
      screen.getByText(/This project has deploys on devnet\./)
    ).toBeTruthy();
    // The devnet deployment stays in the history, under its own network
    const history = screen.getByRole("region", { name: "History" });
    expect(within(history).getByText("Devnet")).toBeTruthy();
  });

  it("shows the latest deployment on the network picked, not the newest anywhere", () => {
    const { container } = render(
      <BaseDeploy
        {...props({
          built: true,
          deploy: "idle",
          cluster: "testnet",
          history: [
            recordFor("devnet")("d", "devsig"),
            recordFor("testnet")("c", "testsig"),
            recordFor("devnet")("b", NONE),
            recordFor("testnet")("a", NONE),
          ],
        })}
      />
    );

    expect(
      container.querySelector('[data-slot="stage-empty-meta"]')?.textContent
    ).toBe("Testnet · 2 deployments");
    const result = screen.getByRole("status", { name: "Deploy result" });
    expect(result.textContent).toContain("Deployed to testnet");
    expect(
      within(result).getByRole("link", {
        name: "View latest deployment transaction (testsig) on Explorer (Testnet)",
      })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Redeploy to testnet" })
    ).toBeTruthy();
    expect(
      screen.queryByText("Each network keeps its own deployments.")
    ).toBeNull();
  });

  it("calls a first deploy on this network deploying, whatever is on the others", () => {
    render(
      <BaseDeploy
        {...props({
          built: true,
          deploy: "running",
          cluster: "testnet",
          history: [record("a", NONE)],
        })}
      />
    );

    expect(screen.getByRole("button", { name: "Deploying..." })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Upgrading..." })).toBeNull();
  });

  it("does not set the network against the others until it is known", () => {
    render(
      <BaseDeploy
        {...props({
          built: true,
          deploy: "idle",
          // eslint-disable-next-line unicorn/no-null -- the cluster is `null` until the endpoint is read
          cluster: null,
          history: [record("a", NONE)],
        })}
      />
    );

    expect(screen.getByText("Nothing deployed yet")).toBeTruthy();
    expect(
      screen.getByText("Deploying sends the compiled program to the network.")
    ).toBeTruthy();
  });

  it("lists every deployment in the history", () => {
    render(
      <BaseDeploy
        {...props({
          built: true,
          deploy: "idle",
          history: [record("a", NONE), record("b", NONE)],
        })}
      />
    );

    const history = screen.getByRole("region", { name: "History" });
    expect(
      within(history).getAllByRole("link", {
        name: `View deployment (${PROGRAM_ID}) on Explorer (Devnet)`,
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
          history: [
            recordFor("testnet")("a", NONE),
            recordFor("devnet")("b", NONE),
          ],
        })}
      />
    );

    const history = screen.getByRole("region", { name: "History" });
    const links = within(history).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      "Explorer (Testnet)",
      "Explorer (Devnet)",
    ]);
    expect(links[1].getAttribute("href")).toBe(
      `https://explorer.test/devnet/address/${PROGRAM_ID}`
    );
  });

  it("leaves out an Explorer link the explorer cannot open", () => {
    const p = props({
      built: true,
      deploy: "idle",
      history: [recordFor("playnet")("a", "5sig")],
    });
    p.addressUrl = () => undefined;
    p.txUrl = () => undefined;
    render(<BaseDeploy {...p} />);

    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("says an upgrade kept the program id, and what the deploy cost", () => {
    const upgraded: DeployRecord = {
      id: "a",
      workspace: "counter",
      cluster: "devnet",
      programId: PROGRAM_ID,
      signature: NONE,
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

  it("names the wallet that pays, or the Playground wallet before the first deploy", () => {
    const { rerender } = render(
      <BaseDeploy {...props({ built: true, deploy: "idle", history: [] })} />
    );
    expect(screen.getByLabelText("Who pays").textContent).toBe(
      "From your Playground wallet · 7xKX…gAsU · 4.20 SOL"
    );
    expect(screen.getByText(/^Deploying sends/).textContent).toBe(
      "Deploying sends the compiled program to devnet."
    );

    rerender(
      <BaseDeploy
        {...props({
          built: true,
          deploy: "idle",
          history: [],
          payer: { address: WALLET, balance: 4.2, playground: false },
        })}
      />
    );
    expect(screen.getByLabelText("Who pays").textContent).toBe(
      "From your wallet · 7xKX…gAsU · 4.20 SOL"
    );

    rerender(
      <BaseDeploy
        {...props({
          built: true,
          deploy: "idle",
          history: [],
          payer: undefined,
        })}
      />
    );
    expect(screen.getByLabelText("Who pays").textContent).toBe(
      "From your Playground wallet · free devnet SOL"
    );
    expect(
      screen.getByRole("button", { name: "Deploy to devnet" })
    ).toHaveProperty("disabled", false);
  });

  // eslint-disable-next-line unicorn/no-null -- `BaseDeployProps.cluster` is `null` until the endpoint has been read
  it.each(["mainnet-beta", "testnet", null])(
    "promises no free SOL before the first deploy on %s",
    (cluster) => {
      render(
        <BaseDeploy
          {...props({
            built: true,
            deploy: "idle",
            history: [],
            payer: undefined,
            cluster,
          })}
        />
      );
      expect(screen.getByLabelText("Who pays").textContent).toBe(
        "From your Playground wallet"
      );
    }
  );

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
      history: [record("a", NONE)],
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
    // Only the pill is pinned; the two others stay in the page beside it
    const actions = requireFor("the stage's actions")(
      container.querySelector<HTMLElement>('[data-slot="stage-empty-actions"]')
    );
    expect(
      [...actions.querySelectorAll("button")].map((b) => b.textContent)
    ).toEqual(["Deploy to devnet"]);
    expect(screen.getByRole("button", { name: "Upload IDL" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Deploy with the CLI" })
    ).toBeTruthy();
  });

  /** After a deploy the stage reports: the history, and Upload IDL beside the pill */
  it("after a deploy it shows the history and keeps Upload IDL", () => {
    const { container } = render(
      <BaseDeploy
        {...props({
          built: true,
          deploy: "idle",
          history: [record("a", NONE)],
        })}
      />
    );

    expect(screen.getByRole("region", { name: "History" })).toBeTruthy();
    expect(
      container.querySelector('[data-slot="stage-empty-actions"]')
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upload IDL" })).toBeTruthy();
  });

  /** Replacing an IDL after a deploy must not hide which one is loaded */
  it("names the loaded IDL after a deploy too", () => {
    render(
      <BaseDeploy
        {...props({
          built: true,
          deploy: "idle",
          history: [record("a", NONE)],
        })}
        idlName="counter.json"
      />
    );

    expect(screen.getByText("counter.json")).toBeTruthy();
  });

  it("asks for a build in Spec 08's words before one passed", () => {
    render(
      <BaseDeploy {...props({ built: false, deploy: "idle", history: [] })} />
    );

    expect(screen.getByText("Build the program first.")).toBeTruthy();
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
          history: [record("a", NONE)],
        })}
      />
    );

    expect(
      screen
        .getByRole("button", { name: "Interact" })
        .getAttribute("data-variant")
    ).toBe("outline");
  });

  it("offers Go to Build, not Try again, when a failed deploy's build is gone", () => {
    render(
      <BaseDeploy {...props({ built: false, deploy: "failed", history: [] })} />
    );

    expect(screen.getByRole("button", { name: "Go to Build" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show full log" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Deploy to devnet" })
    ).toBeNull();
  });
});

describe("BaseDeploy before a deploy on this network", () => {
  it("changes the network from the summary's Network row", () => {
    const onChangeNetwork = vi.fn();
    render(
      <BaseDeploy
        {...props({ built: true, deploy: "idle", history: [] })}
        onChangeNetwork={onChangeNetwork}
      />
    );

    const chip = screen.getByLabelText("Network");
    expect(chip.textContent).toBe("NetworkDevnetChange");
    fireEvent.click(within(chip).getByRole("button", { name: "Change" }));
    expect(onChangeNetwork).toHaveBeenCalledTimes(1);
  });

  it("shows the network that has the deploys, when Settings offers it", () => {
    const onShowNetwork = vi.fn();
    render(
      <BaseDeploy
        {...props({
          built: true,
          deploy: "idle",
          cluster: "testnet",
          history: [record("a", "5sig")],
        })}
        onShowNetwork={onShowNetwork}
      />
    );

    expect(
      screen.getByRole("heading", { name: "Nothing on testnet" })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show devnet" }));
    expect(onShowNetwork).toHaveBeenCalledWith("devnet");
  });

  it("turns Show off while a deploy runs", () => {
    const onShowNetwork = vi.fn();
    render(
      <BaseDeploy
        {...props({
          built: true,
          deploy: "running",
          cluster: "testnet",
          history: [record("a", "5sig")],
        })}
        onShowNetwork={onShowNetwork}
      />
    );

    const show = screen.getByRole<HTMLButtonElement>("button", {
      name: "Show devnet",
    });
    expect(show.disabled).toBe(true);
    fireEvent.click(show);
    expect(onShowNetwork).not.toHaveBeenCalled();
  });

  it("offers no Show for a network Settings does not offer", () => {
    render(
      <BaseDeploy
        {...props({
          built: true,
          deploy: "idle",
          cluster: "testnet",
          history: [record("a", "5sig")],
        })}
        isNetworkOffered={() => false}
      />
    );

    expect(
      screen.getByText(/This project has deploys on devnet\./)
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Show / })).toBeNull();
  });
});
