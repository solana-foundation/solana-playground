import { emit } from "./collector";
import type { EventMap, NameGuard } from "./types";

export interface Tracker<E extends EventMap> {
  track<K extends Extract<keyof E, string>>(
    name: K,
    params: E[K],
    scope?: string
  ): void;
}

/**
 * A slice's tracker for the events in `E`.
 *
 * A name that is not a literal, lacks a prefix from `EVENT_PREFIXES`, or is
 * longer than GA4's 40 characters fails type-checking at this call.
 *
 * @example
 * ```ts
 * type AuthEvents = { auth_signed_out: NoParams };
 * export const authTelemetry = createTracker<AuthEvents>();
 * ```
 */
export const createTracker = <E extends EventMap>(
  ..._guard: NameGuard<E>
): Tracker<E> => ({
  track: (name, params, scope) => emit({ name, params, scope }),
});
