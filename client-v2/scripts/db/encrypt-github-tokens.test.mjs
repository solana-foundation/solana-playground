import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ACCOUNT_OPTIONS,
  readGithubToken,
} from "../../src/features/auth/server.mjs";
import {
  encryptPlaintextTokensWith,
  getSettings,
  isEncrypted,
  proveSecretWith,
  readPlaintextRows,
} from "./encrypt-github-tokens.mjs";

const SECRET = "test-secret-".repeat(4);
const TOKEN = "gho_plaintext";

/**
 * The two statements the script sends, over rows in memory. `beforeUpdate`
 * runs between the read and the write, as a sign-in would.
 */
const fakeDb = (rows, beforeUpdate = () => {}) => {
  const query = async (text, params) => {
    if (text.startsWith("select")) {
      return {
        rows: rows
          .filter((r) => r.accessToken || r.refreshToken)
          .map((r) => ({
            id: r.id,
            accessToken: r.accessToken,
            refreshToken: r.refreshToken,
          })),
      };
    }
    beforeUpdate();
    const [id, access, refresh, wasAccess, wasRefresh] = params;
    const row = rows.find(
      (r) =>
        r.id === id &&
        r.accessToken === wasAccess &&
        r.refreshToken === wasRefresh
    );
    if (!row) return { rows: [], rowCount: 0 };
    row.accessToken = access;
    row.refreshToken = refresh;
    return { rows: [], rowCount: 1 };
  };
  return query;
};

describe("encrypt-github-tokens", () => {
  it("encrypts a plaintext token and leaves no plaintext row", async () => {
    const rows = [{ id: "a1", accessToken: TOKEN, refreshToken: null }];
    const query = fakeDb(rows);

    const result = await encryptPlaintextTokensWith(SECRET)(query);

    assert.deepEqual(result, { encrypted: 1, changedMeanwhile: 0 });
    assert.ok(isEncrypted(rows[0].accessToken));
    assert.ok(!rows[0].accessToken.includes(TOKEN));
    assert.equal(rows[0].refreshToken, null);
    assert.deepEqual(await readPlaintextRows(query), []);
  });

  it("leaves an encrypted token as it is, so a second run changes nothing", async () => {
    const rows = [{ id: "a1", accessToken: TOKEN, refreshToken: null }];
    const query = fakeDb(rows);
    await encryptPlaintextTokensWith(SECRET)(query);
    const once = rows[0].accessToken;

    const again = await encryptPlaintextTokensWith(SECRET)(query);

    assert.deepEqual(again, { encrypted: 0, changedMeanwhile: 0 });
    assert.equal(rows[0].accessToken, once);
  });

  it("encrypts a plaintext refresh token beside an encrypted access token", async () => {
    const { symmetricEncrypt } = await import("better-auth/crypto");
    const encrypted = await symmetricEncrypt({ key: SECRET, data: TOKEN });
    const rows = [{ id: "a1", accessToken: encrypted, refreshToken: "ghr_x" }];
    const query = fakeDb(rows);

    await encryptPlaintextTokensWith(SECRET)(query);

    // Encrypted once only: twice, Better Auth would hand GitHub ciphertext
    assert.equal(rows[0].accessToken, encrypted);
    assert.ok(isEncrypted(rows[0].refreshToken));
  });

  it("encrypts both tokens of a row that holds both in plaintext", async () => {
    const rows = [{ id: "a1", accessToken: TOKEN, refreshToken: "ghr_x" }];
    const query = fakeDb(rows);

    await encryptPlaintextTokensWith(SECRET)(query);

    assert.ok(isEncrypted(rows[0].accessToken));
    assert.ok(isEncrypted(rows[0].refreshToken));
  });

  it("keeps what a sign-in wrote between the read and the write", async () => {
    const rows = [{ id: "a1", accessToken: TOKEN, refreshToken: null }];
    const query = fakeDb(rows, () => {
      rows[0].accessToken = "ab12";
    });

    const result = await encryptPlaintextTokensWith(SECRET)(query);

    assert.deepEqual(result, { encrypted: 0, changedMeanwhile: 1 });
    assert.equal(rows[0].accessToken, "ab12");
  });

  it("writes tokens the deployment's Better Auth reads back", async () => {
    const rows = [{ id: "a1", accessToken: TOKEN, refreshToken: null }];
    await encryptPlaintextTokensWith(SECRET)(fakeDb(rows));

    const { betterAuth } = await import("better-auth");
    const { memoryAdapter } = await import("better-auth/adapters/memory");
    const auth = betterAuth({
      secret: SECRET,
      baseURL: "http://localhost:3000",
      database: memoryAdapter({
        user: [],
        session: [],
        account: [],
        verification: [],
      }),
      account: ACCOUNT_OPTIONS,
      socialProviders: { github: { clientId: "c", clientSecret: "s" } },
      logger: { disabled: true },
    });
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
      accessToken: rows[0].accessToken,
    });

    assert.equal(await readGithubToken(auth, user.id), TOKEN);
  });

  it("refuses to start without the secret, or beside a versioned key set", () => {
    assert.equal(getSettings({ DATABASE_URL: "postgres://x" }).ok, false);
    assert.equal(getSettings({ AUTH_SECRET: SECRET }).ok, false);
    assert.equal(
      getSettings({
        DATABASE_URL: "postgres://x",
        AUTH_SECRET: SECRET,
        BETTER_AUTH_SECRETS: "1:a",
      }).ok,
      false
    );
    assert.deepEqual(
      getSettings({ DATABASE_URL: "postgres://x", AUTH_SECRET: SECRET }),
      { ok: true, databaseUrl: "postgres://x", secret: SECRET }
    );
  });
});

