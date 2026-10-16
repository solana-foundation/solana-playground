/**
 * Every key and value a `Storage` holds, as a plain record.
 *
 * Named, so a test asserting that a value is absent from storage reads the
 * storage through its own API instead of spreading the `Storage` object into
 * a new shape (`client-v2/AGENTS.md`).
 */
export const storedValues = (storage: Storage) => {
  const values: Record<string, string | null> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null) values[key] = storage.getItem(key);
  }
  return values;
};
