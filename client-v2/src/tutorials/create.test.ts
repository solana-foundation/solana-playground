// `createTutorial` reads the build's `CUSTOM_TUTORIALS`; mocks the utils barrel for the one helper it calls here
import { describe, expect, it, vi } from "vitest";

vi.mock("../utils", () => ({
  PgCommon: {
    toKebabFromTitle: (title: string) =>
      title.toLowerCase().replaceAll(" ", "-"),
  },
}));
vi.stubGlobal("MARKDOWN_TUTORIALS", []);
vi.stubGlobal("CUSTOM_TUTORIALS", {
  "with-assets": { pageCount: 2, thumbnail: "thumbnail.jpg" },
  "pages-in-src": { pageCount: 2 },
});

const { createTutorial } = await import("./create");

describe("tutorials/create", () => {
  it.each([
    {
      title: "points at the thumbnail its asset folder holds",
      name: "With Assets",
      thumbnail: "/tutorials/with-assets/thumbnail.jpg",
    },
    {
      title: "gives no thumbnail to a tutorial without an asset folder",
      name: "Pages In Src",
      thumbnail: undefined,
    },
  ])("$title", ({ name, thumbnail }) => {
    expect(
      createTutorial({
        name,
        description: "",
        authors: [],
        level: "Beginner",
      }).thumbnail
    ).toBe(thumbnail);
  });
});
