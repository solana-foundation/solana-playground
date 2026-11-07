import { DEFAULT_BLOCK_EXPLORER, PgBlockExplorer } from "../../utils";
import { createSetting } from "../create";

export const blockExplorer = [
  createSetting({
    id: "blockExplorer.name",
    description: "Default block explorer to use",
    values: (): string[] => PgBlockExplorer.all.map((b) => b.name),
    default: DEFAULT_BLOCK_EXPLORER,
    migrate: { from: "other.blockExplorer" },
  }),
];
