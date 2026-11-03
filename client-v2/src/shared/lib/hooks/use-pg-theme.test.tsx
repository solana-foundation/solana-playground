import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

type Listener = () => void;

const { theme, listeners, disposed, subscribe } = vi.hoisted(() => {
  const disposed = { count: 0 };
  return {
    theme: { current: { name: "Dark" } },
    listeners: { name: [] as Listener[], font: [] as Listener[] },
    disposed,
    subscribe: (list: Listener[]) => (cb: Listener) => {
      list.push(cb);
      return { dispose: () => disposed.count++ };
    },
  };
});

vi.mock("@/utils", () => ({
  PgTheme: {
    get theme() {
      return theme.current;
    },
    onDidChangeThemeName: subscribe(listeners.name),
    onDidChangeFontFamily: subscribe(listeners.font),
  },
  // The batching itself is `PgCommon`'s; here every change applies at once
  PgCommon: {
    batchChanges: (
      cb: Listener,
      onChanges: Array<(cb: Listener) => { dispose: () => void }>
    ) => {
      const subs = onChanges.map((onChange) => onChange(cb));
      return { dispose: () => subs.forEach((sub) => sub.dispose()) };
    },
  },
}));

import { usePgTheme } from "./use-pg-theme";

const Probe = () => <span data-testid="name">{usePgTheme().name}</span>;

describe("usePgTheme", () => {
  it("re-renders on a theme change and on a font change, and unsubscribes", () => {
    const { unmount } = render(<Probe />);
    expect(screen.getByTestId("name").textContent).toBe("Dark");

    theme.current = { name: "Light" };
    act(() => listeners.name.forEach((cb) => cb()));
    expect(screen.getByTestId("name").textContent).toBe("Light");

    theme.current = { name: "Light, Hack" };
    act(() => listeners.font.forEach((cb) => cb()));
    expect(screen.getByTestId("name").textContent).toBe("Light, Hack");

    unmount();
    expect(disposed.count).toBe(2);
  });
});
