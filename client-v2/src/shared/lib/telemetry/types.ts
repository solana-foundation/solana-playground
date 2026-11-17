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

type Letter =
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "g"
  | "h"
  | "i"
  | "j"
  | "k"
  | "l"
  | "m"
  | "n"
  | "o"
  | "p"
  | "q"
  | "r"
  | "s"
  | "t"
  | "u"
  | "v"
  | "w"
  | "x"
  | "y"
  | "z";
type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

/** After the first letter: letters and digits, each `_` followed by one of them */
type SnakeTail<S extends string> = S extends ""
  ? true
  : S extends `_${infer Rest}`
  ? Rest extends `${Letter | Digit}${string}`
    ? SnakeTail<Rest>
    : false
  : S extends `${Letter | Digit}${infer Rest}`
  ? SnakeTail<Rest>
  : false;

/** `signed_in`, not `signedIn`, `signed__in` or `_signed` */
type IsSnakeCase<S> = S extends `${Letter}${infer Rest}`
  ? SnakeTail<Rest>
  : false;

/**
 * Parameters a slice sends as free text, each with why: name to reason. GA4
 * registers a dimension by name, and a free string fills it with values no
 * report can enumerate, so a slice opts in per name, at `createTracker`.
 *
 * @example
 * ```ts
 * createTracker<FundEvents, { wallet: "the wallet's brand name, as its adapter reports it" }>();
 * ```
 */
export type FreeTextParams = Record<string, string>;

/** `true` when a value is a wide `string`, not a literal or a union of them */
type IsFreeText<V> = true extends (
  V extends string ? (string extends V ? true : false) : false
)
  ? true
  : false;

/** A literal name, snake_case, whose value is a number, a boolean, a string literal, or free text the slice opted into */
type IsValidParam<P, V, F> = [Exclude<V, undefined>] extends [never]
  ? true // `NoParams`, whose index signature carries `never`
  : P extends string
  ? string extends P
    ? false
    : IsSnakeCase<P> extends true
    ? IsFreeText<V> extends true
      ? P extends keyof F
        ? true
        : false
      : true
    : false
  : false;

/** `event.param` for each bad parameter of one branch of an event's parameters */
type BadParamOf<K extends string, B, F> = B extends unknown
  ? {
      [P in keyof B]-?: IsValidParam<P, B[P], F> extends true
        ? never
        : `${K}.${P & string}`;
    }[keyof B]
  : never;

type BadParam<E, F> = {
  [K in keyof E]: BadParamOf<K & string, E[K], F>;
}[keyof E];

/** The names of free-text parameters across every event and branch */
type FreeTextName<E> = {
  [K in keyof E]: E[K] extends infer B
    ? B extends unknown
      ? {
          [P in keyof B]-?: IsFreeText<Exclude<B[P], undefined>> extends true
            ? P
            : never;
        }[keyof B]
      : never
    : never;
}[keyof E];

/** An opt-in that names no free-text parameter, or gives no literal reason */
type BadOptIn<E, F> = {
  [P in keyof F]: P extends FreeTextName<E>
    ? string extends F[P]
      ? P
      : F[P] extends ""
      ? P
      : never
    : P;
}[keyof F];

/**
 * Empty when every parameter name is snake_case and every value is a number, a
 * boolean or a string-literal union, except the free text `F` opts into with a
 * reason, so a bad map fails at `createTracker<E, F>()`
 */
export type ParamGuard<E, F> = [BadParam<E, F>] extends [never]
  ? [BadOptIn<E, F>] extends [never]
    ? []
    : [
        error: `Free-text opt-in names no free-text parameter, or gives no reason: ${BadOptIn<
          E,
          F
        > &
          string}`
      ]
  : [
      error: `Parameter is not snake_case, or is free text the slice did not opt into: ${BadParam<
        E,
        F
      > &
        string}`
    ];
