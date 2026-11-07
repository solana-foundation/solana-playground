// A second file: its env mock gives every test here a platform devnet, which
// BaseNetworkChoice.test.tsx must not see; the custom RPC list reads it too
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Endpoint } from "@/constants";
import { PgCustomRpcs } from "@/entities/cluster";

import BaseNetworkChoice from "./BaseNetworkChoice";

vi.mock("@/shared/config/client-env", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/shared/config/client-env")
  >();
  return Object.assign({}, original, {
    PLATFORM_RPC_URLS: { devnet: "https://devnet.platform.test" },
  });
});

describe("BaseNetworkChoice with a platform devnet", () => {
  beforeEach(() => {
    localStorage.clear();
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

  it("offers the platform devnet in place of the public one", () => {
    render(
      <BaseNetworkChoice
        endpoint="https://devnet.platform.test"
        onPick={() => {}}
      />
    );

    expect(
      screen.getAllByRole("radio").map((r) => r.textContent?.trim())
    ).toEqual(["Mainnet", "Devnet", "Testnet", "Localnet", "Surfpool"]);
    expect(
      screen.getByRole("radio", { name: "Devnet" }).getAttribute("aria-checked")
    ).toBe("true");
  });

  it("lists a typed-in public devnet as a custom chip named by its host, checked", () => {
    const listed = PgCustomRpcs.adopt(Endpoint.DEVNET);
    if (!listed) throw new Error("The public devnet was not listed");

    render(
      <BaseNetworkChoice
        endpoint={listed}
        custom={PgCustomRpcs.list()}
        onPick={() => {}}
      />
    );

    expect(
      screen.getAllByRole("radio").map((r) => r.textContent?.trim())
    ).toEqual([
      "Mainnet",
      "Devnet",
      "Testnet",
      "Localnet",
      "Surfpool",
      "api.devnet.solana.com",
    ]);
    expect(
      screen
        .getByRole("radio", { name: "api.devnet.solana.com" })
        .getAttribute("aria-checked")
    ).toBe("true");
  });
});
