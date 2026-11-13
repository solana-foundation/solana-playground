/**
 * What decoding a JSON value as a Rust type of Anchor's IDL crates gave: the
 * value, or where and why serde rejects it.
 */
export type Decoded<T> =
  | { ok: true; value: T }
  | { ok: false; at: string; reason: string };

export type Decoder<T> = (json: unknown) => Decoded<T>;

export const ok = <T>(value: T): Decoded<T> => ({ ok: true, value });

/** `reason` completes the sentence that starts with the value's place */
export const rejected = (reason: string): Decoded<never> => ({
  ok: false,
  at: "",
  reason,
});

/** Puts a rejection under `segment`, a key (`.name`) or an index (`[0]`) */
export const under =
  (segment: string) =>
  <T>(decoded: Decoded<T>): Decoded<T> =>
    decoded.ok
      ? decoded
      : { ok: false, at: segment + decoded.at, reason: decoded.reason };

export const mapWith =
  <T, U>(to: (value: T) => U) =>
  (decoded: Decoded<T>): Decoded<U> =>
    decoded.ok ? ok(to(decoded.value)) : decoded;

/** Wraps a decoded value as the content of the enum variant `key` */
export const wrapWith =
  <K extends string>(key: K) =>
  <T>(decoded: Decoded<T>): Decoded<Record<K, T>> =>
    mapWith((value: T) => ({ [key]: value } as Record<K, T>))(decoded);

/** The decoded value, or an `Error` that names the place serde rejects */
export const valueOrThrow = <T>(decoded: Decoded<T>): T => {
  if (decoded.ok) return decoded.value;
  const place = decoded.at.replace(/^\./, "") || "the IDL";
  throw new Error(`Invalid IDL: ${place} ${decoded.reason}`);
};

export const isRecord = (json: unknown): json is Record<string, unknown> =>
  typeof json === "object" && json !== null && !Array.isArray(json);

/** A list, or `undefined` for an empty one: serde leaves a default out */
export const nonEmpty = <T>(items: T[] | undefined): T[] | undefined =>
  items?.length ? items : undefined;

/**
 * Whether a struct's or a variant's fields are named. serde reads an empty
 * list as named, and a decoded list never mixes fields with types.
 */
export const isNamed = <F extends { name: string }, T>(
  fields: F[] | T[]
): fields is F[] => {
  const [first] = fields;
  return (
    first === undefined ||
    (typeof first === "object" && first !== null && "name" in first)
  );
};

export const decodeString: Decoder<string> = (json) =>
  typeof json === "string" ? ok(json) : rejected("is not a string");

export const decodeBool: Decoder<boolean> = (json) =>
  typeof json === "boolean" ? ok(json) : rejected("is not a boolean");

/** A `serde_json::Value` */
export const decodeAny: Decoder<unknown> = ok;

const decodeUintWith =
  (max: number): Decoder<number> =>
  (json) =>
    typeof json === "number" &&
    Number.isInteger(json) &&
    json >= 0 &&
    json <= max
      ? ok(json)
      : rejected(`is not an integer from 0 to ${max}`);

export const decodeU8 = decodeUintWith(255);
export const decodeU32 = decodeUintWith(4294967295);
/** Up to `Number.MAX_SAFE_INTEGER`: JSON.parse keeps no larger integer exact */
export const decodeUsize = decodeUintWith(Number.MAX_SAFE_INTEGER);

export const decodeListWith =
  <T>(item: Decoder<T>): Decoder<T[]> =>
  (json) => {
    if (!Array.isArray(json)) return rejected("is not an array");
    const items: T[] = [];
    for (const [i, element] of json.entries()) {
      const decoded = item(element);
      if (!decoded.ok) return under(`[${i}]`)(decoded);
      items.push(decoded.value);
    }
    return ok(items);
  };

/** A tuple variant's content: an array of exactly two values */
export const decodePairWith =
  <A, B>(first: Decoder<A>, second: Decoder<B>): Decoder<[A, B]> =>
  (json) => {
    if (!Array.isArray(json) || json.length !== 2) {
      return rejected("is not an array of two values");
    }
    const a = under("[0]")(first(json[0]));
    if (!a.ok) return a;
    const b = under("[1]")(second(json[1]));
    return b.ok ? ok([a.value, b.value]) : b;
  };

