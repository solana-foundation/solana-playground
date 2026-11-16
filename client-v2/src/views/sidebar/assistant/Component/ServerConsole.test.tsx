import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// The utils barrel reaches generated globals and wasm packages that exist only
// in the built app
vi.mock("../../../../utils", () => ({ PgConnection: { cluster: "devnet" } }));

import type { McpServerEntry } from "@/features/mcp";

import { PgAssistant } from "../store";
import ServerConsole from "./ServerConsole";

const server: McpServerEntry = {
  id: "docs",
  name: "Docs",
  url: "https://example.com/mcp",
  enabled: true,
};

afterEach(() => vi.restoreAllMocks());

it("flips Show more and Show less and says which state it is in", () => {
  vi.spyOn(PgAssistant, "mcpTools", "get").mockReturnValue({
    docs: [{ name: "search", description: "x".repeat(300), inputSchema: {} }],
  });

  render(<ServerConsole server={server} providerName="Anthropic" scope="" />);
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "search" },
  });

  const toggle = screen.getByRole("button", { name: "Show more" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");

  fireEvent.click(toggle);

  const open = screen.getByRole("button", { name: "Show less" });
  expect(open.getAttribute("aria-expanded")).toBe("true");
});

// A tool description is the MCP server's text: an image in it would be
// fetched with no click, so every one shows as text, a local one too
it("shows an image in a tool description as text, never loads it", () => {
  vi.spyOn(PgAssistant, "mcpTools", "get").mockReturnValue({
    docs: [
      {
        name: "search",
        description:
          "Searches. ![Tracker](https://example.com/pixel.png) ![Logo](/logo.png)",
        inputSchema: {},
      },
    ],
  });

  const { container } = render(
    <ServerConsole server={server} providerName="Anthropic" scope="" />
  );
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "search" },
  });

  expect(container.querySelector("img")).toBeNull();
  expect(
    screen.getByText("Tracker (https://example.com/pixel.png)")
  ).toBeTruthy();
  expect(screen.getByText("Logo (/logo.png)")).toBeTruthy();
});
