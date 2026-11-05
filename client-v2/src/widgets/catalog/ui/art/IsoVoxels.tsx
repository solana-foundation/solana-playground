/* eslint-disable max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import { type CSSProperties, useEffect, useRef } from "react";

import { createLogger } from "@/shared/lib/logger";
import { cn } from "@/shared/lib/utils";

const log = createLogger("catalog:voxels");

/** The brand mark, ▷O, in its 970 × 574 box (the prototype's `brandGlyphs`) */
const MARK_PATH =
  "M169.068 0C171.744 8.28719e-06 174.308 1.07233 176.187 2.97656L396.895 226.644C402.571 232.396 412.476 229.392 414.488 221.565C445.766 99.8968 556.196 9.98638 687.625 9.98633C843.369 9.98633 969.625 136.242 969.625 291.986C969.625 447.731 843.369 573.986 687.625 573.986C546.531 573.986 429.639 470.366 408.897 335.073C407.595 326.586 396.984 322.749 390.952 328.861L166.358 556.468C164.478 558.372 161.915 559.444 159.239 559.444H35.3097C34.8665 559.444 34.4341 559.417 34.0138 559.365C33.2106 559.266 32.4071 559.144 31.5978 559.144H10.0001C4.4593 559.144 -0.0253355 554.638 0.000107729 549.098L2.34288 43.1279C2.38427 34.2415 13.1304 29.8197 19.4142 36.1035L107.001 123.69C108.891 125.58 109.945 128.147 109.93 130.819L108.307 411.274C108.239 423.118 103.503 434.458 95.128 442.833L11.215 526.747C10.4339 527.528 10.4339 528.795 11.215 529.576L23.9425 542.304C24.7235 543.085 25.9896 543.085 26.7706 542.304L122.402 446.671C123.322 445.752 124.364 444.958 125.277 444.032L142.842 426.231L193.117 375.957C193.764 375.31 194.048 374.339 194.69 373.688L272.207 295.134C274.086 293.23 276.65 292.157 279.325 292.157H403.255C403.928 292.157 404.577 292.218 405.196 292.335C405.417 292.376 405.625 292.211 405.625 291.986C405.625 287.353 405.738 282.746 405.959 278.167C406.242 272.31 401.652 267.287 395.788 267.287H289.153C286.478 267.287 283.914 266.215 282.035 264.311L38.0206 17.0244C31.7856 10.7058 36.2618 -1.18154e-06 45.1388 0H169.068ZM687.625 119.986C592.632 119.986 515.625 196.993 515.625 291.986C515.625 386.979 592.632 463.986 687.625 463.986C782.618 463.986 859.625 386.979 859.625 291.986C859.625 196.993 782.618 119.986 687.625 119.986Z";

/* Ported from the tutorial-v2 prototype (ui/IsoVoxels.tsx), which took it from Almaz's stand
   (views/flow/gallery/banner-art/IsoVoxels.tsx): the cubes are the brand pattern's rounded, low tiles */

/** The brand colours the sculpture is shaded in: literal on purpose, since canvas pixels cannot read CSS variables; they match `--brand-purple` and `--brand-green` */
const BRAND = {
  purple: "#9945FF",
  violet: "#7A56DA",
  green: "#14F195",
} as const;

/* The words own the left of the banner: the art fades out before it. In the corner it fades out
   down and to the left, towards the words under it, so they read over its faint end */
const SIDE_MASK: CSSProperties = {
  WebkitMaskImage: "linear-gradient(90deg, transparent 42%, #000 54%)",
  maskImage: "linear-gradient(90deg, transparent 42%, #000 54%)",
};
const CORNER_MASK: CSSProperties = {
  WebkitMaskImage:
    "radial-gradient(130% 80% at 100% 0%, #000 30%, rgba(0, 0, 0, 0.25) 58%, transparent 78%)",
  maskImage:
    "radial-gradient(130% 80% at 100% 0%, #000 30%, rgba(0, 0, 0, 0.25) 58%, transparent 78%)",
};