/** How a struct's field decodes; `absent` is what a missing key gives */
export interface Field<T> {
  decode: Decoder<T>;
  absent: Decoded<T>;
}

export const required = <T>(decode: Decoder<T>): Field<T> => ({
  decode,
  absent: rejected("is missing"),
});

/** A `#[serde(default)]` field: `decode` gives `undefined` for the default */
export const defaulted = <T>(
  decode: Decoder<T | undefined>
): Field<T | undefined> => ({ decode, absent: ok(undefined) });

/** An `Option` field: a missing key and `null` are both `None` */
export const optional = <T>(decode: Decoder<T>): Field<T | undefined> =>
  defaulted((json) => (json === null ? ok(undefined) : decode(json)));

/** A `bool` that defaults to `false` */
export const flag: Field<boolean | undefined> = defaulted((json) =>
  mapWith((value: boolean) => value || undefined)(decodeBool(json))
);

/** A `Vec` that defaults to empty */
export const list = <T>(item: Decoder<T>): Field<T[] | undefined> =>
  defaulted((json) =>
    mapWith((items: T[]) => nonEmpty(items))(decodeListWith(item)(json))
  );

/**
 * A struct. serde ignores a key the struct does not have. The decoded object
 * holds the keys in the order of `fields`, which is the order serde writes
 * them in, and leaves out a field that decoded to `undefined`.
 */
export const decodeRecordWith =
  <T>(fields: { [K in keyof T]-?: Field<T[K]> }): Decoder<T> =>
  (json) => {
    if (!isRecord(json)) return rejected("is not an object");
    const record: Partial<T> = {};
    for (const key of Object.keys(fields) as Extract<keyof T, string>[]) {
      const field = fields[key];
      const decoded = Object.hasOwn(json, key)
        ? field.decode(json[key])
        : field.absent;
      if (!decoded.ok) return under(`.${key}`)(decoded);
      if (decoded.value !== undefined) record[key] = decoded.value;
    }
    return ok(record as T);
  };

/** An enum tagged internally by `kind`; each variant decodes its other keys */
export const decodeTaggedWith =
  <T extends { kind: string }>(variants: {
    [K in T["kind"]]: Decoder<Omit<Extract<T, { kind: K }>, "kind">>;
  }): Decoder<T> =>
  (json) => {
    if (!isRecord(json)) return rejected("is not an object");
    const { kind } = json;
    if (typeof kind !== "string" || !Object.hasOwn(variants, kind)) {
      const kinds = Object.keys(variants).join(", ");
      return under(".kind")(rejected(`is not one of ${kinds}`));
    }
    const decoded = variants[kind as T["kind"]](json);
    if (!decoded.ok) return decoded;
    const variant: { kind: string } = { kind, ...decoded.value };
    return ok(variant as T);
  };

/** An untagged enum: serde takes the first variant that decodes */
export const decodeUntaggedWith =
  <T>(variants: Decoder<T>[]): Decoder<T> =>
  (json) => {
    for (const decode of variants) {
      const decoded = decode(json);
      if (decoded.ok) return decoded;
    }
    return rejected("matches no variant");
  };

/**
 * An externally tagged enum. A unit variant is its name, or an object that
 * holds `null` under the name; any other variant is an object that holds its
 * content under the name.
 */
export const decodeEnumWith =
  <T, U extends string>(
    units: ReadonlySet<U>,
    variants: Record<string, Decoder<T>>
  ): Decoder<T | U> =>
  (json) => {
    const isUnit = (name: string): name is U =>
      (units as ReadonlySet<string>).has(name);
    if (typeof json === "string") {
      return isUnit(json) ? ok(json) : rejected("is not a unit variant");
    }
    const entries = isRecord(json) ? Object.entries(json) : [];
    if (entries.length !== 1) {
      return rejected("is not a variant name or an object with one key");
    }
    const [[name, content]] = entries;
    if (isUnit(name)) {
      return content === null
        ? ok(name)
        : under(`.${name}`)(rejected("is not null"));
    }
    if (!Object.hasOwn(variants, name)) {
      return rejected(`names the unknown variant ${name}`);
    }
    return under(`.${name}`)(variants[name](content));
  };
