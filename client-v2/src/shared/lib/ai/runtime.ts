// The SDK-backed part of the module, reached only through `loadAi` in `index.ts`
export { connectMcp, McpUnreachableError } from "./mcp";
export { createModel } from "./models";
export {
  AiTurnError,
  DEFAULT_MAX_RESUMES,
  DEFAULT_MAX_STEPS,
  runTurn,
} from "./run-turn";
export { toSdkTools } from "./tools";
