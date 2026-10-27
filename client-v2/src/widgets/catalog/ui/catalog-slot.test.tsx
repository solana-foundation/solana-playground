import { expect, it, vi } from "vitest";

vi.mock("./TutorialsPage", () => ({ default: () => null }));
vi.mock("./ProgramsPage", () => ({ default: () => null }));
vi.mock("@/utils", () => ({}));

import { catalogPage } from "../model/catalog-page";
import { catalogSlot } from "./catalog-slot";

it("has no slot while no page shows", () => {
  expect(catalogSlot(null)).toBeUndefined();
});

it("names the page shown and closes it", () => {
  const slot = catalogSlot("programs")!;
  expect(slot.title).toBe("Programs");
  expect(slot.onClose).toBe(catalogPage.close);
  expect(catalogSlot("tutorials")!.title).toBe("Tutorials");
});
