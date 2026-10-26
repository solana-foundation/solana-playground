import { describe, expect, it } from "vitest";

import { getSrc } from "./platform-icon";

describe("getSrc", () => {
  it.each([
    ["https://www.youtube.com/watch?v=x", "/icons/platforms/youtube.png"],
    ["https://dev.to/post", "/icons/platforms/devto.png"],
    ["https://youtube.com.evil.example/watch", undefined],
    ["https://notyoutube.com/watch", undefined],
    ["not a url", undefined],
  ])("%s -> %s", (url, src) => {
    expect(getSrc(url)).toBe(src);
  });
});
