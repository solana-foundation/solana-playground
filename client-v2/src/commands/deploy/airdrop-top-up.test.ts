import { airdropTopUp } from "./airdrop-top-up";

describe("airdropTopUp", () => {
  it("covers the shortfall plus fee headroom, rounded to whole SOL", () => {
    expect(airdropTopUp(0.32, 100)).toBe(1);
  });

  it("caps the request at the cluster's faucet amount", () => {
    expect(airdropTopUp(9.5, 5)).toBe(5);
  });

  it("rounds up when the headroom crosses a whole SOL", () => {
    expect(airdropTopUp(0.95, 5)).toBe(2);
  });
});
