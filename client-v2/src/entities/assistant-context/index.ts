// Public API of the slice: what the user put into, and took out of, the
// assistant's context
export {
  contextPaths,
  normalizeProjectPath,
  PgAssistantContext,
} from "./model/context";
export type { ContextChoice } from "./model/context";
