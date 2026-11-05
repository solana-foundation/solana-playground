import type { LucideIcon } from "lucide-react";
import {
  Anchor,
  Axe,
  Coins,
  Compass,
  Droplet,
  GraduationCap,
  Grid3x3,
  Hand,
  Hash,
  Landmark,
  ListChecks,
  MapIcon,
  MemoryStick,
  Receipt,
  Swords,
  Vault,
  Waves,
} from "lucide-react";

import { cn } from "@/shared/lib/utils";

/* Brand art, kept here rather than as design-system tokens: the brand
   deck's four colour grounds with their fields, copied from the design
   stand. Only a tutorial's cover draws them, the same on every theme */

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
 * One field as a background layer of a square tile: a disc as wide as the
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
  return `radial-gradient(${50 * f.s}% ${50 * f.s}% at ${f.x}% ${
    f.y
  }%, ${stops})`;
};

/* One ground per framework: what a tutorial is built with reads before its
   title does */
const GROUND_BY_FRAMEWORK: Record<FrameworkName, Ground> = {
  Anchor: "deep",
  Native: "explore",
  Seahorse: "violet",
};

/* What each lesson is about, drawn in the middle of its cover. A tutorial
   with no icon here, a new one, gets the cap */
const ICONS: Record<string, LucideIcon> = {
  "Hello Anchor": Anchor,
  "Hello Seahorse": Waves,
  "Hello Solana": Hand,
  "Bank Simulator": Landmark,
  "Battle Coins": Coins,
  "Boss Battle": Swords,
  "Counter PDA Tutorial": Hash,
  "Expense Tracker": Receipt,
  "Faucet Seahorse": Droplet,
  Lumberjack: Axe,
  "Spl Token Vault": Vault,
  "Tictactoe Seahorse": Grid3x3,
  "Tiny Adventure": MapIcon,
  "Tiny Adventure Two": Compass,
  "Todo App Seahorse": ListChecks,
  "Zero Copy": MemoryStick,
};

export interface TutorialCoverProps {
  name: string;
  framework?: FrameworkName;
  className?: string;
}

/**
 * A tutorial's cover in the brand, in place of upstream's thumbnail: a
 * square of one of four grounds with its fields held still, and the
 * lesson's icon in white in its middle. The ground says the framework, the
 * icon the lesson, so a wall of covers reads as one family and each still
 * differs. Decorative: the card's own text names the tutorial.
 */
const TutorialCover = ({ name, framework, className }: TutorialCoverProps) => {
  const ground = framework ? GROUND_BY_FRAMEWORK[framework] : "haze";
  const Icon = ICONS[name] ?? GraduationCap;
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
      {/* Half the tile, a touch lighter than lucide's stroke of 2 */}
      <Icon strokeWidth={1.75} className="absolute inset-1/4 size-1/2" />
    </span>
  );
};

export default TutorialCover;
