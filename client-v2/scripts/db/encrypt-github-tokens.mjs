#!/usr/bin/env node
/**
 * Encrypt the OAuth tokens that `account` rows still hold in plaintext
 * (HOO-2881).
 *
 * Better Auth encrypts every token it writes since `ACCOUNT_OPTIONS`
 * (`src/features/auth/model/auth.mjs`) turned `encryptOAuthTokens` on, and a
 * sign-in rewrites the row's token. A row written before that and not signed
 * in to since still holds the token as GitHub issued it. This encrypts those
 * rows exactly as Better Auth would, with `AUTH_SECRET`, so a row read directly
 * from the database holds no usable token.
 *
 *   DATABASE_URL=… AUTH_SECRET=… node scripts/db/encrypt-github-tokens.mjs           # count only
 *   DATABASE_URL=… AUTH_SECRET=… node scripts/db/encrypt-github-tokens.mjs --apply   # count, ask, encrypt
 *
 * `make -f client-v2/Makefile.vercel encrypt-production-github-tokens` runs it
 * against production with the Production environment's values.
 *
 * Safe to run again: an encrypted token is left alone. Each row is updated only
 * while it still holds the token read, so a sign-in in between wins. Every
 * ciphertext is decrypted back before it is written.
 *
 * Before it asks, `--apply` decrypts one token a sign-in has already encrypted
 * with the given `AUTH_SECRET`, and stops when that fails: a wrong secret would
 * encrypt every row with a key the deployment cannot read, and each affected
 * user would need one more sign-in. When no such token exists yet, it warns
 * instead: the secret cannot be checked, and the deploy that turned encryption
 * on may not have happened. `--apply` also needs a terminal for the typed
 * `yes`, so a run with no stdin stops rather than exiting quietly.
 */
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import pg from "pg";

/** The columns Better Auth encrypts under `encryptOAuthTokens` */
const COLUMNS = ["accessToken", "refreshToken"];

/**
 * Whether Better Auth reads a stored token as ciphertext: its versioned
 * envelope, or the bare hex a single `secret` produces. The same test as
 * `isLikelyEncrypted` in `better-auth/dist/oauth2/utils.mjs`, which decides
 * whether a stored token is decrypted at all. A GitHub token (`gho_…`) is
 * never hex.
 *
 * @param {string} token
 */
export const isEncrypted = (token) =>
  token.startsWith("$ba$") ||
  (token.length % 2 === 0 && /^[0-9a-f]+$/i.test(token));

/** @param {string | null} token */
const isPlaintext = (token) =>
  typeof token === "string" && token !== "" && !isEncrypted(token);

const SELECT = `select id, "accessToken", "refreshToken" from account
                 where coalesce("accessToken", '') <> ''
                    or coalesce("refreshToken", '') <> ''`;

/**
 * The rows holding at least one plaintext token.
 *
 * @param {(text: string, params?: unknown[]) => Promise<{ rows: any[] }>} query
 * @returns {Promise<{ id: string; accessToken: string | null; refreshToken: string | null }[]>}
 */
export const readPlaintextRows = async (query) => {
  const { rows } = await query(SELECT);
  return rows.filter((row) => COLUMNS.some((c) => isPlaintext(row[c])));
};

/**
 * Encrypt every plaintext token with `secret`, as Better Auth's `setTokenUtil`
 * does under a single `secret`.
 *
 * @param {string} secret `AUTH_SECRET`
 * @returns {(query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>)
 *   => Promise<{ encrypted: number; changedMeanwhile: number }>}
 */
export const encryptPlaintextTokensWith = (secret) => async (query) => {
  let encrypted = 0;
  let changedMeanwhile = 0;
  for (const row of await readPlaintextRows(query)) {
    const next = {};
    for (const column of COLUMNS) {
      const token = row[column];
      if (!isPlaintext(token)) {
        next[column] = token;
        continue;
      }
      const ciphertext = await symmetricEncrypt({ key: secret, data: token });
      const back = await symmetricDecrypt({ key: secret, data: ciphertext });
      if (back !== token)
        throw new Error(`row ${row.id}: ${column} does not decrypt back`);
      next[column] = ciphertext;
    }
    // `is not distinct from`: a column may be null, and `=` never matches null
    const { rowCount } = await query(
      `update account set "accessToken" = $2, "refreshToken" = $3
        where id = $1
          and "accessToken" is not distinct from $4
          and "refreshToken" is not distinct from $5`,
      [
        row.id,
        next.accessToken,
        next.refreshToken,
        row.accessToken,
        row.refreshToken,
      ]
    );
    if (rowCount === 1) encrypted += 1;
    else changedMeanwhile += 1;
  }
  return { encrypted, changedMeanwhile };
};

