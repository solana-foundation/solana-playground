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

  it("opens the drawer once the Code space a Log switches to stops being inert", async () => {
    const { ref, setOpen } = drawer(false);
    const code = document.createElement("section");
    code.setAttribute("inert", "");
    const box = { current: document.createElement("div") };
    code.appendChild(box.current);
    document.body.appendChild(code);
    const { unmount } = renderHook(() => useLogRequests(true, ref, box));
    request();
    expect(setOpen).not.toHaveBeenCalled();
    code.removeAttribute("inert");
    await vi.waitFor(() =>
      expect(setOpen).toHaveBeenCalledWith(true, "button")
    );
    // Asked once, opened once: a later change of space opens nothing more
    setOpen.mockClear();
    code.setAttribute("inert", "");
    code.removeAttribute("inert");
    await Promise.resolve();
    expect(setOpen).not.toHaveBeenCalled();
    unmount();
    code.remove();
  });

  it("drops a request still waiting when the workspace lets go", async () => {
    const { ref, setOpen } = drawer(false);
    const code = document.createElement("section");
    code.setAttribute("inert", "");
    const box = { current: document.createElement("div") };
    code.appendChild(box.current);
    document.body.appendChild(code);
    const { unmount } = renderHook(() => useLogRequests(true, ref, box));
    request();
    unmount();
    code.removeAttribute("inert");
    await Promise.resolve();
    expect(setOpen).not.toHaveBeenCalled();
    code.remove();
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
