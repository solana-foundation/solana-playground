import { checkSignedIn, PgSession } from "./index";

describe("checkSignedIn", () => {
  afterEach(() => PgSession.reset());

  it("throws for a signed-out user, so the airdrop command stops", () => {
    expect(() => checkSignedIn()).toThrow(/sign in with github/i);
  });

  it("passes once a session exists", async () => {
    await PgSession.refreshWith({
      id: "u1",
      name: "Ada",
      image: null,
      login: "ada",
    });

    expect(() => checkSignedIn()).not.toThrow();
  });
});