/** Grid the mark is sampled into; rows follow the mark's 970 × 574 box */
const COLS = 33;
const ROWS = Math.round((COLS * 574) / 970);

/** Colour steps along the gradient, and how many lit variants each top has */
const TONES = 40;
const GLINTS = 5;

/** css px: cube grid size candidates, ripple height, pointer bump height */
const CELL_SIZES = [9, 8, 7];
/** How much larger than the banner's own fit the mark is drawn */
const MARK_SCALE = 2;
const RIPPLE_LIFT = 4;
const BUMP_LIFT = 8;

/** seconds */
const RISE_TIME = 0.62;
const GROUND_TIME = 1.4;
const INTRO_SPREAD = 0.75;
const RIPPLE_PERIOD = 6.2;

/** cells per second, and the soft leading and long trailing edge of a pulse */
const RIPPLE_SPEED = 13;
const RIPPLE_LEAD = 1.7;
const RIPPLE_TAIL = 3.4;

/** Pointer bump radius in cells */
const BUMP_RADIUS = 2.8;

/** Share of the banner's width the art never starts before; the words own the rest */
const ART_LEFT = 0.47;

/* Each pixel is a rounded square like the brand pattern's, kept low: about 5.5 css px of side,
   enough to read as iso and still a tile. Height is a share of the tile's width; radius and gap
   are shares of the cell */
const TILE_HEIGHT = 0.4;
const TILE_RADIUS = 0.3;
const TILE_GAP = 0.11;

type Lab = [number, number, number];

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Linear lookup of a CSS cubic bezier, so easing in the loop is one read */
const bezier = (x1: number, y1: number, x2: number, y2: number) => {
  const N = 256;
  const table = new Float32Array(N + 1);
  const at = (a: number, b: number, s: number) =>
    3 * a * s * (1 - s) * (1 - s) + 3 * b * s * s * (1 - s) + s * s * s;
  let s = 0;
  for (let i = 0; i <= N; i++) {
    const x = i / N;
    while (s < 1 && at(x1, x2, s) < x) s += 1 / 4096;
    table[i] = at(y1, y2, s);
  }
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const f = t * N;
    const i = Math.floor(f);
    return table[i] + (table[i + 1] - table[i]) * (f - i);
  };
};

const rise = bezier(0.22, 0.61, 0.24, 1);
const ground = bezier(0.45, 0, 0.2, 1);

// Shades are mixed in OKLab so purple, violet and green keep their chroma
// through the ramp instead of going muddy halfway
const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const toSrgb = (c: number) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;

