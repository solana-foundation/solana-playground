import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { esbuildMinifyOptions } from "./esbuild-minify.mjs";
import {
  assertPublicEnv,
  clientEnvNames,
  findSecretsInBuild,
  hasValueShape,
  publicEnvProblems,
  secretsOf,
} from "./public-env.mjs";

const clientDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const clientEnvPath = path.join("src", "shared", "config", "client-env.ts");

const ALLOWED = clientEnvNames(
  fs.readFileSync(path.join(clientDir, clientEnvPath), "utf8")
);

// Made up in the shape of production's values: Helius "fast" hostnames with a
// digit in the label, a DSN with a public key, a full commit sha
const PRODUCTION_LIKE = {
  REACT_APP_SERVER_URL: "https://api.solpg.io",
  REACT_APP_DEVNET_RPC_URL: "https://acme-q1w2e3-fast-devnet.helius-rpc.com",
  REACT_APP_MAINNET_RPC_URL: "https://acme-r4t5y6-fast-mainnet.helius-rpc.com",
  REACT_APP_TESTNET_RPC_URL: "https://api.testnet.solana.com",
  REACT_APP_SENTRY_DSN:
    "https://0123456789abcdef0123456789abcdef@o123456.ingest.us.sentry.io/4507",
  REACT_APP_GA_MEASUREMENT_ID: "G-ABC123XYZ9",
  REACT_APP_VERCEL_ENV: "production",
  REACT_APP_VERCEL_GIT_COMMIT_SHA: "58bed70ea0000000000000000000000000000000",
  REACT_APP_LOG_LEVEL: "warn",
  AUTH_SECRET: "a-long-random-server-secret",
  PG_AI_API_KEY: "vck_0123456789abcdef",
};

test("reads every REACT_APP_* name client-env.ts reads", () => {
  assert.deepEqual([...ALLOWED].sort(), [
    "REACT_APP_DEVNET_READ_BUFFER_RPC_URL",
    "REACT_APP_DEVNET_RPC_URL",
    "REACT_APP_DEVNET_SEND_TX_PER_SECOND",
    "REACT_APP_GA_MEASUREMENT_ID",
    "REACT_APP_LOG_LEVEL",
    "REACT_APP_MAINNET_READ_BUFFER_RPC_URL",
    "REACT_APP_MAINNET_RPC_URL",
    "REACT_APP_MAINNET_SEND_TX_PER_SECOND",
    "REACT_APP_SENTRY_DSN",
    "REACT_APP_SERVER_UNSTABLE",
    "REACT_APP_SERVER_URL",
    "REACT_APP_TESTNET_READ_BUFFER_RPC_URL",
    "REACT_APP_TESTNET_RPC_URL",
    "REACT_APP_TESTNET_SEND_TX_PER_SECOND",
    "REACT_APP_VERCEL_ENV",
    "REACT_APP_VERCEL_GIT_COMMIT_SHA",
  ]);
});

test("finds process.env.REACT_APP_* read in client-env.ts alone", () => {
  const readers = fs
    .readdirSync(path.join(clientDir, "src"), { recursive: true })
    .filter((file) => /\.(m?js|tsx?)$/.test(file))
    .filter((file) => !/\.(test|spec)\.|__tests__/.test(file))
    .map((file) => path.join("src", file))
    .filter((file) => file !== clientEnvPath)
    .filter((file) =>
      /process\.env\.REACT_APP_/.test(
        fs.readFileSync(path.join(clientDir, file), "utf8")
      )
    );
  assert.deepEqual(readers, []);
});

test("passes production's values", () => {
  assert.deepEqual(publicEnvProblems(ALLOWED, PRODUCTION_LIKE), []);
});

