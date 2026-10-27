import { cn } from "@/shared/lib/utils";

/* Brand art, kept here rather than as design-system tokens: the brand
   deck's four colour grounds with their fields, and the Playground mark's
   outline, copied from the design stand. Only a tutorial's cover draws them,
   the same on every theme */

type Ground = "haze" | "deep" | "explore" | "violet";

/** One soft disc of colour on a ground, placed and sized against the tile */
interface Field {
  c: string;
  x: number;
  y: number;
  s: number;
}

const BEDS: Record<Ground, string> = {
  haze: "#B8A6F5",
  deep: "#6858D2",
  explore: "#6A63CD",
  violet: "#6A4BCF",
};

const FIELDS: Record<Ground, Field[]> = {
  /* The first colour after white: pale lilac, teal in two corners */
  haze: [
    { c: "#2DCEA9", x: 104, y: -6, s: 0.62 },
    { c: "#5FD5C1", x: -4, y: 106, s: 0.62 },
    { c: "#D2B0FF", x: 36, y: 44, s: 1.05 },
    { c: "#ACBCEC", x: -6, y: 8, s: 0.6 },
    { c: "#7F87E5", x: 92, y: 58, s: 0.66 },
    { c: "#AA8FF4", x: 62, y: 96, s: 0.66 },
    { c: "#C0A6F9", x: 30, y: -4, s: 0.6 },
  ],
  /* Where the mark lives: deep violet, the teal corners kept */
  deep: [
    { c: "#2DCEA9", x: 104, y: -6, s: 0.58 },
    { c: "#2B9C9E", x: -4, y: 106, s: 0.58 },
    { c: "#6A4AD4", x: 46, y: 56, s: 1.0 },
    { c: "#7D90E8", x: -6, y: 4, s: 0.6 },
    { c: "#5595CB", x: 104, y: 62, s: 0.6 },
    { c: "#4A4AAF", x: 38, y: 108, s: 0.66 },
    { c: "#8F78F6", x: 34, y: -6, s: 0.6 },
  ],
  /* "Explore": the right-hand teal turns to Solana's green */
  explore: [
    { c: "#14F195", x: 104, y: 14, s: 0.66 },
    { c: "#3D95AC", x: -4, y: 86, s: 0.6 },
    { c: "#7456D9", x: 44, y: 56, s: 0.9 },
    { c: "#33CFAE", x: -6, y: -4, s: 0.58 },
    { c: "#16EE97", x: 104, y: 88, s: 0.7 },
    { c: "#4A48AD", x: 28, y: 108, s: 0.62 },
    { c: "#8C6EF5", x: 44, y: -6, s: 0.6 },
  ],
  /* "Explore, Learn,": the green gives way to Solana's purple, and the
     bottom-left sinks to navy */
  violet: [
    { c: "#9945FF", x: 104, y: -6, s: 0.8 },
    { c: "#1E2173", x: -4, y: 106, s: 0.78 },
    { c: "#7A56DA", x: 46, y: 52, s: 0.9 },
    { c: "#9496F9", x: -6, y: -6, s: 0.66 },
    { c: "#8A4AF0", x: 104, y: 58, s: 0.6 },
    { c: "#3A2893", x: 36, y: 108, s: 0.66 },
    { c: "#957BFB", x: 40, y: -6, s: 0.6 },
  ],
};

/** Every field's stops: solid at its centre, gone at its edge */
const FALLOFF: [alpha: number, at: number][] = [
  [1, 0],
  [0.72, 30],
  [0.34, 60],
  [0.1, 82],
  [0, 100],
];

/** How much of a field shows, as on the deck */
const FIELD_OPACITY = 0.94;

/**
 * One field as a background layer of a 4:3 tile: a disc as wide as the
 * tile times its scale, centred on its place. A layer, not an element: a
 * field sits partly past the edge, and an element there would make the tile
 * report content wider than itself even while clipped.
 */
const fieldLayer = (f: Field) => {
  const stops = FALLOFF.map(
    ([alpha, at]) =>
      `color-mix(in srgb, ${f.c} ${Math.round(
        alpha * FIELD_OPACITY * 100
      )}%, transparent) ${at}%`
  ).join(", ");
  return `radial-gradient(${50 * f.s}% ${((50 * f.s * 4) / 3).toFixed(2)}% at ${
    f.x
  }% ${f.y}%, ${stops})`;
};

