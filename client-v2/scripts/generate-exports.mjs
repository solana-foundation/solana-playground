// Generate file exports

import fs from "fs/promises";
import pathModule from "path";

import { CLIENT_PATH } from "./utils.mjs";

/** Name of the generated file (without extension) */
const GENERATED_FILENAME = "generated";

const srcPath = pathModule.join(CLIENT_PATH, "src");
for (const name of await fs.readdir(srcPath)) {
  const itemPath = pathModule.join(srcPath, name);
  const stat = await fs.stat(itemPath);
  if (!stat.isDirectory()) continue;

  const items = await fs
    .readdir(itemPath)
    .then((fileNames) => fileNames.map(pathModule.parse));
  const isExportable = items.some((item) => item.name === name);
  if (!isExportable) continue;

  const namesToSkip = [
    GENERATED_FILENAME,
    name,
    "index",
    "__template",
    "__tests__",
  ];
  const hasDir = items.some((item) => !item.ext);
  /**
   * Whether a folder is exported: one with an index is; a tutorial that is
   * only a `tutorial.json`, or a `_` folder of generated files, has nothing
   * to export; any other folder without an index is a mistake, and stops the
   * build as `export * from` it would
   */
  const exportsFolder = async (item) => {
    const dir = pathModule.join(itemPath, item.base);
    if (!(await fs.stat(dir)).isDirectory()) return false;
    const names = await fs.readdir(dir);
    if (names.some((file) => file.startsWith("index."))) return true;
    if (item.base.startsWith("_") || names.includes("tutorial.json")) {
      return false;
    }
    throw new Error(`${dir}: a folder with no index to export`);
  };
  const exportable = [];
  for (const item of items) {
    if (namesToSkip.includes(item.name)) continue;
    if (hasDir && (item.ext || !(await exportsFolder(item)))) continue;
    exportable.push(item);
  }
  const exports = exportable
    .map((item) => item.name)
    .reduce((acc, cur) => acc + `export * from "./${cur}";\n`, "");

  await fs.writeFile(
    pathModule.join(itemPath, `${GENERATED_FILENAME}.ts`),
    exports
  );
}