for (const [label, env, expected] of [
  [
    "fails a REACT_APP_* the client does not read",
    { REACT_APP_AUTH_SECRET: "x" },
    /REACT_APP_AUTH_SECRET is set, and the client does not read it/,
  ],
  [
    "fails one in lower case, which CRA inlines too",
    { react_app_token: "x" },
    /react_app_token is set/,
  ],
  [
    "fails an RPC key in the query",
    {
      REACT_APP_MAINNET_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=abc",
    },
    /REACT_APP_MAINNET_RPC_URL carries a credential in its query/,
  ],
  [
    "fails a token-shaped query value under a plain name",
    {
      REACT_APP_MAINNET_RPC_URL:
        "https://rpc.example.com/?id=abc123def456ghi789",
    },
    /REACT_APP_MAINNET_RPC_URL carries a credential in its query/,
  ],
  [
    "fails credentials before the host",
    { REACT_APP_SERVER_URL: "https://user:pass@api.example.com" },
    /REACT_APP_SERVER_URL carries credentials before the host/,
  ],
  [
    "fails a token in the path",
    {
      REACT_APP_DEVNET_RPC_URL:
        "https://acme-devnet.rpcpool.com/1b2c3d4e-5f60-7182-93a4-b5c6d7e8f901",
    },
    /REACT_APP_DEVNET_RPC_URL carries a token-shaped path segment/,
  ],
  [
    "fails a short key with a digit in the path",
    {
      REACT_APP_MAINNET_RPC_URL:
        "https://eth.example.com/v2/abc123def456ghi789",
    },
    /REACT_APP_MAINNET_RPC_URL carries a token-shaped path segment/,
  ],
  [
    "fails a mixed-case key without a digit in the path",
    {
      REACT_APP_MAINNET_RPC_URL:
        "https://eth.example.com/v2/AbCdEfGhIjKlMnOpQrStUvWxYz",
    },
    /REACT_APP_MAINNET_RPC_URL carries a token-shaped path segment/,
  ],
  [
    "fails a token in the fragment",
    { REACT_APP_SERVER_URL: "https://api.example.com/#abc123def456ghi789" },
    /REACT_APP_SERVER_URL carries a token-shaped fragment/,
  ],
  [
    "fails a Sentry auth token in place of the DSN",
    { REACT_APP_SENTRY_DSN: "sntrys_abcdef" },
    [
      /REACT_APP_SENTRY_DSN holds a value shaped like a token/,
      /REACT_APP_SENTRY_DSN is not a Sentry DSN, an https URL/,
    ],
  ],
  [
    "fails a DSN with the legacy secret key",
    { REACT_APP_SENTRY_DSN: "https://pub:secret@o1.ingest.sentry.io/2" },
    /legacy DSN secret key/,
  ],
  [
    "fails a DSN that is not a URL",
    { REACT_APP_SENTRY_DSN: "0123456789abcdef".repeat(4) },
    /REACT_APP_SENTRY_DSN is not a Sentry DSN, an https URL/,
  ],
  [
    "fails a DSN without a public key",
    { REACT_APP_SENTRY_DSN: "https://o1.ingest.sentry.io/2" },
    /REACT_APP_SENTRY_DSN is not a Sentry DSN: no public key/,
  ],
  [
    "fails a public value equal to a secret",
    {
      REACT_APP_SERVER_URL: "https://hunter2.example.com",
      AUTH_SECRET: "https://hunter2.example.com",
    },
    /REACT_APP_SERVER_URL has the value of AUTH_SECRET/,
  ],
  [
    "fails a public value equal to a URL with a password, whatever its name",
    {
      REACT_APP_SERVER_URL: "https://u:made-up-pass@db.example.com",
      POSTGRES_URL: "https://u:made-up-pass@db.example.com",
    },
    [
      /REACT_APP_SERVER_URL has the value of POSTGRES_URL/,
      /REACT_APP_SERVER_URL carries credentials before the host/,
    ],
  ],
  [
    "fails a token-shaped value",
    { REACT_APP_LOG_LEVEL: "sk-ant-api03-abc" },
    [
      /REACT_APP_LOG_LEVEL holds a value shaped like a token/,
      /REACT_APP_LOG_LEVEL is not a log level/,
    ],
  ],
  [
    "fails a restricted name that is not a URL the client reads",
    { PUBLIC_ENV_RESTRICTED_KEYS: "REACT_APP_LOG_LEVEL" },
    /PUBLIC_ENV_RESTRICTED_KEYS names REACT_APP_LOG_LEVEL/,
  ],
  [
    "fails a base64 key with + in a query value, as written",
    {
      REACT_APP_MAINNET_RPC_URL:
        "https://rpc.example.com/?x=AbCdEf12+GhIjKl34+MnOp56",
    },
    /REACT_APP_MAINNET_RPC_URL carries a credential in its query/,
  ],
  [
    "fails a key with %2F in a query value, as written",
    {
      REACT_APP_MAINNET_RPC_URL:
        "https://rpc.example.com/?x=AbCdEf12%2FGhIjKl34%2FMnOp56",
    },
    /REACT_APP_MAINNET_RPC_URL carries a credential in its query/,
  ],
  [
    "fails a key-like query name written percent-encoded",
    { REACT_APP_MAINNET_RPC_URL: "https://rpc.example.com/?k%65y=abc123" },
    /REACT_APP_MAINNET_RPC_URL carries a credential in its query/,
  ],
  [
    "fails a bare token in the query",
    {
      REACT_APP_MAINNET_RPC_URL: "https://rpc.example.com/?abc123def456ghi789",
    },
    /REACT_APP_MAINNET_RPC_URL carries a credential in its query/,
  ],
  [
    "fails credentials before the host of a restricted URL",
    {
      REACT_APP_MAINNET_RPC_URL: "https://u:p@rpc.example.com",
      PUBLIC_ENV_RESTRICTED_KEYS: "REACT_APP_MAINNET_RPC_URL",
    },
    /REACT_APP_MAINNET_RPC_URL carries credentials before the host/,
  ],
  [
    "fails only the unrestricted URL when another one is restricted",
    {
      REACT_APP_MAINNET_RPC_URL: "https://mainnet.example.com/?api-key=abc",
      REACT_APP_DEVNET_RPC_URL: "https://devnet.example.com/?api-key=abc",
      PUBLIC_ENV_RESTRICTED_KEYS: "REACT_APP_MAINNET_RPC_URL",
    },
    /REACT_APP_DEVNET_RPC_URL carries a credential in its query/,
  ],
  [
    "fails a restricted URL holding a token-prefixed value",
    {
      REACT_APP_MAINNET_RPC_URL: "postgres://rpc.example.com/db",
      PUBLIC_ENV_RESTRICTED_KEYS: "REACT_APP_MAINNET_RPC_URL",
    },
    /REACT_APP_MAINNET_RPC_URL holds a value shaped like a token/,
  ],
  [
    "fails a URL variable that is not a URL",
    { REACT_APP_SERVER_URL: "api.solpg.io" },
    /REACT_APP_SERVER_URL is not a URL/,
  ],
  [
    "fails a log level outside the logger's levels",
    { REACT_APP_LOG_LEVEL: "verbose" },
    /REACT_APP_LOG_LEVEL is not a log level/,
  ],
  [
    "fails a send rate that is not a number",
    { REACT_APP_DEVNET_SEND_TX_PER_SECOND: "fast" },
    /REACT_APP_DEVNET_SEND_TX_PER_SECOND is not a number/,
  ],
  [
    "fails a GA id that is not a GA4 id",
    { REACT_APP_GA_MEASUREMENT_ID: "UA-12345-1" },
    /REACT_APP_GA_MEASUREMENT_ID is not a GA4 measurement id/,
  ],
  [
    "fails an unstable flag that is not a boolean",
    { REACT_APP_SERVER_UNSTABLE: "yes" },
    /REACT_APP_SERVER_UNSTABLE is not a boolean/,
  ],
  [
    "fails a Vercel environment outside Vercel's three",
    { REACT_APP_VERCEL_ENV: "staging" },
    /REACT_APP_VERCEL_ENV is not a Vercel environment/,
  ],
  [
    "fails a commit sha that is not hex",
    { REACT_APP_VERCEL_GIT_COMMIT_SHA: "main" },
    /REACT_APP_VERCEL_GIT_COMMIT_SHA is not a commit sha/,
  ],
]) {
  test(label, () => {
    const patterns = Array.isArray(expected) ? expected : [expected];
    const problems = publicEnvProblems(ALLOWED, env);
    assert.equal(problems.length, patterns.length, problems.join("\n"));
    patterns.forEach((pattern, i) => assert.match(problems[i], pattern));
  });
}

