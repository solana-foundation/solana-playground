/**
 * Whether an error just means "no such file" -- usually the expected case,
 * and not worth a report. The browser filesystem says it as a code and in
 * the message.
 */
export const isMissing = (error: unknown) => {
  const e = error as { code?: string; message?: string };
  return e?.code === "ENOENT" || !!e?.message?.includes("ENOENT");
};
