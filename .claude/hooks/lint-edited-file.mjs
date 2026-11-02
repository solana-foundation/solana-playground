// PostToolUse hook for Edit|Write: hands the edited file's lint messages to the agent as additionalContext, never blocking.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PREAMBLE =
  "ESLint on the edited file. A new warning fails yarn lint once the total passes the --max-warnings cap; an error line always fails it:\n";

const respond = (context) =>
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: context,
      },
    })
  );

const reasonOf = (error) =>
  (error instanceof Error ? error.message : String(error)).split("\n")[0];

const isFile = (file) =>
  fs.statSync(file, { throwIfNoEntry: false })?.isFile() ?? false;

// The file's own checkout, so an edit in a worktree runs that worktree's script and config.
const checkoutOf = (file) => {
  try {
    return execFileSync(
      "git",
      ["-C", path.dirname(file), "rev-parse", "--show-toplevel"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
  } catch {
    // A file outside any git checkout has no lint config to run
    return undefined;
  }
};

// The text to hand the agent, or undefined when there is nothing to say.
const contextFor = async (stdin) => {
  const file = JSON.parse(stdin)?.tool_input?.file_path;
  if (typeof file !== "string" || !isFile(file)) return undefined;
  const root = checkoutOf(file);
  if (root === undefined || !file.startsWith(root + path.sep)) return undefined;
  const script = path.join(root, "client-v2", "scripts", "lint-changed.mjs");
  // A checkout from before the script existed has nothing to run
  if (!isFile(script)) return undefined;
  const { lintChanged } = await import(pathToFileURL(script).href);
  const report = await lintChanged([path.relative(root, file)]);
  return report === "" ? undefined : PREAMBLE + report;
};

try {
  const context = await contextFor(fs.readFileSync(0, "utf8"));
  if (context !== undefined) respond(context);
} catch (error) {
  respond(`lint-changed failed: ${reasonOf(error)}`);
}
