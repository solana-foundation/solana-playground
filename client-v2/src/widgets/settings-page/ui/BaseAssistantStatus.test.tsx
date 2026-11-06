import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { HostedModel } from "./BaseAssistantStatus";
import BaseAssistantStatus from "./BaseAssistantStatus";

const draw = (hosted: HostedModel, online: boolean) => {
  const onRetry = vi.fn(() => Promise.resolve());
  render(
    <BaseAssistantStatus
      hosted={hosted}
      online={online}
      onRetry={onRetry}
      phone={false}
    />
  );
  return onRetry;
};

const dot = () =>
  document
    .querySelector('[data-slot="status-dot"]')
    ?.getAttribute("data-variant");

describe("BaseAssistantStatus", () => {
  it.each([
    {
      hosted: "checking",
      word: "Checking",
      help: "Asking whether the hosted model answers.",
      variant: "running",
    },
    {
      hosted: "present",
      word: "Ready",
      help: "Hosted model. No key needed.",
      variant: "success",
    },
    {
      hosted: "absent",
      word: "Not offered",
      help: "This build has no hosted model. The assistant asks for a key.",
      variant: "idle",
    },
    {
      hosted: "unreachable",
      word: "Not answering",
      help: "The hosted model is not answering. The assistant asks for a key.",
      variant: "warning",
    },
  ] as const)(
    "reads $hosted online as $word, with its help line",
    ({ hosted, word, help, variant }) => {
      draw(hosted, true);
      expect(screen.getByText(word)).toBeTruthy();
      expect(screen.getByText(help)).toBeTruthy();
      expect(dot()).toBe(variant);
    }
  );

  it("reads Offline while the browser is offline, the status bar's AI word, and blames no model", () => {
    draw("unreachable", false);
    expect(screen.getByText("Offline")).toBeTruthy();
    expect(screen.queryByText("Not answering")).toBeNull();
    expect(screen.queryByText(/not answering/)).toBeNull();
    expect(dot()).toBe("idle");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("asks the hosted model again on Try again, when it is not answering", async () => {
    const onRetry = draw("unreachable", true);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it.each(["checking", "present", "absent"] as const)(
    "offers no Try again when the model is %s",
    (hosted) => {
      draw(hosted, true);
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    }
  );
});

describe("BaseAssistantStatus over time", () => {
  const propsWith = (onRetry: () => Promise<unknown>) => (online: boolean) => ({
    hosted: "unreachable" as const,
    online,
    onRetry,
    phone: false,
  });

  it("asks the hosted model again once the browser is back online", () => {
    const onRetry = vi.fn(() => Promise.resolve());
    const { rerender } = render(
      <BaseAssistantStatus {...propsWith(onRetry)(false)} />
    );
    expect(onRetry).not.toHaveBeenCalled();

    rerender(<BaseAssistantStatus {...propsWith(onRetry)(true)} />);
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<BaseAssistantStatus {...propsWith(onRetry)(true)} />);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not ask again on opening while online", () => {
    const onRetry = vi.fn(() => Promise.resolve());
    render(<BaseAssistantStatus {...propsWith(onRetry)(true)} />);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("says when it last asked after a Try again that is still not answered", async () => {
    render(
      <BaseAssistantStatus
        {...propsWith(vi.fn(() => Promise.resolve()))(true)}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByText(/^Still not answering, asked at \d{1,2}:\d{2}/)
    ).toBeTruthy();
  });
});

describe("BaseAssistantStatus after a Try again is answered", () => {
  it("keeps the focus on the row once Try again goes away", async () => {
    const onRetry = vi.fn(() => Promise.resolve());
    const { rerender } = render(
      <BaseAssistantStatus
        hosted="unreachable"
        online
        onRetry={onRetry}
        phone={false}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    rerender(
      <BaseAssistantStatus
        hosted="present"
        online
        onRetry={onRetry}
        phone={false}
      />
    );

    expect(document.activeElement).toBe(screen.getByText("Ready"));
  });
});
