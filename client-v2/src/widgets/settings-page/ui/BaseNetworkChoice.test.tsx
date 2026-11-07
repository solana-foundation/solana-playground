import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Endpoint } from "@/constants";

import BaseNetworkChoice, { chipKey } from "./BaseNetworkChoice";

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
    expect(onPick).toHaveBeenCalledWith(
      Endpoint.TESTNET,
      chipKey("Testnet", Endpoint.TESTNET)
    );
    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: "Testnet" })
    );
  });

  describe("chips that share a URL", () => {
    const custom = [
      { name: "Mine", url: Endpoint.DEVNET },
      { name: "Public too", url: Endpoint.DEVNET },
    ];
    const checked = () =>
      screen
        .getAllByRole("radio")
        .filter((r) => r.getAttribute("aria-checked") === "true")
        .map((r) => r.textContent);

    it("checks one chip only, the first that lists the endpoint", () => {
      render(
        <BaseNetworkChoice
          endpoint={Endpoint.DEVNET}
          custom={custom}
          onPick={() => {}}
        />
      );
      expect(checked()).toEqual(["Devnet"]);
    });

    it("checks the chosen chip while the endpoint is its URL", () => {
      const { rerender } = render(
        <BaseNetworkChoice
          endpoint={Endpoint.DEVNET}
          custom={custom}
          chosen={chipKey("Public too", Endpoint.DEVNET)}
          onPick={() => {}}
        />
      );
      expect(checked()).toEqual(["Public too"]);
      rerender(
        <BaseNetworkChoice
          endpoint={Endpoint.MAINNET_BETA}
          custom={custom}
          chosen={chipKey("Public too", Endpoint.DEVNET)}
          onPick={() => {}}
        />
      );
      expect(checked()).toEqual(["Mainnet"]);
    });

    it("answers the URL and the key of the chip clicked", async () => {
      const onPick = vi.fn();
      render(
        <BaseNetworkChoice
          endpoint={Endpoint.DEVNET}
          custom={custom}
          onPick={onPick}
        />
      );
      await userEvent.click(screen.getByRole("radio", { name: "Mine" }));
      expect(onPick).toHaveBeenCalledWith(
        Endpoint.DEVNET,
        chipKey("Mine", Endpoint.DEVNET)
      );
    });
  });

  it("picks nothing on a click on the network already chosen", async () => {
    const onPick = vi.fn();
    render(<BaseNetworkChoice endpoint={Endpoint.DEVNET} onPick={onPick} />);
    await userEvent.click(screen.getByRole("radio", { name: "Devnet" }));
    expect(onPick).not.toHaveBeenCalled();
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
    // checked one, so coming back lands on Mainnet.
    act(() => screen.getByRole("radio", { name: "Mainnet" }).focus());
    await userEvent.tab();
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: "Mainnet" })
    );
    expect(onPick).not.toHaveBeenCalled();
  });

  it("offers Mainnet, Devnet, Testnet, Localnet and Surfpool, in that order", () => {
    render(<BaseNetworkChoice endpoint={Endpoint.DEVNET} onPick={() => {}} />);
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "Mainnet",
      "Devnet",
      "Testnet",
      "Localnet",
      "Surfpool",
    ]);
  });

  it.each([
    ["Testnet", Endpoint.TESTNET],
    ["Localnet", Endpoint.LOCALNET],
    ["Surfpool", Endpoint.SURFPOOL],
  ])("checks %s on its address, with no line under it", (name, endpoint) => {
    render(<BaseNetworkChoice endpoint={endpoint} onPick={() => {}} />);
    expect(
      screen.getByRole("radio", { name }).getAttribute("aria-checked")
    ).toBe("true");
    expect(screen.queryByText("Not available for deploys")).toBeNull();
  });

  it("offers Mainnet, described as deploying with real SOL", () => {
    render(
      <BaseNetworkChoice endpoint={Endpoint.MAINNET_BETA} onPick={() => {}} />
    );
    expect(
      screen
        .getByRole("radio", { name: "Mainnet" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(
      screen.getByRole("radiogroup", {
        name: "Network",
        description: "Not available for deploys",
      })
    ).toBeTruthy();
  });

  it("says nothing about real SOL on devnet", () => {
    render(<BaseNetworkChoice endpoint={Endpoint.DEVNET} onPick={() => {}} />);
    expect(screen.queryByText("Not available for deploys")).toBeNull();
  });

  it("picks once on a click", async () => {
    const onPick = vi.fn();
    render(<BaseNetworkChoice endpoint={Endpoint.DEVNET} onPick={onPick} />);
    await userEvent.click(screen.getByRole("radio", { name: "Mainnet" }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(
      Endpoint.MAINNET_BETA,
      chipKey("Mainnet", Endpoint.MAINNET_BETA)
    );
  });
  it("puts a chip for each saved RPC after the offered networks, under its name", () => {
    render(
      <BaseNetworkChoice
        endpoint="https://h.test/"
        custom={[
          { name: "Helius", url: "https://h.test/" },
          { name: "Triton", url: "https://t.test/" },
        ]}
        onPick={() => {}}
      />
    );
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "Mainnet",
      "Devnet",
      "Testnet",
      "Localnet",
      "Surfpool",
      "Helius",
      "Triton",
    ]);
    expect(
      screen.getByRole("radio", { name: "Helius" }).getAttribute("aria-checked")
    ).toBe("true");
  });

  it("picks a saved RPC's URL on a click on its chip", async () => {
    const onPick = vi.fn();
    render(
      <BaseNetworkChoice
        endpoint={Endpoint.DEVNET}
        custom={[{ name: "Helius", url: "https://h.test/" }]}
        onPick={onPick}
      />
    );
    await userEvent.click(screen.getByRole("radio", { name: "Helius" }));
    expect(onPick).toHaveBeenCalledWith(
      "https://h.test/",
      chipKey("Helius", "https://h.test/")
    );
  });
});
