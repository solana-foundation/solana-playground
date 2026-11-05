import type { AccountView } from "@/entities/tutorial";
import type { AccountReading, Press } from "@/features/tutorial-conversation";

/**
 * What the account cards show, worked out from a reading: the energy that has
 * come back since, the heap a read takes, and the line a finished card sums to.
 */

type PlayerView = Extract<AccountView, { kind: "player" }>;
type MemoryView = Extract<AccountView, { kind: "memory" }>;

export const KB = 1024;

/** The heap a program gets */
export const HEAP = 32 * KB;

/** The size realloc adds at a time, so the copy a refused grow asked for */
export const BLOCK = 10 * KB;

const numberOf = (raw: string | undefined): number | undefined => {
  const n = Number(raw);
  return raw === undefined || Number.isNaN(n) ? undefined : n;
};

/**
 * The player as the client sees it at `now`, in ms: the client works the
 * refill out from the account's time, with no transaction.
 */
export const playerNow = ({
  view,
  reading: { fields },
  now,
}: {
  view: PlayerView;
  reading: AccountReading;
  now: number;
}): { energy: number; wood: number; nextMs?: number } => {
  const energy = numberOf(fields[view.energy]) ?? 0;
  const wood = numberOf(fields[view.wood]) ?? 0;
  const from = view.refill && numberOf(fields[view.refill.from]);
  if (!view.refill || from === undefined || energy >= view.max) {
    return { energy, wood };
  }
  const ms = view.refill.seconds * 1000;
  const away = Math.max(0, now - from * 1000);
  const back = Math.min(view.max, energy + Math.floor(away / ms));
  return back >= view.max
    ? { energy: back, wood }
    : { energy: back, wood, nextMs: ms - (away % ms) };
};

/**
 * What reading the account takes from the heap: `Account` copies it whole. A
 * refusal rolled the size back, so its copy is one block over the reading.
 */
export const heapOf = ({
  view,
  reading,
  presses,
}: {
  view: MemoryView;
  reading: AccountReading;
  presses: readonly Press[];
}): number => {
  if (view.zero) return 0;
  return presses[presses.length - 1]?.ok === false
    ? reading.size + BLOCK
    : reading.size;
};

const readingOfPress = ({ result }: Press): AccountReading | undefined =>
  (result.act === "call" || result.act === "run") && result.ok
    ? result.account
    : undefined;

const playerRecord = (view: PlayerView, presses: readonly Press[]) => {
  const energies = presses.flatMap((press) => {
    const energy = numberOf(readingOfPress(press)?.fields[view.energy]);
    return energy === undefined ? [] : [energy];
  });
  // Each chop spends one, so anything over that came back between them
  const back = energies
    .slice(1)
    .map((e, i) => Math.max(0, e - (energies[i] - 1)))
    .reduce((sum, n) => sum + n, 0);
  const count = presses.length;
  return [
    `Chopped ${count} ${count === 1 ? "time" : "times"}`,
    `${presses.filter((p) => p.ok).length} wood`,
    ...(back > 0 ? [`${back} energy came back`] : []),
    ...(presses.some((p) => !p.ok) ? ["out of energy"] : []),
  ].join(" · ");
};

const memoryRecord = ({
  view,
  reading,
  presses,
}: {
  view: MemoryView;
  reading: AccountReading;
  presses: readonly Press[];
}) => {
  // A first press refused grew nothing: the map is what the reading says
  const top = Math.max(
    reading.size,
    ...presses.map((press) => readingOfPress(press)?.size ?? 0)
  );
  const isOut = presses.some((p) => !p.ok);
  const hasGrown = presses.some((p) => p.ok);
  const heap = `of memory at ${Math.round((top + BLOCK) / KB)} KB`;
  if (isOut && !hasGrown) return `Out ${heap}`;
  return [
    `Grew to ${Math.round(top / KB)} KB`,
    ...(isOut ? [`out ${heap}`] : []),
    ...(view.zero && !isOut ? ["nothing copied"] : []),
  ].join(" · ");
};

