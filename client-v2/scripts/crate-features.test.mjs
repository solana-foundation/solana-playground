import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendFeaturesWith,
  declaredFeatures,
  featuresByCrate,
  renamedDependencies,
} from "./crate-features.mjs";

test("appends the features table the editor's Rust Analyzer reads", () => {
  const manifest = appendFeaturesWith(["serde", "std"])(
    '[package]\nname = "x"\nversion = "1.0.0"\n\n'
  );

  // `get_enabled_features` in `wasm/rust-analyzer/src/utils.rs` reads this table; a rename there must change it here
  assert.equal(
    manifest,
    '[package]\nname = "x"\nversion = "1.0.0"\n\n[package.metadata.solana-playground]\nfeatures = ["serde","std"]\n'
  );
});

test("lists the root's declared features on its normal dependencies only", () => {
  const features = declaredFeatures({
    packages: [
      {
        id: "anchor-lang",
        dependencies: [
          { name: "anchor-lang-idl", kind: null, features: ["convert"] },
        ],
      },
      {
        id: "solpg",
        dependencies: [
          { name: "anchor-lang", kind: null, features: ["init-if-needed"] },
          { name: "arrayref", kind: null, features: [] },
          { name: "proptest", kind: "dev", features: ["std"] },
        ],
      },
    ],
    resolve: { root: "solpg" },
  });

  assert.deepEqual(features, { "anchor-lang": ["init-if-needed"] });
});

test("keeps each version of a crate's own features", () => {
  const features = featuresByCrate({
    packages: [
      {
        id: "reg#solana-pubkey@3.0.0",
        name: "solana-pubkey",
        version: "3.0.0",
      },
      {
        id: "reg#solana-pubkey@4.3.0",
        name: "solana-pubkey",
        version: "4.3.0",
      },
    ],
    resolve: {
      nodes: [
        { id: "reg#solana-pubkey@4.3.0", features: ["std"] },
        { id: "reg#solana-pubkey@3.0.0", features: ["serde", "bytemuck"] },
      ],
    },
  });

  assert.deepEqual(features.get("solana-pubkey@3.0.0"), ["bytemuck", "serde"]);
  assert.deepEqual(features.get("solana-pubkey@4.3.0"), ["std"]);
});

test("lists only the dependencies a crate imports under another name", () => {
  const packages = [
    { id: "a", name: "solana-address", version: "1.1.0" },
    { id: "b", name: "solana-address", version: "2.7.0" },
    { id: "c", name: "five8-const", version: "1.0.0" },
  ];
  const normal = [{ kind: null }];
  const renamed = renamedDependencies({
    packages,
    resolve: {
      nodes: [
        {
          id: "a",
          deps: [
            { name: "solana_address_v2", pkg: "b", dep_kinds: normal },
            { name: "five8_const", pkg: "c", dep_kinds: normal },
          ],
        },
      ],
    },
  });

  assert.deepEqual(renamed.get("solana-address@1.1.0"), [
    { alias: "solana_address_v2", name: "solana-address", version: "2.7.0" },
  ]);
});
