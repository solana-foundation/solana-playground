// The Interact stage drawn from props: what each surface says, which action
// it offers, and that the IDL action is on screen exactly once.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BaseInteract from "./BaseInteract";
import type { BaseInteractProps, DeploymentOption } from "./BaseInteract";
import type { InteractSurface } from "./interact-surface";

const SURFACES: InteractSurface[] = [
  "no-project",
  "checking",
  "not-built",
  "no-idl",
  "no-program-id",
  "bad-idl",
  "unreachable",
  "not-deployed",
  "ready",
];

/** Every prop, named; each test passes what it is about */
const props = (
  surface: InteractSurface,
  over: {
    cluster?: string | null;
    deployments?: DeploymentOption[];
    onGoTo?: BaseInteractProps["onGoTo"];
    onPick?: BaseInteractProps["onPick"];
  } = {}
): BaseInteractProps => ({
  meta: "no deployments yet",
  deployments: over.deployments ?? [],
  selected: over.deployments?.[0]?.id ?? null,
  onPick: over.onPick ?? vi.fn(),
  surface,
  cluster: over.cluster === undefined ? "devnet" : over.cluster,
  onGoTo: over.onGoTo ?? vi.fn(),
  idlLoad: <button>Upload IDL</button>,
  form: <div>FORM</div>,
});

const actions = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-slot="stage-empty-actions"]')!;

describe("BaseInteract", () => {
  it("before a deploy it says so and offers Go to Deploy", () => {
    const onGoTo = vi.fn();
    const { container } = render(
      <BaseInteract {...props("not-deployed", { onGoTo })} />
    );
    expect(
      screen.getByRole("heading", { name: "Nothing to call yet" })
    ).toBeTruthy();
    expect(screen.getByText(/Once it is on devnet,/)).toBeTruthy();
    fireEvent.click(
      within(actions(container)).getByRole("button", { name: "Go to Deploy" })
    );
    expect(onGoTo).toHaveBeenCalledWith("deploy");
    expect(screen.queryByText("FORM")).toBeNull();
  });

  it("an unknown cluster reads as the network", () => {
    render(<BaseInteract {...props("not-deployed", { cluster: null })} />);
    expect(screen.getByText(/Once it is on the network,/)).toBeTruthy();
  });

  /** The prototype says what is missing for Interact: a deployment */
  it("before a build it asks for a deploy and offers Go to Deploy", () => {
    const onGoTo = vi.fn();
    render(<BaseInteract {...props("not-built", { onGoTo })} />);
    expect(screen.getByText(/^Deploy the program first\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Go to Deploy" }));
    expect(onGoTo).toHaveBeenCalledWith("deploy");
  });

  it("one Upload IDL in every surface", () => {
    for (const surface of SURFACES) {
      const { container, unmount } = render(
        <BaseInteract {...props(surface)} />
      );
      expect(
        screen.getAllByRole("button", { name: "Upload IDL" })
      ).toHaveLength(1);
      if (surface === "no-idl") {
        expect(
          within(actions(container)).getByRole("button", {
            name: "Upload IDL",
          })
        ).toBeTruthy();
      }
      unmount();
    }
  });

  it("a bad IDL shows the error notice", () => {
    const { container } = render(<BaseInteract {...props("bad-idl")} />);
    expect(
      container.querySelector('[data-slot="callout"]')!.textContent
    ).toContain("corrupted IDL");
  });

  it("ready draws the form and no empty state", () => {
    const { container } = render(<BaseInteract {...props("ready")} />);
    expect(screen.getByText("FORM")).toBeTruthy();
    expect(container.querySelector('[data-slot="stage-empty"]')).toBeNull();
  });

  it("the deployment select picks by id", () => {
    const onPick = vi.fn();
    render(
      <BaseInteract
        {...props("ready", {
          onPick,
          deployments: [
            { id: "a", label: "latest · devnet · 6PNd3S…" },
            { id: "b", label: "devnet · 9xQeWv…" },
          ],
        })}
      />
    );
    fireEvent.change(screen.getByLabelText("Deployment"), {
      target: { value: "b" },
    });
    expect(onPick).toHaveBeenCalledWith("b");
  });

  it("with no deployments the select is off and says none yet", () => {
    render(<BaseInteract {...props("not-deployed")} />);
    const select = screen.getByLabelText("Deployment") as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(select.textContent).toBe("none yet");
  });

  it("without a program id it offers Go to Build", () => {
    const onGoTo = vi.fn();
    render(<BaseInteract {...props("no-program-id", { onGoTo })} />);
    expect(screen.getByText(/Building the program creates one/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Go to Build" }));
    expect(onGoTo).toHaveBeenCalledWith("build");
  });

  it("while the chain is read it says so, with no error and no action", () => {
    const { container } = render(<BaseInteract {...props("checking")} />);
    expect(screen.getByText(/Reading the program from devnet/)).toBeTruthy();
    expect(container.querySelector('[data-slot="callout"]')).toBeNull();
    expect(
      container.querySelector('[data-slot="stage-empty-actions"]')
    ).toBeNull();
  });

  /** Each empty surface: its title, and whether it offers a step */
  const EMPTY: Array<[InteractSurface, string, boolean]> = [
    ["no-project", "No project open", false],
    ["checking", "Checking the program", false],
    ["not-built", "Nothing to call yet", true],
    ["no-idl", "No IDL yet", true],
    ["no-program-id", "No program id", true],
    ["bad-idl", "This IDL can't be read", false],
    ["unreachable", "Can't reach the network", false],
    ["not-deployed", "Nothing to call yet", true],
  ];

  it.each(EMPTY)("%s says %s", (surface, title, hasAction) => {
    const { container } = render(<BaseInteract {...props(surface)} />);
    expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    expect(
      container.querySelector('[data-slot="stage-empty-actions"]') !== null
    ).toBe(hasAction);
  });

  it("an unreachable network shows the error notice", () => {
    const { container } = render(<BaseInteract {...props("unreachable")} />);
    expect(
      container.querySelector('[data-slot="callout"]')!.textContent
    ).toContain("Connection error");
  });
});
