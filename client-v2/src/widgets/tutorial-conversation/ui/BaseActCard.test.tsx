/* eslint-disable unicorn/no-null -- BaseActCard's note, stage and took are null until a run gives them */
import {
  act as actOn,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActBeat } from "@/entities/tutorial";
import type { ActState, Press } from "@/features/tutorial-conversation";

import BaseActCard from "./BaseActCard";

const CHOP: ActBeat = {
  kind: "act",
  id: "s3.chop",
  act: "call",
  title: "Chop",
  context: "Sends chop_tree",
  button: "Chop",
  call: { instruction: "chop_tree" },
  repeat: { label: "Chop until out of energy" },
};

const landed = (n: number): Press => ({
  at: n,
  ok: true,
  line: `+1 wood, press ${n}`,
  signature: "5igAAAAAAAAAAAAAAAAAAAAzzzz",
  result: {
    act: "call",
    ok: true,
    seconds: 1,
    signatures: ["5igAAAAAAAAAAAAAAAAAAAAzzzz"],
    line: `+1 wood, press ${n}`,
    called: [],
  },
});

const refused: Press = {
  at: 99,
  ok: false,
  line: "NotEnoughEnergy · error 6000",
  signature: null,
  result: {
    act: "call",
    ok: false,
    seconds: 1,
    message: "NotEnoughEnergy",
    log: "",
    refused: {
      instruction: "chop_tree",
      error: { code: 6000, name: "NotEnoughEnergy" },
    },
  },
};

const card = (over: {
  state?: ActState;
  presses?: Press[];
  disabled?: boolean;
  onRun?: () => void;
}) => (
  <BaseActCard
    act={CHOP}
    state={over.state ?? "live"}
    presses={over.presses ?? []}
    note={null}
    stage={null}
    took={null}
    disabled={over.disabled ?? false}
    onRun={over.onRun ?? (() => {})}
  />
);

const LABEL = { name: "Chop until out of energy" };

