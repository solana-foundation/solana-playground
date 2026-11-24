// Checks the build output preview.yml's `deploy` job unpacked from the `build`
// job's archive, before the Vercel CLI uploads it with the token. The `build`
// job ran the PR's code, so the archive is untrusted:
//
// - only .vercel/output and .vercel/project.json may be there;
// - no link may point out of .vercel/output: the CLI packs what a link points
//   at, so a link to a runner file, the deploy job's /proc/self/environ among
//   them, would upload it into the public deployment;
// - no function may name source files outside itself (`filePathMap` in its
//   .vc-config.json): the deploy job has no checkout to resolve them against,
//   so they would be missing, which `vercel build --standalone` prevents;
// - no test file may be a function: every file under api/ becomes a public
//   function unless client-v2/.vercelignore drops it, and a test there writes
//   to the database it is given (HOO-2175).
//
// Usage: node preview-check-output.mjs <folder holding .vercel>
// Prints one line per problem and exits 1 when there is any.

import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED = {
  root: [".vercel"],
  ".vercel": ["output", "project.json"],
};

const isInside = (root, target) => {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
};

/** @param {string} dir @returns {string[]} every path under `dir`, links not followed */
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? [full, ...walk(full)] : [full];
  });

/** @param {string} folder the folder holding .vercel @returns {string[]} the problems found */
export const outputProblems = (folder) => {
  const problems = [];
  const extra = (dir, allowed) =>
    readdirSync(dir)
      .filter((name) => !allowed.includes(name))
      .map((name) => path.relative(folder, path.join(dir, name)));

  for (const name of extra(folder, ALLOWED.root))
    problems.push(`unexpected entry: ${name}`);
  const vercel = path.join(folder, ".vercel");
  const output = path.join(vercel, "output");
  if (!lstatSync(vercel, { throwIfNoEntry: false })?.isDirectory())
    return [...problems, "no .vercel folder"];
  for (const name of extra(vercel, ALLOWED[".vercel"]))
    problems.push(`unexpected entry: ${name}`);
  if (!lstatSync(output, { throwIfNoEntry: false })?.isDirectory())
    return [...problems, "no .vercel/output folder"];

  for (const full of walk(output)) {
    const shown = path.relative(folder, full);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) {
      // Lexically, since the target may not exist; every link is checked, so
      // a chain of links stays inside too
      const target = path.resolve(path.dirname(full), readlinkSync(full));
      if (!isInside(output, target))
        problems.push(`link out of the output: ${shown}`);
    } else if (stat.isDirectory() && full.endsWith(".test.func")) {
      problems.push(`test file deployed as a function: ${shown}`);
    } else if (path.basename(full) === ".vc-config.json") {
      const { filePathMap } = JSON.parse(readFileSync(full, "utf8"));
      if (filePathMap && Object.keys(filePathMap).length)
        problems.push(`function names files outside itself: ${shown}`);
    }
  }
  return problems;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [folder] = process.argv.slice(2);
  if (!folder) {
    console.error("usage: preview-check-output.mjs <folder holding .vercel>");
    process.exit(2);
  }
  const problems = outputProblems(folder);
  for (const problem of problems) console.log(`::error::${problem}`);
  process.exit(problems.length ? 1 : 0);
}
