import type { EventPrefix } from "./prefixes";

/** Primitives only: an object could carry a user's code or address to GA4 */
export type Param = string | number | boolean;

export type EventParams = Record<string, Param>;

/** Parameters of an event that carries none */
export type NoParams = Record<string, never>;

/** A slice's events: name to parameters */
export type EventMap = Record<string, EventParams>;

export interface TelemetryEvent {
  name: string;
  params: EventParams;
  /** The nearest `TelemetryScope`, when the event came through `useTracker` */
  scope?: string;
}

export interface TelemetryProvider {
  send(event: TelemetryEvent): void;
}

/** Checks if string S fits within N characters */
type FitsIn<
  S extends string,
  N extends number,
  Acc extends unknown[] = []
> = Acc["length"] extends N
  ? S extends ""
    ? true
    : false
  : S extends `${string}${infer Rest}`
  ? FitsIn<Rest, N, [...Acc, unknown]>
  : true;

/** Resolves to S if within 40 chars, otherwise never */
export type GA4EventName<S extends string> = FitsIn<S, 40> extends true
  ? S
  : never;

type IsValidName<K> = K extends string
  ? string extends K
    ? false
    : K extends `${EventPrefix}_${string}`
    ? [GA4EventName<K>] extends [never]
      ? false
      : true
    : false
  : false;

type BadName<E> = {
  [K in keyof E]: IsValidName<K> extends true ? never : K;
}[keyof E];

/** Empty when every name is valid, so a bad map fails at `createTracker<E>()` */
export type NameGuard<E> = [BadName<E>] extends [never]
  ? []
  : [
      error: `Event name is not a literal, has no registered prefix, or exceeds GA4's 40 characters: ${BadName<E> &
        string}`
    ];