describe("BaseActCard, repeating", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers no second button before a press by hand", () => {
    render(card({}));
    expect(screen.queryByRole("button", LABEL)).toBeNull();
  });

  it("offers it once a press landed, and not after a refusal", () => {
    const { rerender } = render(card({ presses: [landed(1)] }));
    expect(screen.getByRole("button", LABEL)).toBeTruthy();
    rerender(card({ presses: [landed(1), refused] }));
    expect(screen.queryByRole("button", LABEL)).toBeNull();
  });

  it("adds a line per press and shows the last three while live", () => {
    render(card({ presses: [1, 2, 3, 4].map(landed) }));
    const lines = screen.getAllByRole("listitem");
    expect(lines.map((l) => l.textContent)).toEqual([
      "+1 wood, press 25igA…zzzz",
      "+1 wood, press 35igA…zzzz",
      "+1 wood, press 45igA…zzzz",
    ]);
  });

  it("shows every press in the record", () => {
    render(
      card({ state: "refused", presses: [landed(1), landed(2), refused] })
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("Called 3 times")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("presses again 250 ms after each landed press, then stops on Stop", () => {
    const onRun = vi.fn();
    const { rerender } = render(card({ presses: [landed(1)], onRun }));
    fireEvent.click(screen.getByRole("button", LABEL));
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(onRun).not.toHaveBeenCalled();
    actOn(() => vi.advanceTimersByTime(250));
    expect(onRun).toHaveBeenCalledOnce();

    rerender(card({ state: "running", presses: [landed(1)], onRun }));
    actOn(() => vi.advanceTimersByTime(1000));
    expect(onRun).toHaveBeenCalledOnce();

    rerender(card({ presses: [landed(1), landed(2)], onRun }));
    actOn(() => vi.advanceTimersByTime(250));
    expect(onRun).toHaveBeenCalledTimes(2);

    rerender(card({ presses: [landed(1), landed(2), landed(3)], onRun }));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    actOn(() => vi.advanceTimersByTime(1000));
    expect(onRun).toHaveBeenCalledTimes(2);
  });

  it("sends nothing more after a Stop pressed while a call is in flight", () => {
    const onRun = vi.fn();
    const { rerender } = render(card({ presses: [landed(1)], onRun }));
    fireEvent.click(screen.getByRole("button", LABEL));
    rerender(card({ state: "running", presses: [landed(1)], onRun }));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    rerender(card({ presses: [landed(1), landed(2)], onRun }));
    actOn(() => vi.advanceTimersByTime(1000));
    expect(onRun).not.toHaveBeenCalled();
  });

  it("sends nothing after it unmounts", () => {
    const onRun = vi.fn();
    const { unmount } = render(card({ presses: [landed(1)], onRun }));
    fireEvent.click(screen.getByRole("button", LABEL));
    unmount();
    vi.advanceTimersByTime(1000);
    expect(onRun).not.toHaveBeenCalled();
  });

  it("reads its plain record when the step passed with no press", () => {
    render(card({ state: "done" }));
    expect(screen.getByText("Called")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("stops on a refusal", () => {
    const onRun = vi.fn();
    const { rerender } = render(card({ presses: [landed(1)], onRun }));
    fireEvent.click(screen.getByRole("button", LABEL));
    rerender(card({ presses: [landed(1), refused], onRun }));
    actOn(() => vi.advanceTimersByTime(1000));
    expect(onRun).not.toHaveBeenCalled();
  });

  it("stops when a failed press's card takes over, and does not resume after it", () => {
    const onRun = vi.fn();
    const { rerender } = render(card({ presses: [landed(1)], onRun }));
    fireEvent.click(screen.getByRole("button", LABEL));
    rerender(card({ presses: [landed(1)], disabled: true, onRun }));
    actOn(() => vi.advanceTimersByTime(1000));
    rerender(card({ presses: [landed(1)], onRun }));
    actOn(() => vi.advanceTimersByTime(1000));
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.getByRole("button", LABEL)).toBeTruthy();
  });

  it("draws no lines and no second button on a card with no repeat", () => {
    render(
      <BaseActCard
        act={{
          kind: "act",
          id: "s1.build",
          act: "build",
          title: "Build",
          context: "Compiles",
          button: "Build",
        }}
        state="live"
        presses={[]}
        note={null}
        stage={null}
        took={null}
        disabled={false}
        onRun={() => {}}
      />
    );
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});

describe("BaseActCard, a deploy under way", () => {
  const DEPLOY: ActBeat = {
    kind: "act",
    id: "s2.deploy",
    act: "deploy",
    title: "Deploy to devnet",
    context: "From your Playground wallet · free devnet SOL",
    button: "Deploy",
  };

  it("draws its progress under the title at any width, not beside it", () => {
    render(
      <BaseActCard
        act={DEPLOY}
        state="running"
        presses={[]}
        note={null}
        stage={{
          beatId: "s2.deploy",
          label: "Writing buffer",
          index: 1,
          count: 3,
        }}
        took={null}
        disabled={false}
        onRun={() => {}}
      />
    );
    const title = screen.getByText("Deploy to devnet");
    const progress = screen.getByText("Writing buffer");
    // The title's row holds the icon and the text only
    const row = title.parentElement?.parentElement;
    expect(row?.contains(progress)).toBe(false);
    // A column, so the progress takes a line of its own under the title
    expect(
      screen.getByRole("form", { name: "Deploy to devnet" }).className
    ).toContain("flex-col");
    expect(screen.getByText("1 of 3")).toBeTruthy();
  });
});

describe("BaseActCard, a call that takes a name", () => {
  const HELLO: ActBeat = {
    kind: "act",
    id: "s3.hello",
    act: "call",
    title: "Say hello",
    context: "Sends hello",
    button: "Say hello",
    call: { instruction: "hello", args: ["name"] },
  };

  it("does not give the button beside the field the narrow card's full width", () => {
    render(
      <BaseActCard
        act={HELLO}
        state="live"
        presses={[]}
        note={null}
        stage={null}
        took={null}
        disabled={false}
        onRun={() => {}}
      />
    );
    const field = screen.getByRole("textbox", { name: "name" });
    const button = screen.getByRole("button", { name: /Say hello/ });
    // The row does not wrap: a full-width button would squeeze the field to
    // nothing (jsdom draws no layout, so the class is what the test reads)
    expect(field.parentElement?.contains(button)).toBe(true);
    expect(button.className).not.toContain("w-full");
  });
});

describe("BaseActCard, a lone action", () => {
  const BUILD: ActBeat = {
    kind: "act",
    id: "s1.build",
    act: "build",
    title: "Build the program",
    context: "Compiles on the build server",
    button: "Build",
  };

  it("gives its button the narrow card's full width, so the title keeps its line", () => {
    render(
      <BaseActCard
        act={BUILD}
        state="live"
        presses={[]}
        note={null}
        stage={null}
        took={null}
        disabled={false}
        onRun={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: /Build/ }).className).toContain(
      "@max-lg/act:w-full"
    );
  });
});