test("gives every name client-env.ts reads a value shape", () => {
  assert.deepEqual(
    [...ALLOWED].filter((name) => !hasValueShape(name)),
    []
  );
});

test("passes every log level the logger accepts", () => {
  for (const level of ["panic", "error", "warn", "info", "debug"]) {
    assert.deepEqual(
      publicEnvProblems(ALLOWED, { REACT_APP_LOG_LEVEL: level }),
      []
    );
  }
});

test("throws from assertPublicEnv naming the variable, never the value", () => {
  assert.doesNotThrow(() => assertPublicEnv(PRODUCTION_LIKE));
  assert.throws(
    () => assertPublicEnv({ REACT_APP_AUTH_SECRET: "VALUE1234" }),
    (error) =>
      error.message.includes("REACT_APP_AUTH_SECRET") &&
      !error.message.includes("VALUE1234")
  );
});

test("names variables in problems, never values", () => {
  const problems = publicEnvProblems(ALLOWED, {
    REACT_APP_MAINNET_RPC_URL: "https://x.example.com/?api-key=VALUE123",
    REACT_APP_OTHER: "VALUE123",
  });
  assert.equal(problems.length, 2);
  assert.ok(problems.every((problem) => !problem.includes("VALUE123")));
});

test("lets a restricted RPC key through", () => {
  const env = {
    REACT_APP_MAINNET_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=abc",
    PUBLIC_ENV_RESTRICTED_KEYS: " REACT_APP_MAINNET_RPC_URL ,",
  };
  assert.deepEqual(publicEnvProblems(ALLOWED, env), []);
});

