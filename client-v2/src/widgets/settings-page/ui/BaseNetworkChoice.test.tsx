import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import BaseNetworkChoice from "./BaseNetworkChoice";
import { Endpoint } from "@/constants";

describe("BaseNetworkChoice", () => {
  beforeEach(() => {
    // the group measures its chips with one; jsdom has none
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });

  it("is a radio group named Network with the current one checked", () => {
    render(<BaseNetworkChoice endpoint={Endpoint.DEVNET} onPick={() => {}} />);
    expect(screen.getByRole("radiogroup", { name: "Network" })).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: "Devnet" }).getAttribute("aria-checked")
    ).toBe("true");
  });

  it("picks the next network with the right arrow", async () => {
    const onPick = vi.fn();
    render(<BaseNetworkChoice endpoint={Endpoint.DEVNET} onPick={onPick} />);
    act(() => screen.getByRole("radio", { name: "Devnet" }).focus());
    await userEvent.keyboard("{ArrowRight}");
    expect(onPick).toHaveBeenCalledWith(Endpoint.TESTNET);
    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: "Testnet" })
    );
  });

  it("counts a click on the network already chosen as a choice, though it changes nothing", async () => {
    const onPick = vi.fn();
    const onChoose = vi.fn();
    render(
      <BaseNetworkChoice
        endpoint={Endpoint.DEVNET}
        onPick={onPick}
        onChoose={onChoose}
      />
    );
    await userEvent.click(screen.getByRole("radio", { name: "Devnet" }));
    expect(onChoose).toHaveBeenCalledExactlyOnceWith(Endpoint.DEVNET);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("counts a switch to another network as one choice", async () => {
    const onChoose = vi.fn();
    render(
      <BaseNetworkChoice
        endpoint={Endpoint.DEVNET}
        onPick={() => {}}
        onChoose={onChoose}
      />
    );
    await userEvent.click(screen.getByRole("radio", { name: "Testnet" }));
    expect(onChoose).toHaveBeenCalledExactlyOnceWith(Endpoint.TESTNET);
  });

  it("leaves every chip unchecked for an endpoint it does not list, and Tab still enters the group", async () => {
    render(<BaseNetworkChoice endpoint="https://my.rpc" onPick={() => {}} />);
    const radios = screen.getAllByRole("radio");
    expect(
      radios.every((r) => r.getAttribute("aria-checked") === "false")
    ).toBe(true);
    // Radix makes the group itself the stop here and hands focus to a chip
    await userEvent.tab();
    expect(radios).toContain(document.activeElement);
  });

  it("does not switch network when focus lands on a chip of an unlisted endpoint", () => {
    const onPick = vi.fn();
    render(<BaseNetworkChoice endpoint="https://my.rpc" onPick={onPick} />);
    act(() => screen.getAllByRole("radio")[0].focus());
    expect(onPick).not.toHaveBeenCalled();
  });

  it("does not switch network when Shift+Tab lands on a chip that is not the current one", async () => {
    const onPick = vi.fn();
    render(
      <>
        <BaseNetworkChoice endpoint={Endpoint.DEVNET} onPick={onPick} />
        <button>after</button>
      </>
    );
    // Radix keeps the last focused chip as the group's tab stop, not the
    // checked one, so coming back lands on Testnet.
    act(() => screen.getByRole("radio", { name: "Testnet" }).focus());
    await userEvent.tab();
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: "Testnet" })
    );
    expect(onPick).not.toHaveBeenCalled();
  });

  it("offers Mainnet Beta, described as deploying with real SOL", () => {
    render(
      <BaseNetworkChoice endpoint={Endpoint.MAINNET_BETA} onPick={() => {}} />
    );
    expect(
      screen
        .getByRole("radio", { name: "Mainnet Beta" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(
      screen.getByRole("radiogroup", {
        name: "Network",
        description: "Deploys with real SOL",
      })
    ).toBeTruthy();
  });

  it("says nothing about real SOL on devnet", () => {
    render(<BaseNetworkChoice endpoint={Endpoint.DEVNET} onPick={() => {}} />);
    expect(screen.queryByText("Deploys with real SOL")).toBeNull();
  });

  it("picks once on a click", async () => {
    const onPick = vi.fn();
    render(<BaseNetworkChoice endpoint={Endpoint.DEVNET} onPick={onPick} />);
    await userEvent.click(screen.getByRole("radio", { name: "Testnet" }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(Endpoint.TESTNET);
  });
});
