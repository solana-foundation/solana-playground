/* eslint-disable unicorn/no-null -- BaseActCard's props say null for "none" */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountView, ActBeat } from "@/entities/tutorial";
import type {
  AccountOnCard,
  AccountReading,
  Press,
} from "@/features/tutorial-conversation";

import BaseAccountView from "./BaseAccountView";
import BaseActCard from "./BaseActCard";
import BaseTxResultCard from "./BaseTxResultCard";

const KB = 1024;
const START = 1_700_000_000;

const PLAYER: AccountView = {
  kind: "player",
  name: "player",
  energy: "energy",
  wood: "wood",
  max: 5,
  refill: { seconds: 30, from: "lastLogin" },
};
const MAP: AccountView = { kind: "memory", name: "map", capacity: 40 * KB };
const ZERO: AccountView = {
  kind: "memory",
  name: "map",
  capacity: 40 * KB,
  zero: true,
};

const player = (energy: number, wood: number) => ({
  name: "player",
  address: "PlayerPda1111111111111111111111111111111111",
  size: 32,
  fields: {
    energy: String(energy),
    wood: String(wood),
    lastLogin: String(START),
  },
});
const map = (size: number) => ({
  name: "map",
  address: "MapPda11111111111111111111111111111111111111",
  size,
  fields: {},
});

const CHOP: ActBeat = {
  kind: "act",
  id: "chop",
  act: "call",
  title: "Chop",
  context: "Sends chop_tree",
  button: "Chop",
  call: { instruction: "chop_tree" },
  repeat: { label: "Chop until out of energy" },
};

const landed = (n: number, account: AccountReading): Press => ({
  at: n,
  ok: true,
  line: `press ${n}`,
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
const refused = (n: number): Press => ({
  at: n,
  ok: false,
  line: "NotEnoughEnergy · error 6000",
  signature: "sig",
  result: { act: "call", ok: false, seconds: 1, message: "no", log: "" },
});

const card = ({
  state = "live",
  presses,
  account,
}: {
  state?: "live" | "refused";
  presses: Press[];
  account: AccountOnCard;
}) => (
  <BaseActCard
    act={CHOP}
    state={state}
    presses={presses}
    account={account}
    note={null}
    stage={null}
    took={null}
    disabled={false}
    onRun={() => undefined}
  />
);

describe("the account views", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START * 1000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("draws the player: energy, wood, the address and the wait", () => {
    render(
      <BaseAccountView account={{ view: PLAYER, reading: player(4, 1) }} />
    );
    expect(screen.getByRole("img", { name: "4 of 5 energy" })).toBeTruthy();
    expect(screen.getByText("4/5")).toBeTruthy();
    expect(screen.getByText("wood").previousSibling?.textContent).toBe("1");
    expect(screen.getByText("Next energy in", { exact: false })).toBeTruthy();
    expect(screen.getByText("0:30")).toBeTruthy();
  });

  it("counts the wait down and gives the energy back with no transaction", () => {
    render(
      <BaseAccountView account={{ view: PLAYER, reading: player(4, 1) }} />
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("0:29")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(29_000);
    });
    expect(screen.getByText("5/5")).toBeTruthy();
    expect(screen.queryByText("Next energy in", { exact: false })).toBeNull();
  });

  it("shows no wait before the program refills", () => {
    const view: AccountView = {
      kind: "player",
      name: "player",
      energy: "energy",
      wood: "wood",
      max: 5,
    };
    render(<BaseAccountView account={{ view, reading: player(0, 5) }} />);
    expect(screen.getByText("0/5")).toBeTruthy();
    expect(screen.queryByText("Next energy in", { exact: false })).toBeNull();
  });

  it("fills a block per 10 KB against the heap", () => {
    render(
      <BaseAccountView
        account={{ view: MAP, reading: map(20 * KB) }}
        presses={[landed(1, map(20 * KB))]}
        heap
      />
    );
    const blocks = screen.getAllByTestId("memory-block");
    expect(blocks).toHaveLength(4);
    expect(blocks.filter((b) => b.dataset.filled === "true")).toHaveLength(2);
    expect(screen.getByText("20 KB / 40 KB")).toBeTruthy();
    expect(screen.getByText("20 KB / 32 KB")).toBeTruthy();
  });

  it("shows a refused grow's copy red past the heap", () => {
    render(
      <BaseAccountView
        account={{ view: MAP, reading: map(30 * KB) }}
        presses={[landed(1, map(30 * KB)), refused(2)]}
        heap
      />
    );
    expect(screen.getByText("30 KB / 40 KB")).toBeTruthy();
    expect(screen.getByText("40 KB / 32 KB").className).toContain("text-error");
  });

  it("reads a zero copy map as nothing in the heap", () => {
    render(
      <BaseAccountView account={{ view: ZERO, reading: map(40 * KB) }} heap />
    );
    expect(screen.getByText("Big map · zero copy")).toBeTruthy();
    expect(screen.getByText("0 KB, in place")).toBeTruthy();
  });

  it("leaves the heap out of a result card", () => {
    render(<BaseAccountView account={{ view: MAP, reading: map(10 * KB) }} />);
    expect(screen.getByText("10 KB / 40 KB")).toBeTruthy();
    expect(screen.queryByText("Heap")).toBeNull();
  });

  describe("on the act card", () => {
    it("is drawn while the card is live", () => {
      render(
        card({
          account: { view: PLAYER, reading: player(3, 2) },
          presses: [landed(1, player(3, 2))],
        })
      );
      expect(screen.getByText("3/5")).toBeTruthy();
      expect(screen.getByText("press 1")).toBeTruthy();
    });

    it("sums a finished chop card to one line, with no account under it", () => {
      const presses = [4, 3, 2, 1, 0]
        .map((e, i) => landed(i, player(e, i + 1)))
        .concat(refused(9));
      render(
        card({
          state: "refused",
          presses,
          account: { view: PLAYER, reading: player(0, 5) },
        })
      );
      expect(
        screen.getByText("Chopped 6 times · 5 wood · out of energy")
      ).toBeTruthy();
      expect(screen.queryByText("press 1")).toBeNull();
      expect(screen.queryByText("Player account")).toBeNull();
    });

    it("keeps the map under a finished grow card", () => {
      render(
        card({
          state: "refused",
          presses: [landed(1, map(30 * KB)), refused(2)],
          account: { view: MAP, reading: map(30 * KB) },
        })
      );
      expect(
        screen.getByText("Grew to 30 KB · out of memory at 40 KB")
      ).toBeTruthy();
      expect(screen.getByText("40 KB / 32 KB")).toBeTruthy();
    });
  });

  it("draws on the result card the account as its run left it", () => {
    render(
      <BaseTxResultCard
        result={{
          act: "run",
          ok: true,
          seconds: 1,
          signatures: ["sig"],
          line: "ok",
          called: [],
        }}
        account={{ view: PLAYER, reading: player(5, 0) }}
      />
    );
    expect(screen.getByText("Confirmed")).toBeTruthy();
    expect(screen.getByText("Player account")).toBeTruthy();
    expect(screen.getByText("5/5")).toBeTruthy();
  });

  it("keeps a result card as its run left it, with no timer", () => {
    render(
      <BaseAccountView
        account={{ view: PLAYER, reading: player(4, 1) }}
        still
      />
    );
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("4/5")).toBeTruthy();
    expect(screen.queryByText("Next energy in", { exact: false })).toBeNull();
  });
});