test("passes an empty value", () => {
  assert.deepEqual(
    publicEnvProblems(ALLOWED, { REACT_APP_MAINNET_RPC_URL: "" }),
    []
  );
});

const withTempDir = (run) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "public-env-"));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test("collects secret names from the env and the .env files", () => {
  withTempDir((dir) => {
    fs.writeFileSync(
      path.join(dir, ".env"),
      "DATABASE_URL=postgres://u:p@host/db\nPG_AI_MODEL=some-long-model-name\n"
    );
    fs.writeFileSync(
      path.join(dir, ".env.local"),
      "GITHUB_CLIENT_SECRET=gh-secret-1\n"
    );
    const secrets = secretsOf(dir, {
      AUTH_SECRET: "auth-secret-1",
      SENTRY_AUTH_TOKEN: "short",
      REACT_APP_SERVER_URL: "https://api.solpg.io",
      PATH: "/usr/bin:/bin",
    });
    assert.deepEqual(secrets.map(([name]) => name).sort(), [
      "AUTH_SECRET",
      "DATABASE_URL",
      "GITHUB_CLIENT_SECRET",
    ]);
  });
});

test("finds a multiline secret escaped inside a string literal", () => {
  withTempDir((dir) => {
    const key =
      "-----BEGIN PRIVATE KEY-----\nMIIE/abc\n-----END PRIVATE KEY-----";
    fs.writeFileSync(
      path.join(dir, "main.js"),
      `var k=${JSON.stringify(key)};`
    );
    fs.writeFileSync(
      path.join(dir, "data.json"),
      JSON.stringify({ k: key }).replaceAll("/", "\\/")
    );
    assert.deepEqual(findSecretsInBuild([["PRIVATE_KEY", key]], dir).sort(), [
      "PRIVATE_KEY in data.json",
      "PRIVATE_KEY in main.js",
    ]);
  });
});

