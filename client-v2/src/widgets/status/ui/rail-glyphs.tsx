import type { ReactNode } from "react";

export interface GlyphProps {
  className?: string;
  strokeWidth?: number;
}

/**
 * The rail's own globe, star and brace, in lucide's 24 box so they sit beside
 * its other icons, with flat ends as the navigation's glyphs above them have
 * (`BrandIcon`). Less detail than lucide's: at the rail's heavier line,
 * lucide's globe and sparkle close their inner spaces up.
 */
const Glyph = ({
  name,
  className,
  strokeWidth,
  children,
}: GlyphProps & { name: string; children: ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="butt"
    strokeLinejoin="miter"
    aria-hidden="true"
    data-glyph={name}
    className={className}
  >
    {children}
  </svg>
);

/** A circle, one curved meridian and the equator: a globe in three lines.
 * The meridian bows right, under the state dot, so the dot covers it and
 * not the open left side the globe is read by */
export const RailGlobe = (props: GlyphProps) => (
  <Glyph name="globe" {...props}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2c3 3 4 6.5 4 10s-1 7-4 10" />
    <path d="M2.5 12h19" />
  </Glyph>
);

/** A pair of curly braces with a deep curl, for the Rust analyzer */
export const RailBrace = (props: GlyphProps) => (
  <Glyph name="brace" {...props}>
    <path d="M9.5 2.5Q6 2.5 6 6.5v2Q6 12 2.5 12Q6 12 6 15.5v2Q6 21.5 9.5 21.5" />
    <path d="M14.5 2.5Q18 2.5 18 6.5v2Q18 12 21.5 12Q18 12 18 15.5v2Q18 21.5 14.5 21.5" />
  </Glyph>
);

/** A four point star in line, nearly the box's size with wide arms, so its
 * open centre still reads at 16 px: drawn smaller it read as a diamond */
export const RailStar = (props: GlyphProps) => (
  <Glyph name="star" {...props}>
    <path
      strokeMiterlimit={10}
      d="M12 2.5Q14.5 9.5 21.5 12Q14.5 14.5 12 21.5Q9.5 14.5 2.5 12Q9.5 9.5 12 2.5Z"
    />
  </Glyph>
);
