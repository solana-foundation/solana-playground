import { createSetting } from "../create";

export const experimental = [
  createSetting({
    id: "experimental.unstable",
    description: "Whether to enable unstable features",
    default: process.env.NODE_ENV !== "production",
  }),
];
