import { createElement } from "react";
import type { FC } from "react";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import { initLogger, memoryProvider, resetLogger } from "@/shared/lib/logger";
import { PgView } from "@/utils/view";
import type { ToastChildProps } from "@/utils/view";
import {
  BUTTON_FAILED_TOAST,
  markFailureShown,
  markUnavailableHere,
  reportButtonFailure,
  wasFailureShown,
} from ".";

let setToast: MockInstance<typeof PgView.setToast>;

beforeEach(() => {
  setToast = vi.spyOn(PgView, "setToast").mockImplementation(() => {});
});

afterEach(() => {
  resetLogger();
  vi.restoreAllMocks();
});

/** Render what the last `setToast` call would have put on screen */
const renderToast = () => {
  const [elementable] = setToast.mock.calls.at(-1)!;
  const Toast = elementable as FC<ToastChildProps>;
  return render(createElement(Toast, { id: BUTTON_FAILED_TOAST }));
};

describe("reportButtonFailure", () => {
  it("logs the failure under ui:button, not marked for reporting", () => {
    const memory = memoryProvider();
    initLogger({ providers: [memory] });
    const failure = new Error("build server down");

    reportButtonFailure("copy")(failure);

    expect(memory.entries).toEqual([
      expect.objectContaining({ ns: "ui:button", error: failure }),
    ]);
    expect(memory.entries[0].report).toBeFalsy();
  });

  it("tells the user what did not happen", () => {
    reportButtonFailure("export the project")(new Error("x"));

    expect(setToast).toHaveBeenCalledTimes(1);
    expect(setToast.mock.calls[0][1]).toEqual({
      options: { name: "button-failed", id: "button-failed" },
    });
    const { container } = renderToast();
    expect(container.textContent).toBe("Could not export the project.");
  });

  // Nothing broke: the action cannot run where it was clicked, and the toast
  // names the way out instead of a failure
  it("says an action cannot run here, and how to get there", () => {
    const failure = new Error("The terminal is not open.");
    markUnavailableHere(failure, "open a project to use the terminal");

    reportButtonFailure("build")(failure);

    const { container } = renderToast();
    expect(container.textContent).toBe(
      "Can't build here: open a project to use the terminal."
    );
  });

  it("still says Could not for a failure not marked unavailable", () => {
    markUnavailableHere(new Error("other"), "open a project");

    reportButtonFailure("build")(new Error("build server down"));

    const { container } = renderToast();
    expect(container.textContent).toBe("Could not build.");
  });

  it("shows nothing for a failure already shown", () => {
    const memory = memoryProvider();
    initLogger({ providers: [memory] });
    const failure = new Error("build failed");
    markFailureShown(failure);

    reportButtonFailure("build")(failure);

    expect(setToast).not.toHaveBeenCalled();
    expect(memory.entries).toEqual([
      expect.objectContaining({ ns: "ui:button", error: failure }),
    ]);
  });

  it("matches a shown string by value", () => {
    markFailureShown("AccountNotFound");

    reportButtonFailure("send SOL")("AccountNotFound");

    expect(setToast).not.toHaveBeenCalled();
  });

  it("forgets a shown string once it has matched", () => {
    markFailureShown("AccountNotFound");

    reportButtonFailure("send SOL")("AccountNotFound");
    reportButtonFailure("fetch the account")("AccountNotFound");

    expect(setToast).toHaveBeenCalledTimes(1);
  });

  // The terminal and the stage can both mark one thrown string
  it("marks a string shown twice as one failure", () => {
    markFailureShown("AccountNotFound");
    markFailureShown("AccountNotFound");

    reportButtonFailure("deploy")("AccountNotFound");
    reportButtonFailure("send SOL")("AccountNotFound");

    expect(setToast).toHaveBeenCalledTimes(1);
  });

  it("never treats null or undefined as shown", () => {
    markFailureShown(undefined);
    markFailureShown(null);

    expect(wasFailureShown(undefined)).toBe(false);
    expect(wasFailureShown(null)).toBe(false);
  });

  it("does not treat another error as shown", () => {
    markFailureShown(new Error("same"));

    reportButtonFailure("build")(new Error("same"));

    expect(setToast).toHaveBeenCalledTimes(1);
  });

  it("keeps at most 20 shown strings", () => {
    for (let i = 0; i <= 20; i++) markFailureShown(`s${i}`);

    expect(wasFailureShown("s0")).toBe(false);
    expect(wasFailureShown("s20")).toBe(true);
  });
});
