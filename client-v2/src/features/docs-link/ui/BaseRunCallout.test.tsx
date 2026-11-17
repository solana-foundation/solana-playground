// The stage row's Run and the callout above the code, drawn from props alone
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/shared/ui/tooltip";

import type { RunState } from "../model/run";
import BaseRunButton from "./BaseRunButton";
import BaseRunCallout from "./BaseRunCallout";

const SOURCE = {
  title: "Quickstart",
  from: "https://solana.com/docs/quickstart",
};

const calloutFrom =
  (source: ComponentProps<typeof BaseRunCallout>["source"]) =>
  (state: RunState) => {
    const handlers = {
      onRunAgain: vi.fn(),
      onCheckAgain: vi.fn(),
      onNotNow: vi.fn(),
      onCopyError: vi.fn(),
    };
    const { container } = render(
      <TooltipProvider>
        <BaseRunCallout
          state={state}
          source={source}
          onRunAgain={handlers.onRunAgain}
          onCheckAgain={handlers.onCheckAgain}
          onNotNow={handlers.onNotNow}
          onCopyError={handlers.onCopyError}
        />
      </TooltipProvider>
    );
    const node = container.querySelector("#client-run-callout");
    return { node, handlers };
  };

const callout = calloutFrom(SOURCE);

describe("BaseRunButton", () => {
  it.each([
    { running: false, ran: false, label: "Run", disabled: false },
    { running: true, ran: false, label: "Running…", disabled: true },
    { running: false, ran: true, label: "Run again", disabled: false },
  ])("running=$running ran=$ran reads $label", (row) => {
    const onRun = vi.fn();
    const { container } = render(
      <BaseRunButton running={row.running} ran={row.ran} onRun={onRun} />
    );
    const button = container.querySelector<HTMLButtonElement>("#flow-run");
    // The spinner adds its own "Loading" to the button's accessible name
    expect(button?.textContent).toBe(row.label);
    expect(button?.disabled).toBe(row.disabled);
  });
});

describe("BaseRunCallout", () => {
  it("names the docs page before a run, with a link to it", () => {
    const { node } = callout({ kind: "idle" });
    expect(node?.getAttribute("data-state")).toBe("source");
    expect(node?.textContent).toContain("From solana.com: Quickstart");
    const link = screen.getByRole("link", { name: "View the docs page" });
    expect(link.getAttribute("href")).toBe(SOURCE.from);
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("offers no docs page when the link named none", () => {
    calloutFrom({ title: "Hello" })({ kind: "idle" });
    expect(
      screen.queryByRole("link", { name: "View the docs page" })
    ).toBeNull();
    expect(screen.getByText("From a docs link: Hello")).toBeTruthy();
  });

  it("shows nothing for a project from no link before it is run", () => {
    const { node } = calloutFrom(undefined)({ kind: "idle" });
    expect(node).toBeNull();
  });

  it("keeps the last run's end while the next one runs", () => {
    const { node } = callout({
      kind: "running",
      startedAt: 0,
      isFromLink: true,
      previous: { kind: "done", ms: 2_000 },
    });
    expect(node?.getAttribute("data-state")).toBe("done");
  });

  it("says how long a good run took, and runs again", () => {
    const { node, handlers } = callout({ kind: "done", ms: 12_400 });
    expect(node?.getAttribute("data-state")).toBe("done");
    expect(node?.textContent).toContain("Ran in 12 s");
    fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    expect(handlers.onRunAgain).toHaveBeenCalledTimes(1);
  });

  it("shows the script's error after a failure", () => {
    const { node } = callout({ kind: "failed", message: "fetch failed" });
    expect(node?.getAttribute("data-state")).toBe("failed");
    expect(node?.textContent).toContain("Run failed");
    expect(node?.textContent).toContain("fetch failed");
  });

  it("names the package Playground cannot load", () => {
    const { node } = callout({
      kind: "missing-package",
      pkg: "@solana-program/memo",
    });
    expect(node?.getAttribute("data-state")).toBe("missing-package");
    expect(node?.textContent).toContain(
      "Playground can't load @solana-program/memo yet"
    );
    expect(node?.textContent).toContain("so nothing ran");
  });

  it("asks for SOL with the wallet, its balance and the faucet", () => {
    const { node, handlers } = callout({
      kind: "funding",
      address: "Wa11et",
      balance: 0,
      needed: 0.02,
      previous: { kind: "idle" },
    });
    expect(node?.getAttribute("data-state")).toBe("funding");
    const card = document.getElementById("client-run-funding");
    expect(card?.textContent).toContain("Wa11et");
    expect(card?.textContent).toContain("0 SOL");
    expect(card?.textContent).toContain("0.02 SOL");
    expect(
      screen.getByRole("link", { name: "Get devnet SOL" }).getAttribute("href")
    ).toBe("https://faucet.solana.com/?walletAddress=Wa11et&cluster=devnet");
    // Thumb sized on a phone, as the actions beside it are
    expect(
      screen.getByRole("button", { name: "Copy address" }).className
    ).toContain("max-md:size-11");

    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(handlers.onCheckAgain).toHaveBeenCalledTimes(1);
    expect(handlers.onNotNow).toHaveBeenCalledTimes(1);
  });
});
