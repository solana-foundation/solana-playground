// The packages scripts may import: upstream's root list, plus the ones only
// client-v2 installs. The root file stays upstream's because upstream's client
// reads it too, and would fail to build on imports it does not install.
const fs = require("fs");
const path = require("path");

const CLIENT_PATH = path.join(__dirname, "..", "..");

/** @returns {{ global: Record<string, object>, importable: string[] }} */
const readSupportedPackages = () => {
  const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
  const root = read(path.join(CLIENT_PATH, "..", "supported-packages.json"));
  const own = read(path.join(CLIENT_PATH, "supported-packages.json"));
  return {
    global: root.global,
    importable: [...new Set([...root.importable, ...own.importable])].sort(),
  };
};

module.exports = { readSupportedPackages };
