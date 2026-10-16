import { createSetting } from "../create";

export const experimental = [
  createSetting({
    id: "experimental.unstable",
    description:
      "Whether to use the build server's unstable routes: sandboxed builds and the package bundler. Needs a server built with the unstable feature",
    // Upstream defaults this to `NODE_ENV !== "production"`. This fork
    // develops against hosted servers, none of which enable the feature,
    // so the switch is off everywhere and turning it on is deliberate (D37)
    default: false,
  }),
];
