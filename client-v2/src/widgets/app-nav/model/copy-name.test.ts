import { copyName } from "./copy-name";

describe("copyName", () => {
  it("names the first copy", () => {
    expect(copyName("alpha", ["alpha"])).toBe("alpha copy");
  });

  it("numbers the next free copy", () => {
    expect(copyName("alpha", ["alpha", "alpha copy"])).toBe("alpha copy 2");
    expect(copyName("alpha", ["alpha", "alpha copy", "alpha copy 2"])).toBe(
      "alpha copy 3"
    );
  });
});
