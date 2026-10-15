/** Stands in for the user's own key wherever provider text would echo it */
export const REDACTED_KEY = "[your key]";

/**
 * A shorter key is a placeholder (a local proxy that checks none), and
 * replacing it would mangle ordinary words in the error text.
 */
export const MIN_REDACTED_KEY_LENGTH = 8;

/**
 * A provider's error can quote the key it rejected. The thread is persisted
 * and synced, and the key must reach neither, so the exact key is replaced
 * wherever provider text becomes an item: `PgAssistant.addError`, and the
 * error body `openai.ts` quotes, before it is cut to length.
 */
export const redactKey = (text: string, apiKey: string | undefined) =>
  apiKey && apiKey.length >= MIN_REDACTED_KEY_LENGTH
    ? text.split(apiKey).join(REDACTED_KEY)
    : text;
