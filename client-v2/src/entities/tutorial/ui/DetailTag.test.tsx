import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { initLogger, memoryProvider, resetLogger } from "@/shared/lib/logger";
import { DetailTag } from "./DetailTag";

// The utils barrel reads build-time globals jsdom lacks; the tag uses a sliver.
vi.mock("../../../utils", () => ({
  PgFramework: {
    get: (name: string) =>
      ({
        Seahorse: { icon: "/seahorse.png", circleImage: true },
        Anchor: { icon: "/anchor.png" },
      }[name]),
  },
  PgLanguage: { all: [] },
}));
vi.mock("../../../components/LangIcon", () => ({ default: () => null }));

const tagOf = (text: string) => screen.getByText(text).closest("[data-slot]");

let logged: ReturnType<typeof memoryProvider>;

beforeEach(() => {
  logged = memoryProvider();
  initLogger({ providers: [logged] });
});

afterEach(() => resetLogger());

it("rounds the icon of a framework whose image is a circle", () => {
  render(<DetailTag kind="framework" value="Seahorse" />);
  expect(tagOf("Seahorse")?.className).toContain("[&>img]:rounded-full");
});

it("keeps a square icon for any other framework", () => {
  render(<DetailTag kind="framework" value="Anchor" />);
  expect(tagOf("Anchor")?.className).not.toContain("[&>img]:rounded-full");
});

it("renders an unknown framework's name without an icon and reports it once", () => {
  const { rerender } = render(<DetailTag kind="framework" value="Mystery" />);
  rerender(<DetailTag kind="framework" value="Mystery" />);
  render(<DetailTag kind="framework" value="Mystery" />);

  expect(screen.getAllByText("Mystery")).toHaveLength(2);
  expect(document.querySelector("img")).toBeNull();
  expect(logged.entries).toHaveLength(1);
  expect(logged.entries[0].ns).toBe("tutorial:detail-tag");
  expect(logged.entries[0].report).toBe(true);
  expect(logged.entries[0].context).toEqual({ framework: "Mystery" });
});