const lab = (hex: string): Lab => {
  const n = parseInt(hex.slice(1), 16);
  const r = toLinear(((n >> 16) & 255) / 255);
  const g = toLinear(((n >> 8) & 255) / 255);
  const b = toLinear((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

/** OKLab to a packed 0xAABBGGRR pixel, the byte order ImageData uses here */
const pixel = ([L, A, B]: Lab) => {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const ch = (v: number) => Math.round(toSrgb(clamp01(v)) * 255);
  const r = ch(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = ch(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const b = ch(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
};

const mix = (a: Lab, b: Lab, t: number): Lab => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const PURPLE = lab(BRAND.purple);
const VIOLET = lab(BRAND.violet);
const GREEN = lab(BRAND.green);
const WHITE = lab("#ffffff");
/** Shadows lean cool and violet rather than going grey */
const SHADE_MID = lab("#241a52");
const SHADE_DEEP = lab("#0d0a20");
const INK = lab("#0a0a0f");

const chroma = (c: Lab) => Math.hypot(c[1], c[2]);

/** A straight OKLab blend greys out between violet and green; hold the chroma up */
const blend = (a: Lab, b: Lab, t: number): Lab => {
  const c = mix(a, b, t);
  const want = chroma(a) + (chroma(b) - chroma(a)) * t;
  const k = 1 + (want / (chroma(c) || 1) - 1) * 0.75;
  return [c[0], c[1] * k, c[2] * k];
};

const gradient = (t: number): Lab =>
  t < 0.4
    ? blend(PURPLE, VIOLET, t / 0.4)
    : blend(VIOLET, GREEN, (t - 0.4) / 0.6);

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(
  (n) => (n + 0.5) / 16
);
const bayer = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

const hash = (n: number) => {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

/** The mark's cells, in draw order, with everything that does not depend on size */
interface Mark {
  count: number;
  /** Screen axes in cell units: a = x - z across, b = x + z down */
  a: Int16Array;
  b: Int16Array;
  /** World floor position, for distances */
  x: Float32Array;
  z: Float32Array;
  tone: Uint8Array;
  delay: Float32Array;
  dist: Float32Array;
  phase: Float32Array;
  minA: number;
  maxA: number;
  minB: number;
  maxB: number;
  maxDist: number;
}

const buildMark = (): Mark | null => {
  const SS = 4;
  const c = document.createElement("canvas");
  c.width = COLS * SS;
  c.height = ROWS * SS;
  const g = c.getContext("2d");
  if (!g) return null;
  g.scale(c.width / 970, c.height / 574);
  g.fill(new Path2D(MARK_PATH));
  const data = g.getImageData(0, 0, c.width, c.height).data;

  // The mark lies on the floor with its top edge away from the viewer, so it
  // reads from the triangle at the top left down to the ring at the bottom right
  const world = (u: number, v: number) => ({ x: u, z: v });

  const cells: { x: number; z: number }[] = [];
  for (let v = 0; v < ROWS; v++) {
    for (let u = 0; u < COLS; u++) {
      let sum = 0;
      for (let j = 0; j < SS; j++) {
        for (let i = 0; i < SS; i++) {
          sum += data[((v * SS + j) * c.width + u * SS + i) * 4 + 3];
        }
      }
      if (sum / (SS * SS * 255) > 0.42) cells.push(world(u, v));
    }
  }
  // Painter's order for iso columns: back rows first
  cells.sort((p, q) => p.x + p.z - (q.x + q.z) || p.x - q.x);

  const count = cells.length;
  const mark: Mark = {
    count,
    a: new Int16Array(count),
    b: new Int16Array(count),
    x: new Float32Array(count),
    z: new Float32Array(count),
    tone: new Uint8Array(count),
    delay: new Float32Array(count),
    dist: new Float32Array(count),
    phase: new Float32Array(count),
    minA: Infinity,
    maxA: -Infinity,
    minB: Infinity,
    maxB: -Infinity,
    maxDist: 0,
  };
  cells.forEach(({ x, z }, i) => {
    const a = x - z;
    const b = x + z;
    mark.a[i] = a;
    mark.b[i] = b;
    mark.x[i] = x;
    mark.z[i] = z;
    mark.minA = Math.min(mark.minA, a);
    mark.maxA = Math.max(mark.maxA, a);
    mark.minB = Math.min(mark.minB, b);
    mark.maxB = Math.max(mark.maxB, b);
  });

  // The ripple leaves from the middle of the play triangle
  const origin = world(COLS * 0.2, ROWS * 0.5);
  const spanA = mark.maxA - mark.minA || 1;
  const spanB = mark.maxB - mark.minB || 1;
  for (let i = 0; i < count; i++) {
    const na = (mark.a[i] - mark.minA) / spanA;
    const nb = (mark.b[i] - mark.minB) / spanB;
    // Purple at the top left of the screen, green at the bottom right
    const t = clamp01(na * 0.62 + nb * 0.38);
    mark.tone[i] = Math.round(t * (TONES - 1));
    mark.delay[i] = 0.08 + na * INTRO_SPREAD + hash(i + 1) * 0.07;
    const d = Math.hypot(mark.x[i] - origin.x, mark.z[i] - origin.z);
    mark.dist[i] = d;
    mark.maxDist = Math.max(mark.maxDist, d);
    mark.phase[i] = mark.x[i] * 0.42 + mark.z[i] * 0.27 + hash(i + 7) * 0.6;
  }
  return mark;
};

/** Everything that depends on the banner's size and pixel ratio */
interface Scene {
  dpr: number;
  /** Device px: cell step, cube half width, resting cube height */
  step: number;
  w: number;
  h0: number;
  /** Device px: tallest side strip in the atlas */
  side: number;
  ox: number;
  oy: number;
  tops: HTMLCanvasElement;
  sides: HTMLCanvasElement;
  floor: HTMLCanvasElement;
}

/**
 * Paints every tone's cube faces once. Tops carry a soft key light from the
 * top left and a bright lip on their front edges; sides carry dithered
 * occlusion where they meet the floor, anchored to the bottom of the strip so
 * any column height is a crop of the same sprite.
 */
const paintSprites = (w: number, side: number) => {
  const hw = w / 2;
  const tops = document.createElement("canvas");
  tops.width = 2 * w * GLINTS;
  tops.height = w * TONES;
  const sides = document.createElement("canvas");
  sides.width = 2 * w * TONES;
  sides.height = side;
  const tg = tops.getContext("2d");
  const sg = sides.getContext("2d");
  if (!tg || !sg) return null;

  const RAMP = 8;
  const topImg = tg.createImageData(tops.width, tops.height);
  const sideImg = sg.createImageData(sides.width, sides.height);
  const topPx = new Uint32Array(topImg.data.buffer);
  const sidePx = new Uint32Array(sideImg.data.buffer);

  // The top as a rounded square on the floor. The distance is in floor units, the square spanning
  // -0.5 to 0.5 on both axes, negative inside
  const round = TILE_RADIUS;
  const inset = 0.5 - round;
  const outside = (dx: number, dy: number) => {
    const p = dx / w;
    const q = (2 * dy) / w;
    const u = Math.abs((p + q) / 2) - inset;
    const v = Math.abs((q - p) / 2) - inset;
    return (
      Math.hypot(Math.max(u, 0), Math.max(v, 0)) +
      Math.min(Math.max(u, v), 0) -
      round
    );
  };
  // How far below the top's centre each column of it reaches, so the sides hang from a rounded
  // edge; a column the rounding cut away has none
  const reach = new Float32Array(2 * w).fill(-1);
  for (let x = 0; x < 2 * w; x++) {
    for (let y = w - 1; y >= hw; y--) {
      if (outside(x - w + 0.5, y - hw + 0.5) <= 0) {
        reach[x] = y - hw + 1;
        break;
      }
    }
  }
  // The front corner is a curve, so the two side shades meet across it, not on a line
  const BLEND = 8;
  const soft = round * w * 0.9;

  for (let k = 0; k < TONES; k++) {
    const base = gradient(k / (TONES - 1));
    const left = mix(base, SHADE_MID, 0.36);
    const right = mix(base, SHADE_DEEP, 0.6);
    const leftRamp: number[] = [];
    const rightRamp: number[] = [];
    for (let r = 0; r < RAMP; r++) {
      const dark = 0.5 * (1 - r / (RAMP - 1));
      leftRamp.push(pixel(mix(left, INK, dark)));
      rightRamp.push(pixel(mix(right, INK, dark)));
    }
    const blendRamps = Array.from({ length: BLEND }, (_, j) =>
      Array.from({ length: RAMP }, (__, r) => {
        const dark = 0.5 * (1 - r / (RAMP - 1));
        return pixel(
          mix(mix(left, INK, dark), mix(right, INK, dark), j / (BLEND - 1))
        );
      })
    );

    for (let gl = 0; gl < GLINTS; gl++) {
      const top = mix(base, WHITE, 0.07 + gl * 0.075);
      const ramp: number[] = [];
      for (let r = 0; r < RAMP; r++) {
        const t = r / (RAMP - 1);
        ramp.push(
          pixel(
            t < 0.5
              ? mix(top, INK, (0.5 - t) * 0.2)
              : mix(top, WHITE, (t - 0.5) * 0.12)
          )
        );
      }
      const lipLeft = pixel(mix(top, WHITE, 0.4));
      const lipRight = pixel(mix(top, WHITE, 0.16));
      const x0 = gl * 2 * w;
      const y0 = k * w;
      for (let y = 0; y < w; y++) {
        const dy = y - hw + 0.5;
        for (let x = 0; x < 2 * w; x++) {
          const dx = x - w + 0.5;
          const out = outside(dx, dy);
          if (out > 0) continue;
          let c: number;
          if (dy > 0 && out > -1 / w) c = dx < 0 ? lipLeft : lipRight;
          else {
            const light = (-dx / w - (2 * dy) / w) * 0.5 + 0.5;
            const idx = Math.floor(light * (RAMP - 1) + bayer(x, y));
            c = ramp[Math.min(RAMP - 1, Math.max(0, idx))];
          }
          topPx[(y0 + y) * tops.width + x0 + x] = c;
        }
      }
    }

    const x0 = k * 2 * w;
    for (let y = 0; y < side; y++) {
      const fromBottom = side - y - 0.5;
      for (let x = 0; x < 2 * w; x++) {
        const dx = x - w + 0.5;
        if (reach[x] < 0) continue;
        const lift = fromBottom - (hw - reach[x]);
        if (lift < 0) continue;
        const ao = clamp01(1 - lift / (w * 1.1));
        const idx = Math.floor((1 - ao * ao) * (RAMP - 1) + bayer(x, y));
        const r = Math.min(RAMP - 1, Math.max(0, idx));
        // Blended across the soft middle, else the left or the right face's ramp
        let ramp = dx < 0 ? leftRamp : rightRamp;
        if (Math.abs(dx) < soft)
          ramp = blendRamps[Math.round(((dx / soft + 1) / 2) * (BLEND - 1))];
        sidePx[y * sides.width + x0 + x] = ramp[r];
      }
    }
  }
  tg.putImageData(topImg, 0, 0);
  sg.putImageData(sideImg, 0, 0);
  return { tops, sides };
};

/**
 * The floor under the mark: a pool of the mark's own colour, dithered into
 * 2 css px pixels like the brand's pixel fields, and a soft contact shadow
 * thrown to the bottom right, away from the key light.
 */
const paintFloor = (
  mark: Mark,
  width: number,
  height: number,
  dpr: number,
  step: number,
  ox: number,
  oy: number
) => {
  const floor = document.createElement("canvas");
  floor.width = width;
  floor.height = height;
  const fg = floor.getContext("2d");
  if (!fg) return floor;

  const rhombus = (
    g: CanvasRenderingContext2D,
    scale: number,
    i: number,
    grow: number,
    sx: number,
    sy: number
  ) => {
    const cx = (ox + mark.a[i] * step + sx) * scale;
    const cy = (oy + (mark.b[i] * step) / 2 + sy) * scale;
    const r = step * grow * scale;
    g.moveTo(cx - r, cy);
    g.lineTo(cx, cy - r / 2);
    g.lineTo(cx + r, cy);
    g.lineTo(cx, cy + r / 2);
    g.closePath();
  };

  // Glow: tiny footprint, upscaled twice for a cheap wide blur, then ordered
  // dithered into a few alpha levels at 2 css px
  const tinyScale = 1 / (18 * dpr);
  const tiny = document.createElement("canvas");
  tiny.width = Math.ceil(width * tinyScale);
  tiny.height = Math.ceil(height * tinyScale);
  const ty = tiny.getContext("2d");
  const pixelSize = 2 * dpr;
  const pool = document.createElement("canvas");
  pool.width = Math.ceil(width / pixelSize);
  pool.height = Math.ceil(height / pixelSize);
  const pg = pool.getContext("2d");
  if (ty && pg) {
    // A handful of colour buckets is plenty for something this blurred
    for (let k = 0; k <= TONES; k += 4) {
      ty.beginPath();
      for (let i = 0; i < mark.count; i++) {
        if (Math.round(mark.tone[i] / 4) * 4 === k)
          rhombus(ty, tinyScale, i, 1.6, 0, step * 0.8);
      }
      const c = pixel(gradient(Math.min(1, k / (TONES - 1))));
      ty.fillStyle = `rgb(${c & 255}, ${(c >> 8) & 255}, ${(c >> 16) & 255})`;
      ty.fill();
    }
    pg.imageSmoothingEnabled = true;
    pg.drawImage(tiny, 0, 0, pool.width, pool.height);
    const img = pg.getImageData(0, 0, pool.width, pool.height);
    const d = img.data;
    const LEVELS = 5;
    const PEAK = 0.34;
    for (let y = 0; y < pool.height; y++) {
      for (let x = 0; x < pool.width; x++) {
        const o = (y * pool.width + x) * 4;
        const a = (d[o + 3] / 255) ** 1.4;
        const q = Math.floor(a * LEVELS + bayer(x, y) - 0.5) / LEVELS;
        d[o + 3] = Math.round(clamp01(q) * PEAK * 255);
      }
    }
    pg.putImageData(img, 0, 0);
    fg.imageSmoothingEnabled = false;
    fg.drawImage(pool, 0, 0, pool.width * pixelSize, pool.height * pixelSize);
  }

  // Contact shadow: footprints at quarter size, upscaled smooth
  const lowScale = 1 / (4 * dpr);
  const low = document.createElement("canvas");
  low.width = Math.ceil(width * lowScale);
  low.height = Math.ceil(height * lowScale);
  const lg = low.getContext("2d");
  if (lg) {
    lg.beginPath();
    for (let i = 0; i < mark.count; i++) {
      rhombus(lg, lowScale, i, 1.05, step * 0.45, step * 0.3);
    }
    lg.fillStyle = "#050507";
    lg.fill();
    fg.imageSmoothingEnabled = true;
    fg.globalAlpha = 0.7;
    fg.drawImage(low, 0, 0, width, height);
    fg.globalAlpha = 1;
  }
  return floor;
};

let spriteCache: {
  key: string;
  tops: HTMLCanvasElement;
  sides: HTMLCanvasElement;
} | null = null;

/* On a narrow banner the words run the full width, so the sculpture hangs
   from the top right corner instead: the same cubes, the triangle and part
   of the ring in view, the rest past the frame */
const CORNER_CELL = 8;

const buildScene = (
  mark: Mark,
  cssW: number,
  cssH: number,
  dpr: number,
  corner: boolean
): Scene | null => {
  const spanA = mark.maxA - mark.minA;
  const spanB = mark.maxB - mark.minB;
  // The largest cube that leaves the words their room and only bleeds a little
  let cell = CELL_SIZES[CELL_SIZES.length - 1];
  for (const size of CELL_SIZES) {
    const artW = (spanA + 2) * size;
    const artH = (spanB / 2 + 2) * size;
    if (artW <= cssW * (1 - ART_LEFT) * 1.02 && artH <= cssH * 1.08) {
      cell = size;
      break;
    }
  }
  cell = corner ? CORNER_CELL : cell * MARK_SCALE;
  const step = 2 * Math.round((cell * dpr) / 2);
  const gap = Math.max(2, 2 * Math.round(step * TILE_GAP));
  const w = step - gap;
  const h0 = Math.round(w * TILE_HEIGHT);
  const side = h0 + Math.ceil((RIPPLE_LIFT + BUMP_LIFT + 2) * dpr) + w / 2;

  const width = Math.round(cssW * dpr);
  const height = Math.round(cssH * dpr);
  const artW = spanA * step + 2 * w;
  const artH = (spanB * step) / 2 + h0 + w;
  const left = corner
    ? width * 0.4
    : Math.max(width * ART_LEFT, width + artW * 0.03 - artW);
  // Larger than the banner, it is centred on it and runs off both edges; in
  // the corner it hangs from the top, a third of it above the frame
  const centred = (height - artH) / 2 + height * 0.05;
  let top = MARK_SCALE > 1 ? centred : Math.max(14 * dpr, centred);
  if (corner) top = -artH * 0.32;
  const ox = Math.round(left + w - mark.minA * step);
  const oy = Math.round(top + h0 + w / 2 - (mark.minB * step) / 2);

  // A drag across window sizes keeps the same cube, so keep its sprites too
  const key = `${w}:${side}`;
  if (spriteCache?.key !== key) {
    const painted = paintSprites(w, side);
    spriteCache = painted && { key, ...painted };
  }
  const sprites = spriteCache && {
    tops: spriteCache.tops,
    sides: spriteCache.sides,
  };
  if (!sprites) return null;
  return {
    dpr,
    step,
    w,
    h0,
    side,
    ox,
    oy,
    ...sprites,
    floor: paintFloor(mark, width, height, dpr, step, ox, oy),
  };
};

/**
 * The ▷O mark as a voxel sculpture lying on the card, in 2:1 pixel isometric.
 *
 * Every filled cell of the rasterized mark is a low rounded tile with a lit top and shaded sides.
 * Cubes rise into place on mount, a slow ripple leaves the play triangle and
 * runs out through the ring, and the pointer presses a soft bump up through
 * them. Faces are painted pixel by pixel into sprite atlases once per size, so
 * a frame is only a few hundred `drawImage` calls on whole device pixels.
 */
export function IsoVoxels({
  className,
  corner = false,
}: {
  className?: string;
  /** Hung from the top right corner, for a banner the words fill across */
  corner?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    // Decorative: where the canvas cannot be read (blocked, or no Path2D) the
    // banner keeps its words and draws no sculpture
    const mark = (() => {
      try {
        return buildMark();
      } catch (e) {
        log.warn("the voxel mark could not be drawn", {
          context: { error: String(e) },
        });
        return null;
      }
    })();
    if (!root || !canvas || !ctx || !mark || mark.count === 0) return;
    const host = root.parentElement;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let scene: Scene | null = null;
    const bump = new Float32Array(mark.count);
    let clock = 0;
    let last = 0;
    let raf = 0;
    let inView = false;

    // Pointer in device px, a smoothed copy the bump follows, and how much
    // the bump is present at all, so entering and leaving both ease
    const pointer = { x: 0, y: 0, sx: 0, sy: 0, on: false, amount: 0 };

    const draw = (time: number, dt: number) => {
      const s = scene;
      if (!s) return;
      const { step, w, h0, side, ox, oy, dpr } = s;
      const live = !still;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.globalAlpha = live ? ground((time - 0.15) / GROUND_TIME) : 1;
      if (ctx.globalAlpha > 0) ctx.drawImage(s.floor, 0, 0);

      const follow = 1 - Math.exp(-dt * 12);
      if (pointer.on && pointer.amount < 0.02) {
        pointer.sx = pointer.x;
        pointer.sy = pointer.y;
      }
      pointer.sx += (pointer.x - pointer.sx) * follow;
      pointer.sy += (pointer.y - pointer.sy) * follow;
      const target = pointer.on && live ? 1 : 0;
      pointer.amount +=
        (target - pointer.amount) *
        (1 - Math.exp(-dt * (pointer.on ? 5 : 2.5)));

      // Back to the floor under the cube tops: a = x - z, b = x + z
      const pa = (pointer.sx - ox) / step;
      const pb = (pointer.sy + h0 - oy) / (step / 2);
      const px = (pa + pb) / 2;
      const pz = (pb - pa) / 2;
      const bumpGain = BUMP_LIFT * dpr * pointer.amount;
      const twoR2 = 2 * BUMP_RADIUS * BUMP_RADIUS;
      const riseRate = 1 - Math.exp(-dt * 16);
      const settleRate = 1 - Math.exp(-dt * 4.5);

      const introEnd = INTRO_SPREAD + RISE_TIME + 0.15;
      const since = time - introEnd;
      const front = since > 0 ? (since % RIPPLE_PERIOD) * RIPPLE_SPEED : -1e3;
      const rippleGain = RIPPLE_LIFT * dpr;
      const breathGain = 0.6 * dpr;
      const glintScale = (GLINTS - 1) / ((RIPPLE_LIFT + BUMP_LIFT * 0.7) * dpr);

      let alpha = ctx.globalAlpha;
      for (let i = 0; i < mark.count; i++) {
        const p = live ? rise((time - mark.delay[i]) / RISE_TIME) : 1;
        if (p <= 0) continue;

        let lift = 0;
        if (live) {
          const s0 = front - mark.dist[i];
          const pulse =
            s0 < 0
              ? Math.exp(-((s0 / RIPPLE_LEAD) ** 2))
              : Math.exp(-((s0 / RIPPLE_TAIL) ** 2)) * Math.cos(s0 * 0.42);
          const fade = 1 - (mark.dist[i] / mark.maxDist) * 0.35;
          const dx = mark.x[i] - px;
          const dz = mark.z[i] - pz;
          const want = bumpGain * Math.exp(-(dx * dx + dz * dz) / twoR2);
          bump[i] +=
            (want - bump[i]) * (want > bump[i] ? riseRate : settleRate);
          lift =
            (pulse * fade * rippleGain + bump[i]) * p +
            Math.sin(time * 0.7 + mark.phase[i]) * breathGain;
        }

        const h = Math.max(
          0,
          Math.min(side - w / 2, Math.round(h0 * p + lift))
        );
        const gx = ox + mark.a[i] * step;
        const gy = oy + (mark.b[i] * step) / 2;
        const a = Math.min(1, p * 2.5);
        if (a !== alpha) ctx.globalAlpha = alpha = a;
        const tone = mark.tone[i];
        const strip = h + w / 2;
        ctx.drawImage(
          s.sides,
          tone * 2 * w,
          side - strip,
          2 * w,
          strip,
          gx - w,
          gy - h,
          2 * w,
          strip
        );
        const glint = Math.max(
          0,
          Math.min(GLINTS - 1, Math.round(lift * glintScale))
        );
        ctx.drawImage(
          s.tops,
          glint * 2 * w,
          tone * w,
          2 * w,
          w,
          gx - w,
          gy - h - w / 2,
          2 * w,
          w
        );
      }
      ctx.globalAlpha = 1;
    };

    const frame = (now: number) => {
      raf = 0;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      clock += dt;
      draw(clock, dt);
      if (running()) raf = requestAnimationFrame(frame);
    };

    const running = () =>
      !still &&
      inView &&
      document.visibilityState === "visible" &&
      scene !== null;

    const sync = () => {
      if (running()) {
        if (!raf) {
          last = 0;
          raf = requestAnimationFrame(frame);
        }
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const resize = (cssW: number, cssH: number) => {
      if (cssW < 8 || cssH < 8) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      scene = buildScene(mark, cssW, cssH, dpr, corner);
      // Resizing clears the canvas; paint now rather than wait for a frame
      draw(clock, 0);
      sync();
    };

    const ro = new ResizeObserver(([entry]) =>
      resize(entry.contentRect.width, entry.contentRect.height)
    );
    ro.observe(root);

    const io = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      sync();
    });
    io.observe(root);
    document.addEventListener("visibilitychange", sync);

    const move = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const dpr = scene?.dpr ?? 1;
      pointer.x = (e.clientX - r.left) * dpr;
      pointer.y = (e.clientY - r.top) * dpr;
      pointer.on = true;
    };
    const leave = () => {
      pointer.on = false;
    };
    if (host && !still) {
      host.addEventListener("pointermove", move);
      host.addEventListener("pointerleave", leave);
    }

    return () => {
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      host?.removeEventListener("pointermove", move);
      host?.removeEventListener("pointerleave", leave);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      scene = null;
    };
  }, [corner]);

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      style={corner ? CORNER_MASK : SIDE_MASK}
      className={cn("pointer-events-none absolute inset-0", className)}
    >
      <canvas ref={canvasRef} className="block size-full" />
    </div>
  );
}
