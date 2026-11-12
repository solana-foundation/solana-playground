import { describe, expect, it } from "vitest";

import { getAirdropVia, withAirdropVia } from "./via";

describe("commands/airdrop/via", () => {
  it("names the terminal when no caller named itself", () => {
    expect(getAirdropVia()).toBe("terminal");
  });

  it("names the caller for the duration of its run, and resolves with its result", async () => {
    const result = await withAirdropVia(async () => {
      await Promise.resolve();
      return getAirdropVia();
    }, "deploy");
    expect(result).toBe("deploy");
    expect(getAirdropVia()).toBe("terminal");
  });

  it("restores the previous caller after a nested run", async () => {
    const seen: string[] = [];
    await withAirdropVia(async () => {
      seen.push(getAirdropVia());
      await withAirdropVia(async () => {
        seen.push(getAirdropVia());
      }, "automatic");
      seen.push(getAirdropVia());
    }, "wallet");
    expect(seen).toEqual(["wallet", "automatic", "wallet"]);
    expect(getAirdropVia()).toBe("terminal");
  });

  it("restores the previous caller when the run throws", async () => {
    await expect(
      withAirdropVia(async () => {
        throw new Error("rate limited");
      }, "stage")
    ).rejects.toThrow("rate limited");
    expect(getAirdropVia()).toBe("terminal");
  });

  it("names no stale caller when overlapping runs settle first in, first out", async () => {
    let settleFirst = () => {};
    let settleSecond = () => {};
    const first = withAirdropVia(
      () => new Promise<void>((resolve) => (settleFirst = resolve)),
      "deploy"
    );
    const second = withAirdropVia(
      () => new Promise<void>((resolve) => (settleSecond = resolve)),
      "automatic"
    );
    expect(getAirdropVia()).toBe("automatic");

    settleFirst();
    await first;
    expect(getAirdropVia()).toBe("automatic");

    settleSecond();
    await second;
    expect(getAirdropVia()).toBe("terminal");
  });
});
