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
 *
 * @throws when two tools share a name, since the set would keep only the last
 */
export const toSdkTools = (defs: readonly AnyToolDefinition[]): ToolSet => {
  const seen = new Set<string>();
  for (const { name } of defs) {
    if (seen.has(name)) {
      throw new Error(
        `Two tools are named "${name}", so one would replace the other.`
      );
    }
    seen.add(name);
  }
  return Object.fromEntries(
    defs.map((def) => [
      def.name,
      tool({
        description: def.description,
        inputSchema: isJsonSchema(def.schema)
          ? jsonSchema(def.schema as JSONSchema7)
          : def.schema,
        execute: (input, { abortSignal }) =>
          def.run(input, { signal: abortSignal }),
      }),
    ])
  );
};