const MARK_PATH =
  "M169.068 0C171.744 8.28719e-06 174.308 1.07233 176.187 2.97656L396.895 226.644C402.571 232.396 412.476 229.392 414.488 221.565C445.766 99.8968 556.196 9.98638 687.625 9.98633C843.369 9.98633 969.625 136.242 969.625 291.986C969.625 447.731 843.369 573.986 687.625 573.986C546.531 573.986 429.639 470.366 408.897 335.073C407.595 326.586 396.984 322.749 390.952 328.861L166.358 556.468C164.478 558.372 161.915 559.444 159.239 559.444H35.3097C34.8665 559.444 34.4341 559.417 34.0138 559.365C33.2106 559.266 32.4071 559.144 31.5978 559.144H10.0001C4.4593 559.144 -0.0253355 554.638 0.000107729 549.098L2.34288 43.1279C2.38427 34.2415 13.1304 29.8197 19.4142 36.1035L107.001 123.69C108.891 125.58 109.945 128.147 109.93 130.819L108.307 411.274C108.239 423.118 103.503 434.458 95.128 442.833L11.215 526.747C10.4339 527.528 10.4339 528.795 11.215 529.576L23.9425 542.304C24.7235 543.085 25.9896 543.085 26.7706 542.304L122.402 446.671C123.322 445.752 124.364 444.958 125.277 444.032L142.842 426.231L193.117 375.957C193.764 375.31 194.048 374.339 194.69 373.688L272.207 295.134C274.086 293.23 276.65 292.157 279.325 292.157H403.255C403.928 292.157 404.577 292.218 405.196 292.335C405.417 292.376 405.625 292.211 405.625 291.986C405.625 287.353 405.738 282.746 405.959 278.167C406.242 272.31 401.652 267.287 395.788 267.287H289.153C286.478 267.287 283.914 266.215 282.035 264.311L38.0206 17.0244C31.7856 10.7058 36.2618 -1.18154e-06 45.1388 0H169.068ZM687.625 119.986C592.632 119.986 515.625 196.993 515.625 291.986C515.625 386.979 592.632 463.986 687.625 463.986C782.618 463.986 859.625 386.979 859.625 291.986C859.625 196.993 782.618 119.986 687.625 119.986Z";

/* One ground per framework: what a tutorial is built with reads before its
   title does */
const GROUND_BY_FRAMEWORK: Record<FrameworkName, Ground> = {
  Anchor: "deep",
  Native: "explore",
  Seahorse: "violet",
};

/* Where the mark sits: white, never cut by the edge, centred, about 60% of
   the tile's height. Either the play triangle alone or the whole mark, each
   a viewBox into the mark's own 970 × 574 box in a thumbnail's 4:3 */
const PLACES: { box: string; play: boolean }[] = [
  { box: "-428 -191 1275 956", play: true },
  { box: "-152 -191 1275 956", play: false },
];

/** Where the triangle ends and the O begins, in the mark's box */
const PLAY_WIDTH = 418;

/** A stable number from the name, so a cover never changes on reload */
const hash = (s: string) =>
  [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export interface TutorialCoverProps {
  name: string;
  framework?: FrameworkName;
  className?: string;
}

/**
 * A tutorial's cover in the brand, in place of upstream's thumbnail: one of
 * four grounds with its fields held still, and the mark in white on it. The
 * ground says the framework; where the mark sits comes from the name, so a
 * wall of covers reads as one family and each still differs. Decorative: the
 * card's own text names the tutorial.
 */
const TutorialCover = ({ name, framework, className }: TutorialCoverProps) => {
  const ground = framework ? GROUND_BY_FRAMEWORK[framework] : "haze";
  const place = PLACES[hash(name) % PLACES.length];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative block shrink-0 overflow-hidden text-white",
        className
      )}
      style={{
        backgroundColor: BEDS[ground],
        // The deck paints its fields in order, so the first lies lowest
        backgroundImage: [...FIELDS[ground]]
          .reverse()
          .map(fieldLayer)
          .join(", "),
      }}
    >
      <svg
        viewBox={place.box}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 size-full"
      >
        {place.play ? (
          <svg x="0" y="-20" width={PLAY_WIDTH} height="620" overflow="hidden">
            <path
              d={MARK_PATH}
              fill="currentColor"
              transform="translate(0 20)"
            />
          </svg>
        ) : (
          <path d={MARK_PATH} fill="currentColor" />
        )}
      </svg>
    </span>
  );
};

export default TutorialCover;
