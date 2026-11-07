/**
 * The darks of the voxel banner. No token describes them: the face shades
 * lean cool and violet so shadows on the brand hues never go grey, and all
 * four are the same on every theme. The hues themselves come from the brand
 * tokens (`--brand-purple`, `--brand-violet`, `--brand-green`).
 */
export const VOXEL_SHADES = {
  /** The cubes' left faces mix towards this */
  mid: "#241a52",
  /** The cubes' right faces mix towards this */
  deep: "#0d0a20",
  /** The darkest end of every face ramp */
  ink: "#0a0a0f",
  /** The contact shadow under the sculpture */
  contact: "#050507",
} as const;
