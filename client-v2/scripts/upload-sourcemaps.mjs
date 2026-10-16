// The last step of `build:bundle`: uploads the source maps to Sentry, then deletes every map,
// since Vercel would otherwise serve each one in `build/` publicly
import { execFileSync } from "child_process";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import { sourcemapsEnabled } from "./sourcemap-gate.mjs";

const SENTRY_ORG = "solana-fndn";
const SENTRY_PROJECT = "solana-playground";

const clientDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const buildDir = path.join(clientDir, "build");
const sentryCli = path.join(clientDir, "node_modules", ".bin", "sentry-cli");

/** Every `.map` file under `dir` */
const findMaps = async (dir) => {
  const entries = await fs.readdir(dir, { recursive: true });
  return entries
    .filter((entry) => entry.endsWith(".map"))
    .map((entry) => path.join(dir, entry));
};

/** Ends the build with `message`; only a configuration error gets here */
const fail = (message) => {
  console.error(`error: source maps: ${message}`);
  process.exit(1);
};

// `inject` stamps a debug id into each bundle and its map, which is how Sentry pairs them
const run = (command) =>
  execFileSync(
    sentryCli,
    [
      "sourcemaps",
      command,
      "--org",
      SENTRY_ORG,
      "--project",
      SENTRY_PROJECT,
      buildDir,
    ],
    { stdio: "inherit" }
  );

const enabled = sourcemapsEnabled(process.env);
const maps = await findMaps(buildDir);

if (!enabled && maps.length === 0) {
  console.log("source maps: off for this build, nothing to upload");
  process.exit(0);
}
if (!enabled) {
  console.warn(
    `warning: source maps: found ${maps.length} in a build that emits none; deleting them`
  );
} else if (maps.length === 0) {
  fail(
    "the gate is on but the build emitted none; check the devtool override in craco.config.js"
  );
} else if (!process.env.SENTRY_AUTH_TOKEN) {
  console.warn(
    "warning: SENTRY_AUTH_TOKEN is not set; source maps are not uploaded to Sentry"
  );
} else {
  try {
    run("inject");
    run("upload");
  } catch (error) {
    // A Sentry outage or a rejected token must not block a deploy, a hotfix included
    console.warn(
      `warning: source maps: upload failed (${error.message}); deploying without them`
    );
  }
}

await Promise.all(maps.map((map) => fs.rm(map)));
const left = await findMaps(buildDir);
if (left.length) fail(`${left.length} left in build/ after deleting`);
console.log(`source maps: deleted ${maps.length} from build/`);

if (
  enabled &&
  !process.env.SENTRY_AUTH_TOKEN &&
  process.env.VERCEL_ENV === "production"
) {
  fail(
    "SENTRY_AUTH_TOKEN is not set for a production build; set it in Vercel's environment variables"
  );
}
