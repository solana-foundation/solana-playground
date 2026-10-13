// `@types/mocha` also declares a global `it`, without `each`
import { expect, it, vi } from "vitest";

import type { Reporter } from "../../../shared/lib/reporter";
import { reporterFeedbackProvider } from "./provider";
import type { Rating } from "./provider";

const fakeReporter = (carried: boolean): Reporter => ({
  carried,
  init: vi.fn(),
  capture: vi.fn(),
  sendFeedback: vi.fn(() => Promise.resolve()),
});

it.each([true, false])(
  "should offer sending only where the reporter is carried: %s",
  (carried) => {
    expect(reporterFeedbackProvider(fakeReporter(carried)).available).toBe(
      carried
    );
  }
);

it.each<[Rating | undefined, Record<string, string | number>]>([
  [4, { type: "feedback", source: "widget", cluster: "devnet", rating: 4 }],
  [undefined, { type: "feedback", source: "widget", cluster: "devnet" }],
])(
  "should hand the reporter the message, contact and tags for rating %s",
  async (rating, tags) => {
    const target = fakeReporter(true);

    await reporterFeedbackProvider(target).send(
      { message: "Deploy is slow", contact: "@fren", rating },
      "devnet"
    );

    expect(target.sendFeedback).toHaveBeenCalledWith({
      message: "Deploy is slow",
      name: "@fren",
      source: "widget",
      tags,
    });
  }
);

it("should pass the reporter's rejection on", async () => {
  const target = fakeReporter(true);
  vi.mocked(target.sendFeedback).mockRejectedValue(new Error("500"));

  await expect(
    reporterFeedbackProvider(target).send({ message: "x" }, "devnet")
  ).rejects.toThrow("500");
});