/**
 * The settings a run needs, or the reason it cannot start.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ ok: true; databaseUrl: string; secret: string } | { ok: false; reason: string }}
 */
export const getSettings = (env) => {
  if (!env.DATABASE_URL) return { ok: false, reason: "DATABASE_URL is unset" };
  if (!env.AUTH_SECRET)
    return {
      ok: false,
      reason:
        "AUTH_SECRET is unset: it must be the secret the deployment encrypts with",
    };
  // Better Auth then encrypts with that versioned key set, not `AUTH_SECRET`
  if (env.BETTER_AUTH_SECRETS)
    return {
      ok: false,
      reason:
        "BETTER_AUTH_SECRETS is set: this script encrypts with AUTH_SECRET only",
    };
  return { ok: true, databaseUrl: env.DATABASE_URL, secret: env.AUTH_SECRET };
};

/**
 * One stored access token a sign-in encrypted, in either shape `isEncrypted`
 * accepts. `$ba$` inside a quoted literal is text, not a dollar quote.
 */
const ENCRYPTED_SAMPLE = `select "accessToken" from account
                           where "accessToken" like '$ba$%'
                              or "accessToken" ~ '^([0-9a-fA-F]{2})+$'
                           limit 1`;

/**
 * Whether `secret` is the key the deployment encrypts with, judged by one
 * token a sign-in encrypted: `unproven` when there is none yet.
 *
 * @param {string} secret `AUTH_SECRET`
 * @returns {(query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>)
 *   => Promise<"proven" | "wrong" | "unproven">}
 */
export const proveSecretWith = (secret) => async (query) => {
  const { rows } = await query(ENCRYPTED_SAMPLE);
  const sample = rows[0]?.accessToken;
  if (!sample) return "unproven";
  try {
    await symmetricDecrypt({ key: secret, data: sample });
    return "proven";
  } catch {
    // A failed tag check is the answer itself: `main` stops and says why
    return "wrong";
  }
};

/** A typed `yes` on stdin; anything else is a no. `main` asks only from a terminal */
const isConfirmed = async () => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const reply = await rl.question("Encrypt them? Type yes to continue: ");
    return reply.trim() === "yes";
  } finally {
    rl.close();
  }
};

const main = async () => {
  const settings = getSettings(process.env);
  if (!settings.ok) {
    console.error(settings.reason);
    process.exit(1);
  }
  const isApply = process.argv.includes("--apply");
  const pool = new pg.Pool({ connectionString: settings.databaseUrl });
  const query = (text, params) => pool.query(text, params);
  try {
    const rows = await readPlaintextRows(query);
    console.log(`account rows holding a plaintext token: ${rows.length}`);
    if (!isApply || rows.length === 0) return;
    if (!process.stdin.isTTY) {
      console.error("--apply asks for a typed yes: run it from a terminal");
      process.exitCode = 1;
      return;
    }
    const secret = await proveSecretWith(settings.secret)(query);
    if (secret === "wrong") {
      console.error(
        "AUTH_SECRET does not decrypt a token a sign-in encrypted: it is not the deployment's secret"
      );
      process.exitCode = 1;
      return;
    }
    if (secret === "unproven")
      console.warn(
        "No token is encrypted yet, so AUTH_SECRET cannot be checked: continue only after the deploy that turned encryption on, with that deployment's secret"
      );
    if (!(await isConfirmed())) {
      console.error("aborted");
      process.exitCode = 1;
      return;
    }
    const { encrypted, changedMeanwhile } = await encryptPlaintextTokensWith(
      settings.secret
    )(query);
    console.log(`encrypted: ${encrypted}`);
    if (changedMeanwhile)
      console.log(
        `changed by a sign-in meanwhile, left as Better Auth wrote them: ${changedMeanwhile}`
      );
    const left = (await readPlaintextRows(query)).length;
    console.log(`plaintext rows left: ${left}`);
    if (left) process.exitCode = 1;
  } finally {
    await pool.end();
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
