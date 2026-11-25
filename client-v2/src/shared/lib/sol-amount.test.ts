import { describe, expect, it } from "vitest";

import { solAmount } from "./sol-amount";

describe("solAmount", () => {
  it("keeps up to four decimals and drops trailing zeros", () => {
    expect(solAmount(4.2)).toBe("4.2 SOL");
    expect(solAmount(1.234567)).toBe("1.2346 SOL");
  });

  it('reads "0 SOL" when empty', () => {
    expect(solAmount(0)).toBe("0 SOL");
  });
});
