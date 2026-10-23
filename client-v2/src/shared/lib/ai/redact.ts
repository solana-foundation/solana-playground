/** Stands in for the user's own key wherever provider text would echo it */
export const REDACTED_KEY = "[your key]";

/**
 * A shorter key is a placeholder (a local proxy that checks none), and
 * replacing it would mangle ordinary words in the error text.
 */
export const MIN_REDACTED_KEY_LENGTH = 8;

/**
 * Replace every occurrence of `apiKey` in `text` with {@link REDACTED_KEY}.
 *
 * A provider's error can quote the key it rejected, and error text is
 * persisted and synced; a key shorter than {@link MIN_REDACTED_KEY_LENGTH}
 * is left alone.
 */
export const redactKey = (text: string, apiKey: string | undefined) =>
  apiKey && apiKey.length >= MIN_REDACTED_KEY_LENGTH
    ? text.split(apiKey).join(REDACTED_KEY)
    : text;
