import path from "node:path";
import browserslist from "browserslist";

/** browserslist family -> esbuild engine */
const ESBUILD_ENGINES = {
  chrome: "chrome",
  edge: "edge",
  firefox: "firefox",
  opera: "opera",
  safari: "safari",
  ios_saf: "ios",
};

/** -1, 0, or 1, comparing dotted versions segment by segment */
const compareVersions = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
};

/**
 * The `browserslist` floor as esbuild targets: the lowest version
 * per engine. Throws on a family with no esbuild engine: that browser would be
 * missing from the target and could get syntax it cannot parse.
 */
const esbuildTarget = () => {
  const lowest = new Map();
  const entries = browserslist(undefined, {
    path: path.join(import.meta.dirname, ".."),
  });
  for (const entry of entries) {
    const [family, range] = entry.split(" ");
    const engine = ESBUILD_ENGINES[family];
    if (!engine) {
      throw new Error(
        `craco: browserslist family "${family}" has no esbuild engine; ` +
          "map it in ESBUILD_ENGINES or drop it from the list"
      );
    }
    const version = range.split("-")[0];
    const known = lowest.get(engine);
    if (!known || compareVersions(version, known) < 0) {
      lowest.set(engine, version);
    }
  }
  return [...lowest].map(([engine, version]) => engine + version);
};

/** Options for `TerserPlugin.esbuildMinify` */
export const esbuildMinifyOptions = () => ({
  keepNames: true, // Decorators name change events after `_Pg*` classes; esbuild keeps all names or none
  format: "iife", // Scopes keepNames' helpers per chunk: as globals, their minified names collide
  target: esbuildTarget(),
});
