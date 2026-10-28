import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BaseStartButton } from "./BaseStartButton";

/** A start that settles when the test says so */
const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("BaseStartButton", () => {
  it.each([
    ["new", "Start"],
    ["started", "Continue"],
    ["completed", "Completed"],
  ] as const)("a %s tutorial says %s", (progress, label) => {
    render(
      <BaseStartButton
        progress={progress}
        onStart={async () => {}}
        onError={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: label })).toBeTruthy();
  });

  it.each(["new", "completed"] as const)(
    "a %s tutorial's button is busy until its start settles, and starts once",
    async (progress) => {
      const start = deferred();
      const onStart = vi.fn(() => start.promise);
      render(
        <BaseStartButton
          progress={progress}
          onStart={onStart}
          onError={() => {}}
        />
      );
      const button = screen.getByRole("button");

      await act(async () => {
        fireEvent.click(button);
      });
      expect(button.getAttribute("aria-busy")).toBe("true");
      expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(button);
      expect(onStart).toHaveBeenCalledTimes(1);

      await act(async () => start.resolve());
      expect(button.getAttribute("aria-busy")).toBeNull();
      expect((button as HTMLButtonElement).disabled).toBe(false);
    }
  );

  it.each(["new", "completed"] as const)(
    "a %s tutorial's failed start goes to onError",
    async (progress) => {
      const failure = new Error("no workspace");
      const onError = vi.fn();
      render(
        <BaseStartButton
          progress={progress}
          onStart={() => Promise.reject(failure)}
          onError={onError}
        />
      );

      await act(async () => {
        fireEvent.click(screen.getByRole("button"));
      });
      expect(onError).toHaveBeenCalledWith(failure);
    }
  );
  it.each(["new", "completed"] as const)(
    "a %s tutorial's button takes the caller's layout",
    (progress) => {
      render(
        <BaseStartButton
          progress={progress}
          onStart={async () => {}}
          onError={() => {}}
          className="w-full"
        />
      );
      expect(screen.getByRole("button").classList.contains("w-full")).toBe(
        true
      );
    }
  );
});
