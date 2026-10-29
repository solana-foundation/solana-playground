// The utils barrel reaches generated globals and wasm packages that exist only
// in the built app
vi.mock("../../../../utils", () => ({ PgConnection: { cluster: "devnet" } }));

import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, type DefaultTheme } from "styled-components";
import { afterEach, expect, it, vi } from "vitest";

import { PgAssistant } from "../store";
import type { McpServerEntry } from "@/features/mcp";
import ServerConsole from "./ServerConsole";

// A theme that answers every key: the console's styled rules read deep tokens
const theme: DefaultTheme = new Proxy(
  {},
  {
    get: (_target, key) =>
      key === Symbol.toPrimitive || key === "toString"
        ? () => "inherit"
        : theme,
  }
) as unknown as DefaultTheme;

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

  render(
    <ThemeProvider theme={theme}>
      <ServerConsole server={server} providerName="Anthropic" />
    </ThemeProvider>
  );
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "search" },
  });

  const toggle = screen.getByRole("button", { name: "Show more" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");

  fireEvent.click(toggle);

  const open = screen.getByRole("button", { name: "Show less" });
  expect(open.getAttribute("aria-expanded")).toBe("true");
});
