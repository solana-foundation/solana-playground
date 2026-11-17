import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";

import { initLogger, memoryProvider, resetLogger } from "./logger";
import { Outlet, OutletContent, useOutletNode } from "./outlet";

const mounts = vi.fn();
const Counter = () => {
  const [n, setN] = useState(0);
  useEffect(() => mounts(), []);
  return <button onClick={() => setN(n + 1)}>count {n}</button>;
};

const Host = ({ where }: { where: "a" | "b" }) => {
  const node = useOutletNode("flex");
  return (
    <>
      <OutletContent node={node}>
        <Counter />
      </OutletContent>
      <div data-testid="a">{where === "a" && <Outlet node={node} />}</div>
      <div data-testid="b">{where === "b" && <Outlet node={node} />}</div>
    </>
  );
};

it("moves its content between places without remounting it", () => {
  mounts.mockClear();
  const { rerender } = render(<Host where="a" />);
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByTestId("a").textContent).toBe("count 1");
  act(() => rerender(<Host where="b" />));
  expect(screen.getByTestId("b").textContent).toBe("count 1");
  expect(screen.getByTestId("a").childNodes).toHaveLength(0);
  expect(mounts).toHaveBeenCalledTimes(1);
});

it("gives the node the class it was made with", () => {
  render(<Host where="a" />);
  const node = screen.getByTestId("a").firstElementChild?.firstElementChild;
  expect(node?.classList.contains("flex")).toBe(true);
});

describe("two Outlets for one node", () => {
  afterEach(resetLogger);

  it("is reported once, when the second mounts", () => {
    const logs = memoryProvider();
    initLogger({ providers: [logs] });
    const Twice = () => {
      const node = useOutletNode("flex");
      return (
        <>
          <Outlet node={node} />
          <Outlet node={node} />
        </>
      );
    };
    render(<Twice />);
    expect(logs.entries).toEqual([
      expect.objectContaining({
        ns: "shared:outlet",
        level: "warn",
        report: true,
      }),
    ]);
  });

  it("is not reported when a place is swapped for another", () => {
    const logs = memoryProvider();
    initLogger({ providers: [logs] });
    const { rerender } = render(<Host where="a" />);
    act(() => rerender(<Host where="b" />));
    expect(logs.entries).toEqual([]);
  });
});

describe("a move", () => {
  // The browser drops an element's scroll offset when it leaves the document;
  // jsdom keeps none, so the scroller records what was set on it
  const Scroller = ({ sets }: { sets: number[] }) => (
    <div
      data-testid="scroller"
      style={{ overflowY: "auto" }}
      ref={(el) => {
        if (!el || Object.hasOwn(el, "scrollTop")) return;
        let top = 0;
        Object.defineProperty(el, "scrollTop", {
          get: () => top,
          set: (value: number) => {
            top = value;
            sets.push(value);
          },
        });
      }}
    >
      <button>inside</button>
    </div>
  );
  const Moving = ({
    where,
    sets,
  }: {
    where: "a" | "b" | "none";
    sets: number[];
  }) => {
    const node = useOutletNode("flex");
    return (
      <>
        <OutletContent node={node}>
          <Scroller sets={sets} />
        </OutletContent>
        <div data-testid="a">{where === "a" && <Outlet node={node} />}</div>
        <div data-testid="b">{where === "b" && <Outlet node={node} />}</div>
      </>
    );
  };

  it("gives a scrolled element its offset back in the new place", () => {
    const sets: number[] = [];
    const { rerender } = render(<Moving where="a" sets={sets} />);
    screen.getByTestId("scroller").scrollTop = 120;
    sets.length = 0;
    act(() => rerender(<Moving where="b" sets={sets} />));
    expect(sets).toEqual([120]);
  });

  it("gives focus back to what held it", () => {
    const sets: number[] = [];
    const { rerender } = render(<Moving where="a" sets={sets} />);
    const button = screen.getByRole("button", { name: "inside" });
    button.focus();
    act(() => rerender(<Moving where="b" sets={sets} />));
    expect(screen.getByTestId("b").contains(button)).toBe(true);
    expect(document.activeElement).toBe(button);
  });

  it("gives nothing back once the node has been away past its commit", async () => {
    const sets: number[] = [];
    const { rerender } = render(<Moving where="a" sets={sets} />);
    const button = screen.getByRole("button", { name: "inside" });
    screen.getByTestId("scroller").scrollTop = 120;
    button.focus();
    act(() => rerender(<Moving where="none" sets={sets} />));
    await act(async () => await Promise.resolve());
    sets.length = 0;
    act(() => rerender(<Moving where="b" sets={sets} />));
    expect(sets).toEqual([]);
    expect(document.activeElement).not.toBe(button);
  });
});
