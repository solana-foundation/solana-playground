import assert from "node:assert/strict";
import { test } from "node:test";

import { featuresByCrate, renamedDependencies } from "./crate-features.mjs";

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
