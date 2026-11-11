// Loaded alone: server-release.yml runs it with bare `node`, before any install, so it imports nothing but node's own modules
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** gcloud's own test for all traffic: `_ALL_TRAFFIC_EPSILON = 1e-4` in api_lib/app/version_util.py. Its smallest real split is 0.001, so a live 0.999 is a split */
const ALL_TRAFFIC = 1 - 1e-4;
const VERSION_FORMAT = /^[a-z0-9][a-z0-9.-]*$/;

/** Refuses a list it cannot fully read: a wrong guess here moves production traffic */
function getVersions(versions) {
  if (!Array.isArray(versions)) {
    throw new Error("Unreadable version list: not an array");
  }
  if (versions.length === 0) throw new Error("No versions in the list");
  return versions.map((record) => {
    const id = record?.id;
    const split = record?.traffic_split;
    const status = record?.version?.servingStatus;
    const createdAt = Date.parse(record?.version?.createTime);
    if (
      typeof id !== "string" ||
      typeof split !== "number" ||
      typeof status !== "string" ||
      Number.isNaN(createdAt)
    ) {
      throw new Error(
        `Unreadable version list: ${JSON.stringify(
          record
        )} lacks id, traffic_split, version.servingStatus or version.createTime`
      );
    }
    return { id, split, status, createdAt };
  });
}

/**
 * Picks the version to send all traffic to: the requested one, or with none requested, the newest serving version created before
 * the live one. `current` is undefined when no single version holds all traffic. The list does not say which versions were ever live, so a
 * parked version that never was counts as the one before.
 * @param {string} requested a version label or git tag, or empty to roll back
 * @param {unknown[]} versions `gcloud app versions list --format=json`
 * @returns {{ current: string | undefined, target: string, isChanged: boolean }}
 * @throws {Error} on a malformed request, an unreadable list, or no usable target; the message says why
 */
export function selectTarget(requested, versions) {
  if (requested && !VERSION_FORMAT.test(requested)) {
    throw new Error(`Malformed version ${JSON.stringify(requested)}`);
  }
  const list = getVersions(versions);
  const live = list.find(({ split }) => split >= ALL_TRAFFIC);
  const current = live?.id;

  if (requested) {
    // The label a tag deploys under: cicd.yml replaces its periods with dashes
    const label = requested.replaceAll(".", "-");
    const named = list.find(({ id }) => id === label);
    if (!named) {
      const known = list.map(({ id }) => id).join(", ");
      throw new Error(`Unknown version "${label}"; existing: ${known}`);
    }
    if (named.status !== "SERVING") {
      throw new Error(`Version "${label}" is ${named.status}, not SERVING`);
    }
    return { current, target: label, isChanged: label !== current };
  }

  if (!live) {
    throw new Error("Traffic is split between versions; name a version");
  }
  const previous = list
    .filter(
      ({ status, createdAt }) =>
        status === "SERVING" && createdAt < live.createdAt
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!previous) {
    throw new Error(
      `Nothing to roll back to: no serving version before "${live.id}"`
    );
  }
  return { current, target: previous.id, isChanged: true };
}

/**
 * @param {string} target the version label that should now be live
 * @param {unknown[]} versions `gcloud app versions list --format=json`
 * @throws {Error} unless `target` holds all traffic
 */
export function assertLive(target, versions) {
  const live = getVersions(versions).find(({ id }) => id === target);
  if (!live || live.split < ALL_TRAFFIC) {
    throw new Error(`Version "${target}" does not hold all traffic`);
  }
}

/**
 * @param {unknown[]} versions `gcloud app versions list --format=json`
 * @returns {string} one summary line per version receiving traffic, with its share
 * @throws {Error} on an unreadable list
 */
export function describeTraffic(versions) {
  return getVersions(versions)
    .filter(({ split }) => split > 0)
    .map(({ id, split }) => `- \`${id}\`: ${split}`)
    .join("\n");
}

function main(mode) {
  let versions;
  try {
    versions = JSON.parse(readFileSync(0, "utf8"));
  } catch (error) {
    throw new Error(`Unreadable version list: ${error.message}`, {
      cause: error,
    });
  }
  if (mode === "verify") {
    assertLive(process.env.TARGET_VERSION ?? "", versions);
    return;
  }
  if (mode === "traffic") {
    console.log(describeTraffic(versions));
    return;
  }
  if (mode !== "select") throw new Error(`Unknown mode ${mode}`);
  const { current, target, isChanged } = selectTarget(
    process.env.REQUESTED_VERSION ?? "",
    versions
  );
  console.log(
    `current=${current ?? "split"}\ntarget=${target}\nchanged=${isChanged}`
  );
}

// Realpath: if this ever read false on a CI path, `verify` would exit 0 having checked nothing
if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv[2]);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