test("names the variable and the file of a secret in the build, not the value", () => {
  withTempDir((dir) => {
    fs.mkdirSync(path.join(dir, "static", "js"), { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), "<html></html>");
    fs.writeFileSync(
      path.join(dir, "static", "js", "main.js"),
      'var e={K:"auth-secret-1"};'
    );
    const found = findSecretsInBuild(
      [
        ["AUTH_SECRET", "auth-secret-1"],
        ["PG_AI_API_KEY", "vck_not_there"],
      ],
      dir
    );
    assert.deepEqual(found, [
      `AUTH_SECRET in ${path.join("static", "js", "main.js")}`,
    ]);
  });
});

// eslint-disable-next-line no-template-curly-in-string -- a dotenv reference, which dotenv-expand resolves
const PGPASS_REF = "${PGPASS}";

test("expands dotenv references in .env files as CRA does, and counts a URL with a password", () => {
  withTempDir((dir) => {
    fs.writeFileSync(
      path.join(dir, ".env"),
      "PGPASS=made-up-pass-1\n" +
        `DATABASE_URL=postgres://u:${PGPASS_REF}@host/db\n` +
        "POSTGRES_URL=postgres://u:made-up-pass-2@host/db\n"
    );
    const secrets = secretsOf(dir, { PATH: "/usr/bin:/bin" });
    assert.ok(
      secrets.some(
        ([name, value]) =>
          name === "DATABASE_URL" &&
          value === "postgres://u:made-up-pass-1@host/db"
      ),
      "the expanded value"
    );
    assert.ok(
      secrets.some(
        ([name, value]) =>
          name === "DATABASE_URL" &&
          value === `postgres://u:${PGPASS_REF}@host/db`
      ),
      "the literal value"
    );
    assert.ok(secrets.some(([name]) => name === "POSTGRES_URL"));
  });
});

/** A chunk as the production build minifies it */
const minify = async (code) => {
  const TerserPlugin = createRequire(import.meta.url)("terser-webpack-plugin");
  const { code: out } = await TerserPlugin.esbuildMinify(
    { "main.js": code },
    undefined,
    esbuildMinifyOptions()
  );
  return out;
};

test("finds a secret with quotes in the production minifier's output", async () => {
  const key = '{"type":"service_account","private_key":"made-up\\nkey"}';
  const withApostrophe = "made-up-it's-a-secret";
  const out = await minify(
    `window.a=${JSON.stringify(key)};window.b=${JSON.stringify(
      withApostrophe
    )};`
  );
  await withTempDirAsync(async (dir) => {
    fs.writeFileSync(path.join(dir, "main.js"), out);
    assert.deepEqual(
      findSecretsInBuild(
        [
          ["GCP_SERVICE_ACCOUNT_KEY", key],
          ["OTHER_SECRET", withApostrophe],
        ],
        dir
      ).sort(),
      ["GCP_SERVICE_ACCOUNT_KEY in main.js", "OTHER_SECRET in main.js"]
    );
  });
});

const withTempDirAsync = async (run) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "public-env-"));
  try {
    await run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

/** `node scripts/public-env.mjs <args>` with only `PATH` and `extra` set */
const runCli = (args, extra) =>
  spawnSync(
    process.execPath,
    [path.join(clientDir, "scripts", "public-env.mjs"), ...args],
    { encoding: "utf8", env: Object.assign({ PATH: process.env.PATH }, extra) }
  );

test("exits 1 from check-build on a secret in the build, naming it without the value", () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, "main.js"), 'var k="made-up-secret-42";');
    const run = runCli(["check-build", dir], {
      AUTH_SECRET: "made-up-secret-42",
    });
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, /AUTH_SECRET in main\.js/);
    assert.ok(!run.stderr.includes("made-up-secret-42"));
  });
});

test("exits 0 from check-build on a build without secrets", () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, "main.js"), 'var k="nothing here";');
    const run = runCli(["check-build", dir], {
      AUTH_SECRET: "made-up-secret-42",
    });
    assert.equal(run.status, 0, run.stderr);
  });
});

test("exits 2 from the CLI without a command", () => {
  assert.equal(runCli([], {}).status, 2);
});
