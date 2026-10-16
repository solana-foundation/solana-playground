// The global stand-ins `setupTests.ts` installs for every test file
describe("setupTests", () => {
  it("makes an unstubbed fetch throw instead of reaching the network", () => {
    // Port 9 (discard) on loopback: harmless if the guard ever lets it out
    expect(() => fetch("http://127.0.0.1:9/")).toThrow(
      "fetch is not stubbed in this test"
    );
  });
});
