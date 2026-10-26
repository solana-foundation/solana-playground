import type { z } from "zod";

/** Input a tool receives, straight from the model: always validate before use */
export type ToolInput = Record<string, unknown>;

/** A JSON Schema object describing one tool's arguments */
export interface ToolSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: false;
}

/** What `run` receives: the zod schema's output type, or {@link ToolInput} */
export type ToolRunInput<S> = S extends z.ZodType ? z.output<S> : ToolInput;

/**
 * A tool, described without reference to any vendor.
 *
 * The gating lives inside `run`: a tool that changes state awaits the user
 * before returning, so it holds the turn whichever provider drives it.
 */
export interface ToolDefinition<S extends ToolSchema | z.ZodType = ToolSchema> {
  name: string;
  description: string;
  schema: S;
  // Method syntax keeps the parameter bivariant, so a zod-typed tool fits AnyToolDefinition
  /** @returns what the model should see as the result */
  run(
    input: ToolRunInput<S>,
    options?: ToolRunOptions
  ): Promise<string> | string;
}

/** What a tool's `run` may honour besides its input */
export interface ToolRunOptions {
  /** Aborted when the turn stops; a tool that cannot cancel may ignore it */
  signal?: AbortSignal;
}

/** A tool declared with either kind of schema */
export type AnyToolDefinition = ToolDefinition<ToolSchema | z.ZodType>;

/** Every model backend the module can reach */
export type ModelProvider =
  | "default"
  | "anthropic"
  | "openai"
  | "openrouter"
  | "gemini";

/** The providers spoken to through the chat-completions protocol */
export type OpenAiCompatibleProvider = Extract<
  ModelProvider,
  "openai" | "openrouter" | "gemini"
>;

/**
 * Where a model lives and how to reach it.
 *
 * `fetch` replaces the global one, for tests and for a caller that must route
 * requests itself.
 */
export type ModelConnection =
  | {
      /** The same-origin backend, whose model and key live server-side */
      provider: "default";
      /** Same-origin path that receives every request */
      url?: string;
      model?: string;
      fetch?: typeof fetch;
    }
  | {
      provider: "anthropic";
      apiKey: string;
      model: string;
      baseUrl?: string;
      fetch?: typeof fetch;
    }
  | {
      provider: OpenAiCompatibleProvider;
      /** Empty or absent for an endpoint that checks none */
      apiKey?: string;
      baseUrl: string;
      model: string;
      fetch?: typeof fetch;
    };
