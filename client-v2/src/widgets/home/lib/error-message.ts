/**
 * The `message` of anything that carries a string one: an `Error`, or the
 * plain `{ message }` that `PgCommon.sendAndReceiveCustomEvent` rejects with
 * (the gallery's modal answers that way). Anything else gets `fallback`.
 */
export const errorMessage = (e: unknown, fallback: string): string => {
  if (typeof e !== "object" || e === null) return fallback;
  const { message } = e as { message?: unknown };
  return typeof message === "string" ? message : fallback;
};
