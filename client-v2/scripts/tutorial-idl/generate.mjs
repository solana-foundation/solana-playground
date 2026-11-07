#!/usr/bin/env node
// Writes each tutorial step's `idl`: the Anchor IDL of the step's target
// program, generated with the generator Anchor 1.1.2's own CLI runs
// (anchor-lang-idl 0.1.4, `generator/`) and minified to one JSON string. Only
// a step whose IDL differs from the one before it carries one (HOO-2688).
//
// Needs a Rust toolchain; the crates resolve offline once fetched. Run after
// changing a tutorial's program: `yarn tutorial:idl [<tutorial>...]`.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";

const here = dirname(fileURLToPath(import.meta.url));
const tutorials = join(here, "../../src/tutorials");
const program = join(here, "program");
const PROGRAM_FILE = "src/lib.rs";

const cargo = (args) =>
  execFileSync("cargo", args, {
    cwd: here,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

/** Writes the scratch program's source, which git does not track */
const writeProgram = (source) => {
  mkdirSync(join(program, "src"), { recursive: true });
  writeFileSync(join(program, "src/lib.rs"), source);
};

/** The IDL of one program source, minified; `where` names the step */
const idlOf = (source, where) => {
  writeProgram(source);
  const out = execFileSync(
    join(here, "target/debug/tutorial-idl-generator"),
    [program],
    { cwd: here, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
  );
  const last = out.trim().split("\n").at(-1);
  if (!last) throw new Error(`${where}: the generator printed no IDL`);
  return JSON.stringify(JSON.parse(last));
};

/** `idl` right after `target`, so every step reads in the same order */
const withIdl = (step, idl) => {
  const out = {};
  for (const [key, value] of Object.entries(step)) {
    if (key === "idl") continue;
    out[key] = value;
    if (key === "target" && idl) out.idl = idl;
  }
  return out;
};

const named = process.argv.slice(2);
const slugs = readdirSync(tutorials, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith("__"))
  .map((e) => e.name)
  .filter((slug) => existsSync(join(tutorials, slug, "tutorial.json")))
  .filter((slug) => !named.length || named.includes(slug));
const unknown = named.filter((slug) => !slugs.includes(slug));
if (unknown.length) {
  console.error(`No such tutorial: ${unknown.join(", ")}`);
  process.exit(1);
}

// Cargo loads every workspace member, and the program's source is untracked:
// a fresh clone has none until the first step writes it
if (!existsSync(join(program, "src/lib.rs"))) writeProgram("");
cargo(["build", "--quiet", "-p", "tutorial-idl-generator"]);

for (const slug of slugs) {
  const path = join(tutorials, slug, "tutorial.json");
  const definition = JSON.parse(readFileSync(path, "utf8"));
  if (definition.framework !== "Anchor") continue;
  let previous;
  definition.steps = definition.steps.map((step) => {
    const source = step.target?.[PROGRAM_FILE] ?? step.start?.[PROGRAM_FILE];
    if (!source) return withIdl(step, undefined);
    const idl = idlOf(source, `${slug} ${step.id}`);
    const changed = idl !== previous;
    previous = idl;
    console.log(`${slug} ${step.id}: ${changed ? "IDL" : "same"}`);
    return withIdl(step, changed ? idl : undefined);
  });
  // Formatted as `check-format` wants it, so only the IDLs show in the diff
  const options = (await prettier.resolveConfig(path)) ?? {};
  writeFileSync(
    path,
    // Indented first: prettier keeps an object expanded only when its input
    // already has a line break after the opening brace
    await prettier.format(JSON.stringify(definition, null, 2), {
      ...options,
      filepath: path,
    })
  );
}
