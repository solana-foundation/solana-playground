// Guards for what `setupTests.ts` promises every test file

describe("the unit-test setup", () => {
  it("gives no test a real BroadcastChannel", () => {
    // Node 22 has one; a test that needs a channel installs a fake
    expect(typeof BroadcastChannel).toBe("undefined");
  });
});
