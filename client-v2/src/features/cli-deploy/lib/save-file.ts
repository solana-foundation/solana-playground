/**
 * How long a download's object URL outlives the click. Safari starts reading
 * a blob download after the click returns, so a revoke on the next task can
 * cut it off; a few seconds is past any start.
 */
const REVOKE_AFTER_MS = 10_000;

/** Hands `blob` to the browser to save as `name`, keeping no copy */
export const saveFile = (name: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.download = name;
  a.href = url;
  try {
    a.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  }
};
