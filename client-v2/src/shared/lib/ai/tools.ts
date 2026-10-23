import { jsonSchema, tool } from "ai";
import type { JSONSchema7, ToolSet } from "ai";

import type { AnyToolDefinition, ToolSchema } from "./types";

// zod 4 schemas implement Standard Schema; a plain JSON Schema object never has this key
const isJsonSchema = (
  schema: AnyToolDefinition["schema"]
): schema is ToolSchema => !("~standard" in schema);

/**
 * Turn vendor-neutral tools into the SDK's tool set, keyed by name.
 *
 * Each tool's `run` is its `execute`, so the next model request waits for it,
 * including a `run` that awaits the user's approval.
 */
export const toSdkTools = (defs: readonly AnyToolDefinition[]): ToolSet =>
  Object.fromEntries(
    defs.map((def) => [
      def.name,
      tool({
        description: def.description,
        inputSchema: isJsonSchema(def.schema)
          ? jsonSchema(def.schema as JSONSchema7)
          : def.schema,
        execute: (input) => def.run(input),
      }),
    ])
  );
