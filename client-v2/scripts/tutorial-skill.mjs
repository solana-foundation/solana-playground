// Pack the tutorial-authoring skill: `yarn tutorial:skill [<out.zip>]`.
//
// Writes `client-v2/tutorial-author.zip` (or the path given, from the current
// folder) holding one folder,
// `tutorial-author/`, with `SKILL.md`, `AUTHORING.md` and
// `tutorial.schema.json`: the shape Claude installs as a skill. The
// repository keeps one copy of each file; the zip is built from them and
// never committed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const CLIENT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TUTORIALS = path.join(CLIENT, "src", "tutorials");

export const FOLDER = "tutorial-author";

/** Each file of the skill: its name in the zip and its source */
export const FILES = [
  ["SKILL.md", path.join(TUTORIALS, "SKILL.md")],
  ["AUTHORING.md", path.join(TUTORIALS, "AUTHORING.md")],
  ["tutorial.schema.json", path.join(TUTORIALS, "tutorial.schema.json")],
];

/** A fixed date, so the same files make the same zip */
const DATE = new Date("2026-01-01T00:00:00Z");

/** The skill as zip bytes */
export const pack = async () => {
  const zip = new JSZip();
  zip.file(FOLDER, "", { dir: true, date: DATE });
  for (const [name, source] of FILES) {
    zip.file(`${FOLDER}/${name}`, fs.readFileSync(source), { date: DATE });
  }
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    platform: "UNIX",
  });
};

/** Whether this file is the script node was started with, links resolved */
const isMain = () =>
  process.argv[1] !== undefined &&
  fs.realpathSync(process.argv[1]) ===
    fs.realpathSync(fileURLToPath(import.meta.url));

if (isMain()) {
  const out = path.resolve(
    process.argv[2] ?? path.join(CLIENT, `${FOLDER}.zip`)
  );
  fs.writeFileSync(out, await pack());
  console.log(
    `${path.relative(process.cwd(), out) || out}: ${FILES.map(([n]) => n).join(
      ", "
    )}`
  );
}
