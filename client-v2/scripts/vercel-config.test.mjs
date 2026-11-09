import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Vercel's schema (https://openapi.vercel.sh/vercel.json) caps these command
// fields at 256 characters (read 9 Nov 2026), and a longer one fails the
// deployment before any build starts. This reads the config rather than
// running Vercel because the refusal is about the config's text alone, and
// no local tool reproduces it: a 270-character buildCommand reached master
// once and only the deploy said so.
const MAX_COMMAND_LENGTH = 256;

const config = JSON.parse(
  readFileSync(new URL("../vercel.json", import.meta.url), "utf8")
);

const commands = [];
for (const field of [
  "buildCommand",
  "devCommand",
  "ignoreCommand",
  "installCommand",
]) {
  commands.push({ field, command: config[field] });
}
for (const [glob, fn] of Object.entries(config.functions ?? {})) {
  commands.push({
    field: `functions["${glob}"].installCommand`,
    command: fn.installCommand,
  });
}

for (const { field, command } of commands) {
  test(`keeps ${field} within Vercel's limit`, (t) => {
    // The schema allows null, which means Vercel's default command.
    if (command === undefined || command === null) {
      return t.skip(`${field} is not set`);
    }
    assert.equal(typeof command, "string", `${field} must be a string`);
    assert.ok(
      command.length <= MAX_COMMAND_LENGTH,
      `${field} is ${command.length} characters, over ${MAX_COMMAND_LENGTH}; ` +
        "move the chain into a script under scripts/"
    );
  });
}
