// Seals a build-cache archive so a production build takes back only what a production build stored.
//
// Remote Cache is shared by every build of the Vercel team, and anyone holding its token can write
// any entry (HOO-2887). A seal is an HMAC-SHA256 over the cache key and the archive's bytes, under
// CACHE_SEAL_KEY, a secret set for the Production environment only: a preview build, a CI job or a
// token holder can replace an archive but cannot produce its seal. Binding the key stops a genuine
// archive of one wasm source tree from being replayed under another tree's key.
//
//   node scripts/cache-seal.mjs check                               exit 0 when the secret is usable
//   node scripts/cache-seal.mjs sign <cache key> <archive>          prints the seal
//   node scripts/cache-seal.mjs verify <cache key> <archive> <seal>  exit 0 when it matches, 1 when not
//
// Exit 2 is a usage error or a missing secret. Used by scripts/vercel-install.sh.

import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const SEAL_SECRET_VAR = "CACHE_SEAL_KEY";

// Changes only when the sealed message changes shape, so old seals then stop matching.
const SEAL_VERSION = "cache-seal-v1";

// Below this a secret is too easy to guess; `openssl rand -hex 32` gives 64 characters.
const MIN_SECRET_LENGTH = 32;

/** @param {string} secret @param {string} cacheKey @param {string} file */
export async function sealFile(secret, cacheKey, file) {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(`${SEAL_VERSION}\n${cacheKey}\n`);
  for await (const chunk of fs.createReadStream(file)) hmac.update(chunk);
  return hmac.digest("hex");
}

/** @param {string} secret @param {string} cacheKey @param {string} file @param {string} seal */
export async function sealMatches(secret, cacheKey, file, seal) {
  const expected = Buffer.from(await sealFile(secret, cacheKey, file), "hex");
  const given = Buffer.from(seal.trim(), "hex");
  return (
    given.length === expected.length && crypto.timingSafeEqual(given, expected)
  );
}

/** @param {NodeJS.ProcessEnv} env */
export function sealSecret(env) {
  const secret = env[SEAL_SECRET_VAR] ?? "";
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `${SEAL_SECRET_VAR} is ${
        secret ? `shorter than ${MIN_SECRET_LENGTH} characters` : "unset"
      }; generate one with \`openssl rand -hex 32\``
    );
  }
  return secret;
}

async function main([command, cacheKey, file, sealPath]) {
  const usage =
    {
      check: false,
      sign: !cacheKey || !file,
      verify: !cacheKey || !file || !sealPath,
    }[command] ?? true;
  if (usage) {
    console.error(
      "usage: cache-seal.mjs check | sign <cache key> <archive> | verify <cache key> <archive> <seal>"
    );
    return 2;
  }
  let secret;
  try {
    secret = sealSecret(process.env);
  } catch (error) {
    console.error(
      `>>> ${error.message}. A production build needs it to verify its cache (docs/deploy-client-vercel.md, "Sealed production cache").`
    );
    return 2;
  }
  if (command === "check") return 0;
  if (command === "sign") {
    process.stdout.write(`${await sealFile(secret, cacheKey, file)}\n`);
    return 0;
  }
  return (await sealMatches(
    secret,
    cacheKey,
    file,
    fs.readFileSync(sealPath, "utf8")
  ))
    ? 0
    : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
