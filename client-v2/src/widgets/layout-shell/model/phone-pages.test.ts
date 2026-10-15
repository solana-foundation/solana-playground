import { describe, expect, it } from "vitest";

import {
  isWorkView,
  pageForStage,
  stageForPage,
  stagePageOf,
} from "./phone-pages";

describe("pageForStage", () => {
  it.each([
    ["build", "work", "preview"],
    ["build", "menu", "preview"],
    ["build", "preview", null],
    ["write", "preview", "work"],
    ["write", "work", null],
    ["write", "menu", null],
  ] as const)("%s seen from %s goes to %s", (stage, page, expected) => {
    expect(pageForStage(stage, page)).toBe(expected);
  });
});

describe("stageForPage", () => {
  it.each([
    ["preview", "write", "deploy", "deploy"],
    ["preview", "interact", "build", null],
    ["work", "build", "build", "write"],
    ["work", "write", "build", null],
    ["menu", "build", "build", null],
    ["menu", "write", "build", null],
  ] as const)(
    "%s seen at %s with %s as the last preview sets %s",
    (page, stage, lastPreview, expected) => {
      expect(stageForPage(page, stage, lastPreview)).toBe(expected);
    }
  );
});

describe("stagePageOf", () => {
  it.each([
    ["write", "work"],
    ["build", "preview"],
    ["deploy", "preview"],
    ["interact", "preview"],
  ] as const)("%s shows on %s", (stage, expected) => {
    expect(stagePageOf(stage)).toBe(expected);
  });
});

describe("isWorkView", () => {
  it.each([
    ["chat", true],
    ["code", true],
    ["preview", false],
    ["", false],
  ])("%j is %s", (value, expected) => {
    expect(isWorkView(value)).toBe(expected);
  });
});