/** The one line a finished repeating card reads */
export const summedRecord = ({
  view,
  reading,
  presses,
}: {
  view: AccountView;
  reading: AccountReading;
  presses: readonly Press[];
}): string =>
  view.kind === "player"
    ? playerRecord(view, presses)
    : memoryRecord({ view, reading, presses });

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;

  const REFILL = { seconds: 30, from: "lastLogin" };
  const PLAYER: Extract<AccountView, { kind: "player" }> = {
    kind: "player",
    name: "player",
    energy: "energy",
    wood: "wood",
    max: 5,
    refill: REFILL,
  };
  const NO_REFILL: Extract<AccountView, { kind: "player" }> = {
    kind: "player",
    name: "player",
    energy: "energy",
    wood: "wood",
    max: 5,
  };
  const MAP: Extract<AccountView, { kind: "memory" }> = {
    kind: "memory",
    name: "map",
    capacity: 40 * KB,
  };
  const ZERO: Extract<AccountView, { kind: "memory" }> = {
    kind: "memory",
    name: "map",
    capacity: 40 * KB,
    zero: true,
  };

  const playerAt = ({
    energy,
    wood,
  }: {
    energy: number;
    wood: number;
  }): AccountReading => ({
    name: "player",
    address: "Player1",
    size: 32,
    fields: {
      energy: String(energy),
      wood: String(wood),
      lastLogin: "1000",
    },
  });
  const mapAt = (size: number): AccountReading => ({
    name: "map",
    address: "Map1",
    size,
    fields: {},
  });

  const landed = (account: AccountReading): Press => ({
    at: 1,
    ok: true,
    line: "ok",
    signature: "sig",
    result: {
      act: "call",
      ok: true,
      seconds: 1,
      signatures: ["sig"],
      line: "ok",
      called: [],
      account,
    },
  });
  const REFUSED: Press = {
    at: 2,
    ok: false,
    line: "refused",
    signature: "sig",
    result: { act: "call", ok: false, seconds: 1, message: "no", log: "" },
  };

  describe("playerNow", () => {
    it("shows the energy and the time to the next one", () => {
      expect(
        playerNow({
          view: PLAYER,
          reading: playerAt({ energy: 4, wood: 1 }),
          now: 1_000_000,
        })
      ).toEqual({ energy: 4, wood: 1, nextMs: 30_000 });
    });

    it("gives energy back as time passes, with no transaction", () => {
      expect(
        playerNow({
          view: PLAYER,
          reading: playerAt({ energy: 4, wood: 0 }),
          now: 1_030_000,
        })
      ).toEqual({ energy: 5, wood: 0 });
      expect(
        playerNow({
          view: PLAYER,
          reading: playerAt({ energy: 0, wood: 0 }),
          now: 1_045_000,
        })
      ).toEqual({ energy: 1, wood: 0, nextMs: 15_000 });
    });

    it("has no timer before the program refills", () => {
      expect(
        playerNow({
          view: NO_REFILL,
          reading: playerAt({ energy: 0, wood: 0 }),
          now: 9_000_000,
        })
      ).toEqual({ energy: 0, wood: 0 });
    });

    it("reads a missing field as 0, never NaN", () => {
      expect(
        playerNow({
          view: PLAYER,
          reading: { name: "player", address: "P", size: 32, fields: {} },
          now: 1_000_000,
        })
      ).toEqual({ energy: 0, wood: 0 });
    });
  });

  describe("heapOf", () => {
    it("is the copy of the account", () => {
      expect(
        heapOf({
          view: MAP,
          reading: mapAt(20 * KB),
          presses: [landed(mapAt(20 * KB))],
        })
      ).toBe(20 * KB);
    });

    it("after a refusal is the copy that did not fit", () => {
      expect(
        heapOf({
          view: MAP,
          reading: mapAt(30 * KB),
          presses: [landed(mapAt(30 * KB)), REFUSED],
        })
      ).toBe(40 * KB);
    });

    it("is nothing for an account read in place", () => {
      expect(heapOf({ view: ZERO, reading: mapAt(40 * KB), presses: [] })).toBe(
        0
      );
    });
  });

  describe("summedRecord", () => {
    it("sums chops down to a refusal", () => {
      const chops = [4, 3, 2, 1, 0].map((energy, i) =>
        landed(playerAt({ energy, wood: i + 1 }))
      );
      expect(
        summedRecord({
          view: PLAYER,
          reading: playerAt({ energy: 0, wood: 5 }),
          presses: chops.concat(REFUSED),
        })
      ).toBe("Chopped 6 times · 5 wood · out of energy");
    });

    it("counts the energy that came back between chops", () => {
      expect(
        summedRecord({
          view: PLAYER,
          reading: playerAt({ energy: 0, wood: 0 }),
          presses: [
            landed(playerAt({ energy: 0, wood: 5 })),
            landed(playerAt({ energy: 1, wood: 6 })),
          ],
        })
      ).toBe("Chopped 2 times · 2 wood · 2 energy came back");
    });

    it("says one chop in the singular", () => {
      expect(
        summedRecord({
          view: PLAYER,
          reading: playerAt({ energy: 0, wood: 0 }),
          presses: [landed(playerAt({ energy: 4, wood: 1 }))],
        })
      ).toBe("Chopped 1 time · 1 wood");
    });

    it("sums grows up to the refusal", () => {
      expect(
        summedRecord({
          view: MAP,
          reading: mapAt(30 * KB),
          presses: [landed(mapAt(20 * KB)), landed(mapAt(30 * KB)), REFUSED],
        })
      ).toBe("Grew to 30 KB · out of memory at 40 KB");
    });

    it("says a first press refused grew nothing, from the map's own size", () => {
      expect(
        summedRecord({
          view: MAP,
          reading: mapAt(30 * KB),
          presses: [REFUSED],
        })
      ).toBe("Out of memory at 40 KB");
    });

    it("says a map read in place copied nothing", () => {
      expect(
        summedRecord({
          view: ZERO,
          reading: mapAt(40 * KB),
          presses: [landed(mapAt(40 * KB))],
        })
      ).toBe("Grew to 40 KB · nothing copied");
    });
  });
}
