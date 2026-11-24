import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ACCOUNT_OPTIONS } from "./auth.mjs";
import {
  NoGithubGrant,
  readGithubToken,
  readGithubTokenWith,
} from "./github-token.mjs";

const TOKEN = "gho_secret";

/**
 * Better Auth 1.7's `/get-access-token` takes `{accountId, userId?}` or
 * `{useAccountCookie: true, userId?}` and nothing else (`accountSelectionSchema`,
 * a strict union); this stand-in refuses any other body the same way.
 */
const fakeAuth = ({ accounts, token, fail }) => {
  const calls = [];
  return {
    calls,
    $context: Promise.resolve({
      internalAdapter: { findAccounts: async () => accounts },
    }),
    api: {
      getAccessToken: async ({ body }) => {
        calls.push(body);
        const keys = Object.keys(body).sort().join(",");
        if (keys !== "accountId,userId" && keys !== "accountId") {
          throw Object.assign(new Error("[body] Invalid input"), {
            body: { code: "VALIDATION_ERROR" },
          });
        }
        if (fail)
          throw Object.assign(new Error(fail), { body: { code: fail } });
        return { accessToken: token };
      },
    },
  };
};

describe("readGithubToken", () => {
  it("selects the user's GitHub account by its row id", async () => {
    const auth = fakeAuth({
      accounts: [
        { id: "a0", providerId: "credential" },
        { id: "a1", providerId: "github" },
      ],
      token: TOKEN,
    });
    assert.equal(await readGithubToken(auth, "u1"), TOKEN);
    assert.deepEqual(auth.calls, [{ accountId: "a1", userId: "u1" }]);
  });

  it("throws NoGithubGrant when the user has no GitHub account", async () => {
    const auth = fakeAuth({
      accounts: [{ id: "a0", providerId: "credential" }],
      token: TOKEN,
    });
    await assert.rejects(readGithubToken(auth, "u1"), {
      name: "NoGithubGrant",
      reason: "no-account",
    });
    assert.deepEqual(auth.calls, []);
  });

  it("throws NoGithubGrant when Better Auth cannot produce a token", async () => {
    const auth = fakeAuth({
      accounts: [{ id: "a1", providerId: "github" }],
      token: TOKEN,
      fail: "FAILED_TO_GET_ACCESS_TOKEN",
    });
    const thrown = await readGithubToken(auth, "u1").catch((e) => e);
    assert.ok(thrown instanceof NoGithubGrant);
    assert.equal(thrown.reason, "unreadable");
    assert.equal(thrown.cause.body.code, "FAILED_TO_GET_ACCESS_TOKEN");
  });

  it("throws NoGithubGrant when the stored token is empty", async () => {
    const auth = fakeAuth({
      accounts: [{ id: "a1", providerId: "github" }],
      token: "",
    });
    await assert.rejects(readGithubToken(auth, "u1"), {
      name: "NoGithubGrant",
      reason: "empty",
    });
  });
});

describe("readGithubTokenWith", () => {
  const github = () =>
    fakeAuth({ accounts: [{ id: "a1", providerId: "github" }], token: TOKEN });

  it("reads the token over the instance an async getAuth resolves to", async () => {
    const auth = github();
    const read = readGithubTokenWith(async () => auth);

    assert.equal(await read("u1"), TOKEN);
    assert.deepEqual(auth.calls, [{ accountId: "a1", userId: "u1" }]);
  });

  it("throws an error of ours, not NoGithubGrant, when sign-in is not configured", async () => {
    // eslint-disable-next-line unicorn/no-null -- `getAuth` answers null when sign-in is not configured
    const read = readGithubTokenWith(async () => null);

    const thrown = await read("u1").catch((e) => e);
    assert.ok(thrown instanceof Error);
    assert.ok(!(thrown instanceof NoGithubGrant));
  });
});

describe("readGithubToken against Better Auth itself", () => {
  // The fakes above mirror Better Auth's schema; these run the real endpoint
  // with the production account options, so a future change to how it
  // selects an account or stores a token fails here, not in Share
  const SECRET = "test-secret-".repeat(4);

  /** A Better Auth over memory, configured as `getAuth` configures its own */
  const authWith = async (secret) => {
    const { betterAuth } = await import("better-auth");
    const { memoryAdapter } = await import("better-auth/adapters/memory");
    const db = { user: [], session: [], account: [], verification: [] };
    const auth = betterAuth({
      secret,
      baseURL: "http://localhost:3000",
      database: memoryAdapter(db),
      account: ACCOUNT_OPTIONS,
      socialProviders: { github: { clientId: "c", clientSecret: "s" } },
      logger: { disabled: true },
    });
    return { auth, db };
  };

  /** A user with a GitHub account row holding `stored` as its token */
  const userHolding = async (auth, stored) => {
    const ctx = await auth.$context;
    const user = await ctx.internalAdapter.createUser({
      email: "a@example.com",
      name: "a",
      emailVerified: true,
    });
    await ctx.internalAdapter.createAccount({
      userId: user.id,
      providerId: "github",
      accountId: "123",
      accessToken: stored,
    });
    return user.id;
  };

  /** The token as sign-in stores it: through Better Auth's own write path */
  const storedBySignIn = async (auth, token) => {
    const { setTokenUtil } = await import("better-auth/oauth2");
    return setTokenUtil(token, await auth.$context);
  };

  it("stores the token encrypted, never as plaintext", async () => {
    const { auth, db } = await authWith(SECRET);
    await userHolding(auth, await storedBySignIn(auth, TOKEN));

    const row = db.account[0].accessToken;
    assert.notEqual(row, TOKEN);
    assert.ok(!row.includes(TOKEN));
  });

  it("reads the encrypted token stored for the user's GitHub account", async () => {
    const { auth } = await authWith(SECRET);
    const userId = await userHolding(auth, await storedBySignIn(auth, TOKEN));

    assert.equal(await readGithubToken(auth, userId), TOKEN);
  });

  it("reads a token stored before encryption as it is", async () => {
    const { auth } = await authWith(SECRET);
    const userId = await userHolding(auth, TOKEN);

    assert.equal(await readGithubToken(auth, userId), TOKEN);
  });

  it("throws NoGithubGrant for a token stored under another secret", async () => {
    const { auth: before } = await authWith(SECRET);
    const stored = await storedBySignIn(before, TOKEN);
    const { auth } = await authWith("rotated-secret-".repeat(4));
    const userId = await userHolding(auth, stored);

    await assert.rejects(readGithubToken(auth, userId), {
      name: "NoGithubGrant",
      reason: "unreadable",
    });
  });
});
