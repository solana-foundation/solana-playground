import { SERVER_UNSTABLE } from "../../shared/config/client-env";
import { createSetting } from "../create";

export const experimental = [
  createSetting({
    id: "experimental.unstable",
    description:
      "Whether to build and deploy through the build server's unstable routes, which run each build in a sandbox. Needs a server built with the unstable feature",
    // Hosted servers have no unstable routes, so only a build configured for one turns it on
    default: SERVER_UNSTABLE === "true",
  }),
];
