import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";

import { useSyncedOpen } from "./useSyncedOpen";

it("starts from isOpen", () => {
  expect(renderHook(() => useSyncedOpen(true)).result.current[0]).toBe(true);
  expect(renderHook(() => useSyncedOpen()).result.current[0]).toBe(false);
});

it("opens again when isOpen later becomes true", () => {
  const { result, rerender } = renderHook(
    ({ isOpen }) => useSyncedOpen(isOpen),
    { initialProps: { isOpen: false } }
  );

  rerender({ isOpen: true });
  expect(result.current[0]).toBe(true);

  act(() => result.current[1](false));
  expect(result.current[0]).toBe(false);

  rerender({ isOpen: false });
  rerender({ isOpen: true });
  expect(result.current[0]).toBe(true);
});
