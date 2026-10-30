import { afterEach, describe, expect, it, vi } from "vitest";
// The hooks and utils barrels reach generated globals and wasm packages that
// exist only in the built app, so the panel gets the one hook it uses and no
// server console
vi.mock("../../../../hooks", async () => ({
  useRenderOnChange: (await import("../../../../hooks/useRenderOnChange"))
    .useRenderOnChange,
}));
vi.mock("./ServerConsole", () => ({ __esModule: true, default: () => null }));

import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, type DefaultTheme } from "styled-components";

import { TooltipProvider } from "@/shared/ui/tooltip";
import { PgAssistant } from "../store";
import { isAlwaysOn, SKILLS } from "../grounding";
import Grounding from "./Grounding";

// A theme that answers every key: the panel's styled rules read deep tokens
// and the real theme's module needs the utils barrel
const theme: DefaultTheme = new Proxy(
  {},
  {
    get: (_target, key) =>
      key === Symbol.toPrimitive || key === "toString"
        ? () => "inherit"
        : theme,
  }
) as unknown as DefaultTheme;

function renderGrounding() {
  return render(
    <ThemeProvider theme={theme}>
      <TooltipProvider>
        <Grounding />
      </TooltipProvider>
    </ThemeProvider>
  );
}

describe("Grounding", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("switches a server off by clicking its name, which the editor then shows", () => {
    PgAssistant.setMcpServers([
      { id: "docs", name: "Docs", url: "https://docs.test/mcp", enabled: true },
    ]);
    const setMcpServerEnabled = vi.spyOn(PgAssistant, "setMcpServerEnabled");

    renderGrounding();
    fireEvent.click(screen.getByText("Docs"));

    expect(setMcpServerEnabled).toHaveBeenCalledWith("docs", false);
    expect(
      screen
        .getByRole("checkbox", { name: "Docs" })
        .getAttribute("aria-checked")
    ).toBe("false");
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("MCP server configuration")
        .value
    ).toContain('"enabled": false');
    PgAssistant.setMcpServers([]);
  });

  it("switches a skill off by clicking its name", () => {
    const skill = SKILLS.find(
      (s) => !isAlwaysOn(s) && PgAssistant.enabledSkillIds.includes(s.id)
    );
    if (!skill) throw new Error("no switchable skill is enabled by default");
    const setSkillEnabled = vi.spyOn(PgAssistant, "setSkillEnabled");

    renderGrounding();
    const box = screen.getByRole("checkbox", { name: skill.name });
    expect(box.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByText(skill.name));

    expect(setSkillEnabled).toHaveBeenCalledWith(skill.id, false);
    expect(
      screen
        .getByRole("checkbox", { name: skill.name })
        .getAttribute("aria-checked")
    ).toBe("false");
    PgAssistant.setSkillEnabled(skill.id, true);
  });

  it("shows a bundled skill checked and locked, and keeps it on when its name is clicked", () => {
    const skill = SKILLS.find(isAlwaysOn);
    if (!skill) throw new Error("no bundled skill");

    renderGrounding();
    fireEvent.click(screen.getByText(skill.name));

    const box = screen.getByRole("checkbox", { name: skill.name });
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect(box.hasAttribute("disabled")).toBe(true);
    expect(PgAssistant.enabledSkillIds).toContain(skill.id);
  });
});
