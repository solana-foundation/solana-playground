import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";

import Link from "./Link";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("Link", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (href: string) =>
    act(async () => {
      root.render(
        <MemoryRouter>
          <Link href={href as RoutePath}>text</Link>
        </MemoryRouter>
      );
    });

  const anchor = () => container.querySelector("a");

  it("keeps a local path in the app: no new tab, no external mark", async () => {
    await render("/tutorials/hello");

    expect(anchor()?.getAttribute("href")).toBe("/tutorials/hello");
    expect(anchor()?.getAttribute("target")).toBeNull();
    expect(anchor()?.getAttribute("rel")).toBeNull();
    expect(anchor()?.querySelector("svg")).toBeNull();
  });

  // An address with no scheme names a host just as one over https does
  it.each([
    ["//example.com"],
    ["//example.com/path"],
    ["/\\example.com/path"],
    ["https://example.com/path"],
  ])(
    "opens %s as another site: new tab, no opener, external mark",
    async (href) => {
      await render(href);

      expect(anchor()?.getAttribute("href")).toBe(href);
      expect(anchor()?.getAttribute("target")).toBe("_blank");
      expect(anchor()?.getAttribute("rel")).toBe("noopener noreferrer");
      expect(anchor()?.querySelector("svg")).not.toBeNull();
    }
  );

  it("leaves a relative address on the external branch it always took", async () => {
    await render("docs/page");

    expect(anchor()?.getAttribute("target")).toBe("_blank");
  });
});
