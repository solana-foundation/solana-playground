/**
 * The name a duplicate takes: "<name> copy", then "<name> copy 2", "copy 3"
 * and on, the first one no workspace has. No parentheses: a workspace name
 * is letters, digits, `_`, `-` and spaces (`isWorkspaceNameValid`).
 */
export const copyName = (name: string, taken: readonly string[]) => {
  const first = `${name} copy`;
  if (!taken.includes(first)) return first;

  for (let n = 2; ; n++) {
    const next = `${name} copy ${n}`;
    if (!taken.includes(next)) return next;
  }
};
