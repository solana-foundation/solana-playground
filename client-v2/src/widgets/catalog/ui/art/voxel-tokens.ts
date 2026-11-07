import { resolveColor, TRANSPARENT } from "@/shared/lib/css-color";

/** The brand tokens the voxel sculpture is shaded in */
export const BRAND = {
  purple: "var(--brand-purple)",
  violet: "var(--brand-violet)",
  green: "var(--brand-green)",
  paper: "var(--brand-paper)",
} as const;

/**
 * A brand token as hex for the canvas, which cannot read CSS variables.
 * Throws when it does not resolve, rather than shade the cubes black
 */
export const brandHex = (token: string) => {
  const hex = resolveColor(token);
  if (hex === TRANSPARENT) throw new Error(`${token} did not resolve`);
  return hex;
};
