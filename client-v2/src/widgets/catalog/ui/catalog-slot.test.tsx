import { expect, it, vi } from "vitest";

vi.mock("./TutorialsPage", () => ({ default: () => null }));
vi.mock("./ProgramsPage", () => ({ default: () => null }));
// The slot only names the page here; nothing renders it
vi.mock("./NewProjectPage", () => ({ default: () => undefined }));
vi.mock("@/utils", () => ({}));

import { requireFor } from "@/test-utils/require-for";

import { catalogPage } from "../model/catalog-page";
import { catalogSlot } from "./catalog-slot";

it("has no slot while no page shows", () => {
  expect(catalogSlot(null)).toBeUndefined();
});

it("names the page shown and closes it", () => {
  const slot = requireFor("the programs slot")(catalogSlot("programs"));
  expect(slot.title).toBe("Programs");
  expect(slot.onClose).toBe(catalogPage.close);
  expect(requireFor("the tutorials slot")(catalogSlot("tutorials")).title).toBe(
    "Tutorials"
  );
  expect(
    requireFor("the new project slot")(catalogSlot("new-project")).title
  ).toBe("New project");
});
