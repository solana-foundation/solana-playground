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

import { PgAssistant } from "../store";
import { SKILLS } from "../grounding";
import Grounding from "./Grounding";

function renderGrounding() {
  return render(<Grounding />);
}

describe("Grounding", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("switches a skill off by clicking its name", () => {
    const skill = SKILLS.find((s) =>
      PgAssistant.enabledSkillIds.includes(s.id)
    );
    if (!skill) throw new Error("no skill is enabled by default");
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
  });
});