describe("proveSecretWith", () => {
  /** A database whose only encrypted token is `stored` */
  const holding = (stored) => async () => ({
    rows: stored === undefined ? [] : [{ accessToken: stored }],
  });

  it("proves the secret a sign-in encrypted with", async () => {
    const { symmetricEncrypt } = await import("better-auth/crypto");
    const stored = await symmetricEncrypt({ key: SECRET, data: TOKEN });

    assert.equal(await proveSecretWith(SECRET)(holding(stored)), "proven");
  });

  it("calls another secret wrong", async () => {
    const { symmetricEncrypt } = await import("better-auth/crypto");
    const stored = await symmetricEncrypt({ key: SECRET, data: TOKEN });

    assert.equal(
      await proveSecretWith("another-secret-".repeat(4))(holding(stored)),
      "wrong"
    );
  });

  it("cannot judge the secret before any token is encrypted", async () => {
    assert.equal(await proveSecretWith(SECRET)(holding(undefined)), "unproven");
  });
});

// `yarn test-api` loads `.env`; without a database this suite skips. Every
// case runs in a transaction it rolls back, so the database's own rows are
// read but never changed.
const DB = process.env.DATABASE_URL;

describe(
  "encrypt-github-tokens against Postgres",
  { skip: !DB && "DATABASE_URL not set" },
  () => {
    /**
     * Runs `body` in a transaction it rolls back, over a GitHub account row
     * holding `TOKEN` in plaintext and no refresh token
     */
    const withPlaintextRow = async (body) => {
      const { default: pg } = await import("pg");
      const client = new pg.Client({ connectionString: DB });
      await client.connect();
      const query = (text, params) => client.query(text, params);
      try {
        await query("begin");
        await query(
          `insert into "user" (id, name, email, "emailVerified")
           values ('test-user-encrypt', 'Test', 'encrypt@example.com', false)`
        );
        await query(
          `insert into account (id, "accountId", "providerId", "userId", "accessToken", "updatedAt")
           values ('test-account-encrypt', '42', 'github', 'test-user-encrypt', $1, now())`,
          [TOKEN]
        );
        await body(query);
      } finally {
        await query("rollback");
        await client.end();
      }
    };

    it("encrypts the row's token and leaves no plaintext row", async () => {
      await withPlaintextRow(async (query) => {
        const result = await encryptPlaintextTokensWith(SECRET)(query);

        assert.ok(result.encrypted >= 1);
        const { rows } = await query(
          `select "accessToken" from account where id = 'test-account-encrypt'`
        );
        assert.ok(isEncrypted(rows[0].accessToken));
        assert.deepEqual(await readPlaintextRows(query), []);
      });
    });

    // The guard is SQL the in-memory fake does not read: this runs it, null
    // refresh token included, which `=` would never match
    it("keeps the token a sign-in wrote between the read and the write", async () => {
      await withPlaintextRow(async (query) => {
        const SIGNED_IN = "ab12";
        let isRewritten = false;
        const signingIn = async (text, params) => {
          if (!isRewritten && text.includes("update account")) {
            isRewritten = true;
            await query(
              `update account set "accessToken" = $1 where id = 'test-account-encrypt'`,
              [SIGNED_IN]
            );
          }
          return query(text, params);
        };

        const result = await encryptPlaintextTokensWith(SECRET)(signingIn);

        const { rows } = await query(
          `select "accessToken" from account where id = 'test-account-encrypt'`
        );
        assert.equal(rows[0].accessToken, SIGNED_IN);
        assert.ok(result.changedMeanwhile >= 1);
      });
    });
  }
);
