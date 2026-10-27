/**
 * The `message` of anything that carries a string one: an `Error`, or a
 * plain `{ message }` such as `PgCommon.sendAndReceiveCustomEvent` rejects
 * with. Anything else gets `fallback`.
 */
export const errorMessage = (e: unknown, fallback: string): string => {
  if (typeof e !== "object" || e === null) return fallback;
  const { message } = e as { message?: unknown };
  return typeof message === "string" ? message : fallback;
};
