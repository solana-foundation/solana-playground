import { act, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// The utils barrel needs build-time globals the unit runner does not define;
// the row reads only these
vi.mock("../../utils", () => ({
  PgExplorer: {
    onDidSetTabs: () => ({ dispose: () => {} }),
    tabs: ["/src/lib.rs", "/src/state.rs"],
    setTabs: vi.fn(),
    currentFilePath: "/src/lib.rs",
    closeFile: vi.fn(),
  },
  PgView: { ids: { TABS: "tabs" } },
  PgWallet: { show: false },
}));
vi.mock("../../hooks", () => ({
  useExplorer: () => ({
    tabs: ["/src/lib.rs", "/src/state.rs"],
    currentFilePath: "/src/lib.rs",
  }),
  useKeybind: () => {},
  useRenderOnChange: () => undefined,
  useWallet: () => undefined,
}));
// The tabs themselves are not under test, only where the row is drawn
vi.mock("../Dnd", () => ({
  default: {
    Sortable: ({ items }: { items: string[] }) => (
      <>
        {items.map((path) => (
          <span key={path}>{path}</span>
        ))}
      </>
    ),
  },
}));
vi.mock("../Img", () => ({ default: () => undefined }));
vi.mock("@/shared/lib/hooks/use-viewport", () => ({
  useViewport: () => "wide",
}));
// The slice's entry pulls in the whole shell; the row reads only the host
vi.mock("@/widgets/layout-shell", async () => ({
  useEditorHeadHost: (
    await import("@/widgets/layout-shell/model/editor-head-host")
  ).useEditorHeadHost,
}));

import { editorHeadHost } from "@/widgets/layout-shell/model/editor-head-host";

import { Tabs } from "./Tabs";

// The head's ref callback, as React calls it: the host, then its cleanup
let release: (() => void) | undefined;
const setHost = (el: HTMLElement) => {
  release = editorHeadHost(el);
};
const clearHost = () => {
  release?.();
  release = undefined;
};

afterEach(clearHost);

const hostElement = () => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
};

it("renders the row in place where no head is drawn", () => {
  const { container } = render(<Tabs />);
  expect(container.querySelector("#tabs")).not.toBeNull();
});

it("renders the row inside the editor head's host when one is set", () => {
  const host = hostElement();
  setHost(host);
  const { container } = render(<Tabs />);
  expect(host.querySelector("#tabs")).not.toBeNull();
  expect(container.querySelector("#tabs")).toBeNull();
});

it("moves into a host that appears after the row mounted", () => {
  const { container } = render(<Tabs />);
  const host = hostElement();
  act(() => setHost(host));
  expect(host.querySelector("#tabs")).not.toBeNull();
  expect(container.querySelector("#tabs")).toBeNull();
});

it("moves back in place when the head goes away", () => {
  const host = hostElement();
  setHost(host);
  const { container } = render(<Tabs />);
  act(clearHost);
  expect(container.querySelector("#tabs")).not.toBeNull();
  expect(host.querySelector("#tabs")).toBeNull();
});
