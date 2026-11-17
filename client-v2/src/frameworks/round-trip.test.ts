// A file of its own: the test needs the real Anchor and Native frameworks,
// which import the `utils` barrel, and the barrel needs a boot-time global
// and the wasm packages; `utils/framework.ts`'s own tests avoid the barrel.
//
// Settings › Export project downloads a zip, and Import › From files took
// the zip as one text file: nothing in it looked like a program, so the
// project was refused with "No program code found" (HOO-2691).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  PgCommon,
  PgExplorer,
  PgFramework,
  PgTutorial,
  TupleFiles,
} from "../utils";
import { anchor } from "./anchor/anchor";
import { native } from "./native/native";

// `settings.ts`, reached through the `utils` barrel, reads a global that
// only exists once the app has booted
vi.hoisted(() => {
  vi.stubGlobal("GLOBAL_SETTINGS", { default: {} });
});

// The wasm packages are built separately and absent from a plain checkout
vi.mock("../utils/package", () => ({ PgPackage: {} }));

const sorted = (files: TupleFiles) =>
  files.slice().sort(([a], [b]) => a.localeCompare(b));

/** A project of each framework, as the editor holds it */
const PROJECTS: {
  framework: typeof anchor | typeof native;
  files: TupleFiles;
}[] = [
  {
    framework: anchor,
    files: [
      [
        "src/lib.rs",
        "use anchor_lang::prelude::*;\n\n#[program]\nmod hello {\n    use super::*;\n}\n",
      ],
      ["client/client.ts", 'console.log("client");\n'],
      ["tests/anchor.test.ts", 'describe("hello", () => {});\n'],
    ],
  },
  {
    framework: native,
    files: [
      [
        "src/lib.rs",
        "use solana_program::entrypoint;\n\nentrypoint!(process_instruction);\n",
      ],
      ["client/client.ts", 'console.log("client");\n'],
      ["tests/native.test.ts", 'describe("hello", () => {});\n'],
    ],
  },
];

/** What the browser hands the drop zone for a downloaded zip */
const asDropped = (name: string, blob: Blob) =>
  Object.assign(new File([blob], name), { path: `./${name}` });

describe("export a project, then import its zip", () => {
  beforeAll(async () => {
    // Set at boot by `globals/`, which this test does not load
    PgFramework.all = [anchor, native];
    PgTutorial.all = [];
    await PgExplorer.init();
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(PROJECTS)(
    "brings a $framework.name project back with the same files",
    async ({ framework, files }) => {
      const name = `round-trip-${framework.name.toLowerCase()}`;
      await PgExplorer.createWorkspace(name, {
        files: files.map(([path, content]) => [`/${name}/${path}`, content]),
      });
      const exported = vi
        .spyOn(PgCommon, "export")
        .mockImplementation(() => {});

      await PgFramework.exportWorkspace();
      const [fileName, blob] = exported.mock.calls[0] as [string, Blob];
      const imported = await PgFramework.importFiles([
        asDropped(fileName, blob),
      ]);

      expect(await PgFramework.getFromFiles(imported)).toBe(framework);
      expect(sorted(imported)).toEqual(sorted(files));
    }
  );

  it("brings back an unmarked program with the same files", async () => {
    const files: TupleFiles = [
      ["src/lib.rs", "// Import anchor"],
      ["client/client.ts", 'console.log("client");\n'],
      ["tests/a.test.ts", 'describe("a", () => {});\n'],
      ["README.md", "# Notes\n"],
    ];
    await PgExplorer.createWorkspace("unmarked", {
      files: files.map(([path, content]) => [`/unmarked/${path}`, content]),
    });
    const exported = vi.spyOn(PgCommon, "export").mockImplementation(() => {});

    await PgFramework.exportWorkspace();
    const [fileName, blob] = exported.mock.calls[0] as [string, Blob];
    const imported = await PgFramework.importFiles([asDropped(fileName, blob)]);

    expect(sorted(imported)).toEqual(sorted(files));
  });

  it("keeps the folder of a project with only tests", async () => {
    const files: TupleFiles = [
      ["tests/rpc.test.ts", 'import fixture from "./fixture.json";\n'],
      ["tests/fixture.json", "{}\n"],
    ];
    await PgExplorer.createWorkspace("only-tests", {
      files: files.map(([path, content]) => [`/only-tests/${path}`, content]),
    });
    const exported = vi.spyOn(PgCommon, "export").mockImplementation(() => {});

    await PgFramework.exportWorkspace();
    const [fileName, blob] = exported.mock.calls[0] as [string, Blob];
    const imported = await PgFramework.importFiles([asDropped(fileName, blob)]);

    expect(sorted(imported)).toEqual(sorted(files));
  });
});
