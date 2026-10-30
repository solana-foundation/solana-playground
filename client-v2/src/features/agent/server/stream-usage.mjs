/**
 * Read the token usage out of a chat-completions event stream while the route
 * pipes it to the caller untouched.
 *
 * With `stream_options.include_usage`, the upstream sends one last event whose
 * `usage` is the turn's total; every earlier event carries `usage: null` or
 * none. The last non-null one wins.
 */

/**
 * @typedef {{ prompt_tokens?: number; completion_tokens?: number }} Usage
 */

/**
 * @returns {{ push: (chunk: Uint8Array) => void; usage: () => Usage | undefined }}
 */
export const usageReader = () => {
  const decoder = new TextDecoder();
  let buffer = "";
  /** @type {Usage | undefined} */
  let usage;
  let warned = false;

  return {
    push(chunk) {
      buffer += decoder.decode(chunk, { stream: true });
      // Events are separated by a blank line; keep the unfinished tail
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";

      for (const event of events) {
        for (const line of event.split(/\r?\n/)) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload.includes('"usage"')) continue;
          try {
            const parsed = JSON.parse(payload);
            if (parsed?.usage && typeof parsed.usage === "object") {
              usage = parsed.usage;
            }
          } catch (e) {
            // A malformed event is the upstream's bug and the caller's to
            // skip; for the ledger it is only an event without usage, and a
            // turn that never reports usage is charged its reservation. Logged
            // once per turn, so a charge that jumps to the reservation has a
            // cause in the logs. Neither the event nor the parser's message
            // is logged: an event carrying usage can carry the answer too,
            // and V8's `SyntaxError` quotes the text it failed on
            if (!warned) {
              warned = true;
              console.warn("agent: skipped a malformed usage event", {
                error: e?.name,
                bytes: payload.length,
              });
            }
          }
        }
      }
    },
    usage: () => usage,
  };
};
