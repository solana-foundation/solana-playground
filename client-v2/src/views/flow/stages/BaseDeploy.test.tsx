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

const PROGRAM_ID = "6PNd3SLJU8V6mqVmDNaV6x2UR6A8ZedA3p5FPrBjAVkj";

const record = (id: string, signature: string | null): DeployRecord => ({
  id,
  workspace: "counter",
  cluster: "devnet",
  programId: PROGRAM_ID,
  signature,
  at: Date.UTC(2026, 9, 15),
});

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
}): BaseDeployProps => ({
  cluster: state.cluster === undefined ? "devnet" : state.cluster,
  built: state.built,
  deploy: state.deploy,
  programId: PROGRAM_ID,
  details: state.details ?? NO_DETAILS,
  history: state.history,
  addressUrl: (id) => `https://explorer.test/address/${id}`,
  txUrl: (sig) => `https://explorer.test/tx/${sig}`,
  onDeploy: vi.fn(),
  onInteract: vi.fn(),
  idlDrop: null,
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

    const result = screen.getByRole("status");
    expect(result.textContent).toContain("Deployed to devnet");
    expect(result.querySelector("code")?.textContent).toBe(PROGRAM_ID);
    expect(result.querySelector('[data-slot="copy-button"]')).toBeTruthy();
    expect(
      within(result)
        .getByRole("link", {
          name: `View latest deployment (${PROGRAM_ID}) on Explorer`,
        })
        .getAttribute("href")
    ).toBe(`https://explorer.test/address/${PROGRAM_ID}`);
    expect(
      within(result).getByRole("link", {
        name: "View latest deployment transaction (5sig) on Explorer",
      })
    ).toBeTruthy();

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
        name: `View deployment (${PROGRAM_ID}) on Explorer`,
      })
    ).toHaveLength(2);
  });

  it("says when nothing was deployed", () => {
    render(
      <BaseDeploy {...props({ built: true, deploy: "idle", history: [] })} />
    );

    expect(
      screen.getByText("No deployments yet for this project.")
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
