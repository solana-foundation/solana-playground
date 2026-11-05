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
import { requireFor } from "@/test-utils/require-for";

import type { DeployRecord } from "../state/deploy-history";
import type {
  BaseDeployProps,
  DeployDetails,
  DeployStatus,
} from "./BaseDeploy";
import BaseDeploy from "./BaseDeploy";

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
}): BaseDeployProps => ({
  cluster: "devnet",
  built: state.built,
  deploy: state.deploy,
  programId: PROGRAM_ID,
  details: state.details ?? NO_DETAILS,
  history: state.history,
  addressUrl: (id) => `https://explorer.test/address/${id}`,
  txUrl: (sig) => `https://explorer.test/tx/${sig}`,
  onDeploy: vi.fn(),
  onInteract: vi.fn(),
  onGoToBuild: vi.fn(),
  onShowLog: vi.fn(),
  idlUpload: <button>Upload IDL</button>,
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

describe("BaseDeploy", () => {
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

  it("offers Go to Build, before Upload IDL, while nothing is built (Spec 03 DEP-07)", () => {
    const p = props({ built: false, deploy: "idle", history: [] });
    const { container } = render(<BaseDeploy {...p} />);

    expect(screen.getByText("Build the program first.")).toBeTruthy();
    const goToBuild = screen.getByRole("button", { name: "Go to Build" });
    fireEvent.click(goToBuild);
    expect(p.onGoToBuild).toHaveBeenCalled();
    // The pill itself, the only one
    expect(brandButtons(container)).toHaveLength(1);
    expect(brandButtons(container)[0]).toBe(goToBuild);
    expect(
      goToBuild.compareDocumentPosition(
        screen.getByRole("button", { name: "Upload IDL" })
      ) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("offers no Go to Build once the program is built", () => {
    render(
      <BaseDeploy {...props({ built: true, deploy: "idle", history: [] })} />
    );

    expect(screen.queryByRole("button", { name: "Go to Build" })).toBeNull();
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

  /** Before the first deploy: the pill, and Upload IDL beside it */
  it("before the first deploy it has no history, only Upload IDL", () => {
    const { container } = render(
      <BaseDeploy {...props({ built: true, deploy: "idle", history: [] })} />
    );

    expect(screen.queryByRole("region", { name: "History" })).toBeNull();
    const actions = requireFor("the stage's actions")(
      container.querySelector<HTMLElement>('[data-slot="stage-empty-actions"]')
    );
    const labels = [...actions.querySelectorAll("button")].map(
      (b) => b.textContent
    );
    expect(labels).toEqual(["Deploy to devnet", "Upload IDL"]);
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
    const actions = requireFor("the stage's actions")(
      container.querySelector<HTMLElement>('[data-slot="stage-empty-actions"]')
    );
    expect(
      within(actions).getByRole("button", { name: "Upload IDL" })
    ).toBeTruthy();
  });

  it("asks for a build first, without naming the stepper", () => {
    render(
      <BaseDeploy {...props({ built: false, deploy: "idle", history: [] })} />
    );

    expect(screen.getByText("Build the program first.")).toBeTruthy();
  });

  /** The network is a quiet eyebrow over the title, not a mono line under it */
  it("names the network above the title", () => {
    const { container } = render(
      <BaseDeploy {...props({ built: false, deploy: "idle", history: [] })} />
    );

    const eyebrow = container.querySelector(
      '[data-slot="stage-empty-eyebrow"]'
    );
    expect(eyebrow?.textContent).toBe("Devnet");
    expect(eyebrow?.querySelector('[data-slot="status-dot"]')).toBeTruthy();
    expect(eyebrow?.nextElementSibling?.getAttribute("data-slot")).toBe(
      "stage-empty-title"
    );
    expect(
      container.querySelector('[data-slot="stage-empty-meta"]')
    ).toBeNull();
  });

  it("counts the deployments under the title once there are some", () => {
    const { container } = render(
      <BaseDeploy
        {...props({
          built: true,
          deploy: "idle",
          history: [record("a", null), record("b", null)],
        })}
      />
    );

    expect(
      container.querySelector('[data-slot="stage-empty-eyebrow"]')?.textContent
    ).toBe("Devnet");
    expect(
      container.querySelector('[data-slot="stage-empty-meta"]')?.textContent
    ).toBe("2 deployments");
  });

  it("names no network until the endpoint has been read", () => {
    const p = props({ built: false, deploy: "idle", history: [] });
    const { container } = render(
      <BaseDeploy
        cluster={null}
        built={p.built}
        deploy={p.deploy}
        programId={p.programId}
        details={p.details}
        history={p.history}
        addressUrl={p.addressUrl}
        txUrl={p.txUrl}
        onDeploy={p.onDeploy}
        onInteract={p.onInteract}
        onGoToBuild={p.onGoToBuild}
        onShowLog={p.onShowLog}
        idlUpload={p.idlUpload}
      />
    );

    expect(
      container.querySelector('[data-slot="stage-empty-eyebrow"]')
    ).toBeNull();
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
