// Seals a build-cache archive so a production build takes back only what a production build stored.
//
// Remote Cache is shared by every build of the Vercel team, and anyone holding its token can write
// any entry (HOO-2887). A seal is an HMAC-SHA256 over the artifact key and the archive's bytes, under
// CACHE_SEAL_KEY, a secret set for the Production environment only: a preview build, a CI job or a
// token holder can replace an archive but cannot produce its seal. Binding the key stops a genuine
// archive of one wasm source tree from being replayed under another tree's key.
//
//   node scripts/cache-seal.mjs check                                prints `ready` when the secret is usable
//   node scripts/cache-seal.mjs sign <artifact key> <archive>         prints the seal, 64 hex characters
//   node scripts/cache-seal.mjs verify <artifact key> <archive> <seal> prints `sealed` and exits 0 when it matches,
//                                                                    prints `mismatch` and exits 1 when it does not
//
// Every success prints its word, and vercel-install.sh requires it: a run that never reached main (a
// changed entry-point guard, a crash before output) must not read as a pass. Exit 1 is a seal that
// does not match, 2 a usage error or a missing secret, 3 any other failure.

import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const SEAL_SECRET_VAR = "CACHE_SEAL_KEY";

// Changes only when the sealed message changes shape. Old seals then stop matching, and every production
// build would stop on them: ship a bump together with a CACHE_SEAL_KEY rotation, which moves to fresh names.
const SEAL_VERSION = "cache-seal-v1";

// Below this a secret is too easy to guess; `openssl rand -hex 32` gives 64 characters.
const MIN_SECRET_LENGTH = 32;

const SEAL_PATTERN = /^[0-9a-f]{64}$/;

/** @param {string} secret @param {string} cacheKey @param {string} file */
export async function sealFile(secret, cacheKey, file) {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(`${SEAL_VERSION}\n${cacheKey}\n`);
  for await (const chunk of fs.createReadStream(file)) hmac.update(chunk);
  return hmac.digest("hex");
}

/** A seal that is not exactly 64 lowercase hex characters never matches. */
export async function hasMatchingSeal(secret, cacheKey, file, seal) {
  const given = seal.trim();
  if (!SEAL_PATTERN.test(given)) return false;
  const expected = await sealFile(secret, cacheKey, file);
  return crypto.timingSafeEqual(
    Buffer.from(given, "hex"),
    Buffer.from(expected, "hex")
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

async function run([command, cacheKey, file, sealPath]) {
  const usage =
    {
      check: false,
      sign: !cacheKey || !file,
      verify: !cacheKey || !file || !sealPath,
    }[command] ?? true;
  if (usage) {
    console.error(
      "usage: cache-seal.mjs check | sign <artifact key> <archive> | verify <artifact key> <archive> <seal>"
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
  if (command === "check") {
    process.stdout.write("ready\n");
    return 0;
  }
  if (command === "sign") {
    process.stdout.write(`${await sealFile(secret, cacheKey, file)}\n`);
    return 0;
  }
  const seal = fs.readFileSync(sealPath, "utf8");
  if (!(await hasMatchingSeal(secret, cacheKey, file, seal))) {
    process.stdout.write("mismatch\n");
    return 1;
  }
  process.stdout.write("sealed\n");
  return 0;
}

/** @param {string[]} args */
export async function main(args) {
  try {
    return await run(args);
  } catch (error) {
    console.error(`>>> cache-seal: ${error.message}`);
    return 3;
  }
}

// realpath on both sides: a symlinked path to this file must still run main.
if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) ===
    fs.realpathSync(fileURLToPath(import.meta.url))
) {
  process.exitCode = await main(process.argv.slice(2));
}
