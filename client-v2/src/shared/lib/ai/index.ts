export { MIN_REDACTED_KEY_LENGTH, REDACTED_KEY, redactKey } from "./redact";
export type {
  McpCallOptions,
  McpConnection,
  McpServer,
  McpTool,
  McpToolResult,
} from "./mcp";
export type {
  AiTurnError,
  AiTurnErrorKind,
  RunTurnOptions,
  ToolCallEvent,
  TurnResult,
} from "./run-turn";
export type {
  AnyToolDefinition,
  ModelConnection,
  ModelProvider,
  OpenAiCompatibleProvider,
  ToolDefinition,
  ToolInput,
  ToolRunInput,
  ToolRunOptions,
  ToolSchema,
} from "./types";

/**
 * Load the SDK-backed part: `createModel`, `runTurn`, `toSdkTools`, `connectMcp`, and their
 * errors. Loaded on first use, so the SDK stays out of every chunk a static import reaches.
 *
 * @example One turn
 * ```ts
 * const { createModel, runTurn } = await loadAi();
 * await runTurn({ model: createModel(connection), messages });
 * ```
 */
export const loadAi = () => import("./runtime");
