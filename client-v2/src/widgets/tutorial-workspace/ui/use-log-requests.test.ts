import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { requests } = vi.hoisted(() => ({
  requests: new Set<() => void>(),
}));
vi.mock("@/features/tutorial-conversation", () => ({
  PgConversation: {
    onDidRequestLog: (cb: () => void) => {
      requests.add(cb);
      return { dispose: () => requests.delete(cb) };
    },
  },
}));

import { useLogRequests } from "./use-log-requests";

const request = () => requests.forEach((cb) => cb());

const drawer = (open: boolean) => {
  const setOpen = vi.fn();
  return { ref: { current: { open, setOpen } }, setOpen };
};

describe("useLogRequests", () => {
  it("opens a closed drawer as the learner's toggle, and lets go on unmount", () => {
    const { ref, setOpen } = drawer(false);
    const box = { current: document.createElement("div") };
    const { unmount } = renderHook(() => useLogRequests(true, ref, box));
    request();
    expect(setOpen).toHaveBeenCalledWith(true, "button");
    unmount();
    expect(requests.size).toBe(0);
  });

  it("leaves an open drawer alone", () => {
    const { ref, setOpen } = drawer(true);
    const box = { current: document.createElement("div") };
    const { unmount } = renderHook(() => useLogRequests(true, ref, box));
    request();
    expect(setOpen).not.toHaveBeenCalled();
    unmount();
  });

  it("does not listen while the workspace is not active, nor act behind a page", () => {
    const { ref, setOpen } = drawer(false);
    const page = document.createElement("div");
    page.setAttribute("inert", "");
    const box = { current: document.createElement("div") };
    page.appendChild(box.current);
    const idle = renderHook(() => useLogRequests(false, ref, box));
    expect(requests.size).toBe(0);
    idle.unmount();
    const behind = renderHook(() => useLogRequests(true, ref, box));
    request();
    expect(setOpen).not.toHaveBeenCalled();
    behind.unmount();
  });
});
