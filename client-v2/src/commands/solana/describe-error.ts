import {
  isSolanaError,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
} from "@solana/kit";

/**
 * What went wrong, in words a person can read. kit builds a `SolanaError`'s
 * message from a table that production builds leave out ("Solana error
 * #<code>; Decode this error by running npx …"), so the text is made from
 * the error's `context` (the HTTP status, the server's message) instead.
 *
 * @param error whatever a `catch` caught
 * @returns the reason, without any prefix
 */
export const describeError = (error: unknown): string => {
  if (isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) {
    const { statusCode, message } = error.context;
    return message
      ? `HTTP error (${statusCode}): ${message}`
      : `HTTP error (${statusCode})`;
  }
  if (isSolanaError(error)) {
    const context: Record<string, unknown> = { ...error.context };
    if (typeof context.__serverMessage === "string") {
      return context.__serverMessage;
    }
    if (typeof context.numSlotsBehind === "number") {
      return `Node is unhealthy; behind by ${context.numSlotsBehind} slots`;
    }
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
};
