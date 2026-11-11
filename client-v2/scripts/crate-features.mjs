// What the editor's Rust Analyzer needs from a lockfile's resolution beyond the
// sources: each crate's features, without which items behind
// `#[cfg(feature = ...)]` vanish, and the names crates import each other under.

/**
 * Features per crate version, from `cargo metadata --format-version 1`.
 *
 * Keyed by `name@version`: a lock holds several versions of one crate
 * (`solana-pubkey` 3 and 4), each with its own features.
 *
 * @param {{ packages: { id: string, name: string, version: string }[], resolve: { nodes: { id: string, features: string[] }[] } }} metadata
 * @returns {Map<string, string[]>}
 */
export const featuresByCrate = (metadata) => {
  const packages = new Map(metadata.packages.map((p) => [p.id, p]));
  const features = new Map();
  for (const node of metadata.resolve.nodes) {
    const pkg = packages.get(node.id);
    if (pkg)
      features.set(`${pkg.name}@${pkg.version}`, [...node.features].sort());
  }
  return features;
};

/**
 * The features the root manifest declares on each of its normal dependencies, from `cargo metadata --format-version 1`.
 * The manifest's own lists, not the resolution's, which unifies every dependent's features into each crate.
 *
 * @param {{ packages: { id: string, dependencies: { name: string, kind: string | null, features: string[] }[] }[], resolve: { root: string } }} metadata
 * @returns {{ [name: string]: string[] }} only the dependencies that declare features
 */
export const declaredFeatures = (metadata) => {
  const root = metadata.packages.find((p) => p.id === metadata.resolve.root);
  if (!root) throw new Error("`cargo metadata` names no root package");
  return Object.fromEntries(
    root.dependencies
      .filter((dep) => dep.kind === null && dep.features.length)
      .map((dep) => [dep.name, dep.features])
  );
};

/**
 * The normal dependencies each crate imports under a name other than the
 * package's own (`alias = { package = "x" }`, or a `[lib] name`), from
 * `cargo metadata --format-version 1`, keyed by `name@version`.
 *
 * @param {{ packages: { id: string, name: string, version: string }[], resolve: { nodes: { id: string, deps: { name: string, pkg: string, dep_kinds: { kind: string | null }[] }[] }[] } }} metadata
 * @returns {Map<string, { alias: string, name: string, version: string }[]>}
 */
export const renamedDependencies = (metadata) => {
  const packages = new Map(metadata.packages.map((p) => [p.id, p]));
  const renamed = new Map();
  for (const node of metadata.resolve.nodes) {
    const pkg = packages.get(node.id);
    if (!pkg) continue;
    const aliases = node.deps.flatMap((dep) => {
      const target = packages.get(dep.pkg);
      const isNormal = dep.dep_kinds.some((k) => k.kind === null);
      if (!target || !isNormal) return [];
      if (dep.name === target.name.replaceAll("-", "_")) return [];
      return [{ alias: dep.name, name: target.name, version: target.version }];
    });
    if (aliases.length) renamed.set(`${pkg.name}@${pkg.version}`, aliases);
  }
  return renamed;
};

/**
 * The manifest Rust Analyzer reads for a crate, with its enabled features
 * appended where `world_state.rs` (`add_crate`) looks for them. Not
 * `[package.metadata.playground]`: serde, syn, tokio and others declare that
 * table for the Rust Playground, and a second one is a duplicate TOML table.
 *
 * @param {string[]} features
 * @returns {(manifest: string) => string}
 */
export const appendFeaturesWith = (features) => (manifest) =>
  `${manifest.trimEnd()}\n\n[package.metadata.solana-playground]\nfeatures = ${JSON.stringify(
    features
  )}\n`;
