import { createLogger } from "../logger";

const log = createLogger("css-color:resolve");

/** Fully transparent black, the hex Monaco and xterm accept for "nothing" */
export const TRANSPARENT = "#00000000";

const byte = (n: number) =>
  Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, "0");

/** An alpha written as `0.5` or `50%`, as a 0..1 number */
const alphaOf = (a: string | undefined) => {
  if (a === undefined) return 1;
  return a.endsWith("%") ? parseFloat(a) / 100 : parseFloat(a);
};

const hex = (r: number, g: number, b: number, a: number) =>
  `#${byte(r)}${byte(g)}${byte(b)}${a < 1 ? byte(a * 255) : ""}`;

const RGB =
  /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/;
/** A channel as the browser serialises it, out of gamut or in exponent form */
const N = "(-?[\\d.]+(?:e[-+]?\\d+)?)";
const SRGB = new RegExp(
  `^color\\(srgb\\s+${N}\\s+${N}\\s+${N}(?:\\s*\\/\\s*([\\d.]+%?))?\\s*\\)$`
);

/**
 * Hex for a colour as `getComputedStyle` reports it: `rgb()`/`rgba()`, or
 * `color(srgb ...)`, which Chrome reports for `color-mix(in srgb, ...)`.
 * `#rrggbb` when opaque, `#rrggbbaa` otherwise; `null` for anything else.
 */
export const toHex = (computed: string): string | null => {
  const value = computed.trim();

  const rgb = value.match(RGB);
  if (rgb) return hex(+rgb[1], +rgb[2], +rgb[3], alphaOf(rgb[4]));

  const srgb = value.match(SRGB);
  if (srgb) {
    return hex(
      +srgb[1] * 255,
      +srgb[2] * 255,
      +srgb[3] * 255,
      alphaOf(srgb[4])
    );
  }

  return null;
};

/** Whether a computed colour is the browser's transparent black */
export const isTransparent = (computed: string) =>
  toHex(computed) === TRANSPARENT;

/**
 * A colour no token holds. A value the browser cannot compute (a misspelt
 * token, a gradient token used as a colour) is invalid at computed-value
 * time and inherits its parent's colour, so the probe's parent carries this
 * one: getting it back means the value did not resolve.
 */
const SENTINEL = "rgb(1, 2, 3)";

/** Values already reported as unresolved */
const warned = new Set<string>();

/**
 * Resolve any CSS colour (`var(--token)`, `color-mix(...)`, a keyword) to hex
 * against the current `<html>`, for engines that cannot read CSS variables:
 * Monaco's `defineTheme`, the TextMate grammars and xterm's `theme`. Call it
 * after the theme's class is on `<html>`.
 */
export const resolveColor = (value: string): string => {
  const parent = document.createElement("span");
  parent.style.display = "none";
  parent.style.color = SENTINEL;
  const probe = document.createElement("span");
  probe.style.color = value;
  parent.appendChild(probe);
  document.documentElement.appendChild(parent);
  const computed = getComputedStyle(probe).color;
  parent.remove();

  const resolved = computed === SENTINEL ? null : toHex(computed);
  if (resolved) return resolved;

  // An unknown token must not take the editor down, nor borrow the text
  // colour: it is drawn as nothing, and the log names the value. Every code
  // block resolves the whole theme, so the same value is named only once
  if (!warned.has(value)) {
    warned.add(value);
    log.warn("colour could not be resolved, using transparent", {
      context: { value, computed },
    });
  }
  return TRANSPARENT;
};
