import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// The hooks and utils barrels reach generated globals and wasm packages that
// exist only in the built app, so the panel gets the one hook it uses and no
// server console
vi.mock("../../../../hooks", async () => ({
  useRenderOnChange: (await import("../../../../hooks/useRenderOnChange"))
    .useRenderOnChange,
}));
vi.mock("./ServerConsole", () => ({ __esModule: true, default: () => null }));

import { act, fireEvent, render, screen } from "@testing-library/react";

import { TooltipProvider } from "@/shared/ui/tooltip";

import { MODEL_PROVIDER_PROFILES } from "../model/model-providers";
import { createSkillTools } from "../model/skill-tools";
import { PgAssistant } from "../store";
import Grounding from "./Grounding";

function renderGrounding() {
  return render(
    <TooltipProvider>
      <Grounding />
    </TooltipProvider>
  );
}

/** A skill as `GET /api/skills` lists it */
const listed = (
  id: string,
  source: Record<string, string>,
  { enabled = true, community = false } = {}
) => ({
  id,
  name: `Skill ${id}`,
  description: `About ${id}.`,
  enabled,
  source,
  community: community ? { repo: `owner/${id}` } : undefined,
});

const remote = (id: string) => ({
  type: "remote",
  baseUrl: `https://skills.test/${id}/`,
  entry: "SKILL.md",
});

const PLAYGROUND_ENV = listed("playground-env", { type: "bundled" });
const SOLANA_DEV = listed("solana-dev", remote("solana-dev"));
const ORCA = listed("orca", remote("orca"), {
  enabled: false,
  community: true,
});
const JUPITER = listed("jupiter", remote("jupiter"), {
  enabled: false,
  community: true,
});
const COMMUNITY = [ORCA, JUPITER];
/** Every skill a test may switch, with the state the route lists it in */
const SWITCHABLE = [SOLANA_DEV, ORCA, JUPITER];

/** The skills route answers with `skills`, and every skill file with its URL */
const serve = (skills: unknown[]) =>
  vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input) =>
      String(input) === "/api/skills"
        ? new Response(JSON.stringify({ skills }), { status: 200 })
        : new Response(`text of ${String(input)}`, { status: 200 })
    );

/** List these skills in the store, as the panel does on mount */
const loadSkills = async (skills: unknown[]) => {
  serve(skills);
  await act(() => PgAssistant.loadSkills());
};

const checkbox = (name: string) => screen.getByRole("checkbox", { name });

describe("Grounding", () => {
  beforeEach(() => loadSkills([PLAYGROUND_ENV, SOLANA_DEV, ORCA, JUPITER]));

  afterEach(() => {
    vi.restoreAllMocks();
    PgAssistant.setMcpServers([]);
    for (const skill of SWITCHABLE) {
      PgAssistant.setSkillEnabled(skill.id, skill.enabled);
    }
  });

  it("switches a server off by clicking its name, which the editor then shows", () => {
    PgAssistant.setMcpServers([
      { id: "docs", name: "Docs", url: "https://docs.test/mcp", enabled: true },
    ]);
    const setMcpServerEnabled = vi.spyOn(PgAssistant, "setMcpServerEnabled");

    renderGrounding();
    fireEvent.click(screen.getByText("Docs"));

    expect(setMcpServerEnabled).toHaveBeenCalledWith("docs", false);
    expect(checkbox("Docs").getAttribute("aria-checked")).toBe("false");
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("MCP server configuration")
        .value
    ).toContain('"enabled": false');
  });

  it("A user-added server switched on: its console appears and the editor shows it on", () => {
    vi.spyOn(PgAssistant, "discoverMcpTools").mockResolvedValue();
    PgAssistant.setMcpServers([
      {
        id: "extra",
        name: "Extra",
        url: "https://extra.test/mcp",
        enabled: false,
      },
    ]);

    renderGrounding();
    expect(screen.queryByText("Call a tool")).toBeNull();
    fireEvent.click(checkbox("Extra"));

    expect(screen.getByText("Call a tool")).toBeTruthy();
    expect(PgAssistant.discoverMcpTools).toHaveBeenCalled();
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("MCP server configuration")
        .value
    ).toContain('"enabled": true');
  });

  it("A toggle while the editor is dirty: the server is off and the draft is kept", () => {
    PgAssistant.setMcpServers([
      { id: "docs", name: "Docs", url: "https://docs.test/mcp", enabled: true },
    ]);
    const draft = '[{ "id": "docs", "url": "https://docs.test/mcp" }, ';

    renderGrounding();
    const editor = screen.getByLabelText<HTMLTextAreaElement>(
      "MCP server configuration"
    );
    fireEvent.change(editor, { target: { value: draft } });
    fireEvent.click(checkbox("Docs"));

    expect(PgAssistant.enabledMcpServers).toEqual([]);
    expect(editor.value).toBe(draft);
  });

  it("switches a skill off by clicking its name", () => {
    const setSkillEnabled = vi.spyOn(PgAssistant, "setSkillEnabled");

    renderGrounding();
    expect(checkbox(SOLANA_DEV.name).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByText(SOLANA_DEV.name));

    expect(setSkillEnabled).toHaveBeenCalledWith("solana-dev", false);
    expect(checkbox(SOLANA_DEV.name).getAttribute("aria-checked")).toBe(
      "false"
    );
  });

  it("shows a bundled skill checked and locked, and keeps it on when its name is clicked", () => {
    renderGrounding();
    fireEvent.click(screen.getByText(PLAYGROUND_ENV.name));

    const box = checkbox(PLAYGROUND_ENV.name);
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect(box.hasAttribute("disabled")).toBe(true);
    expect(PgAssistant.enabledSkillIds).toContain("playground-env");
  });

  it("A community skill that starts off: unchecked under the fold, and counted once checked", () => {
    renderGrounding();
    const fold = screen.getByRole("button", { name: /Community skills/ });
    expect(fold.textContent).toContain(`0 of ${COMMUNITY.length} on`);

    fireEvent.click(fold);
    const box = checkbox(ORCA.name);
    expect(box.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(box);
    expect(fold.textContent).toContain(`1 of ${COMMUNITY.length} on`);
  });

  it("A skill withheld by the operator: only the listed skill has a row", async () => {
    await loadSkills([PLAYGROUND_ENV]);

    renderGrounding();

    expect(checkbox(PLAYGROUND_ENV.name)).toBeTruthy();
    expect(screen.queryByText(SOLANA_DEV.name)).toBeNull();
  });

  it("No community skills listed: no fold, heading, or count", async () => {
    await loadSkills([PLAYGROUND_ENV, SOLANA_DEV]);

    renderGrounding();

    expect(checkbox(SOLANA_DEV.name)).toBeTruthy();
    expect(screen.queryByText(/Community skills/)).toBeNull();
    expect(screen.queryByText(/ of \d+ on/)).toBeNull();
  });

  it("The skills route is unreachable: no skill, and a note that the server reported none", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("Failed to fetch")
    );
    await act(() => PgAssistant.loadSkills());

    renderGrounding();

    expect(screen.getByText(/The server reported no skills/)).toBeTruthy();
    expect(screen.queryByText(PLAYGROUND_ENV.name)).toBeNull();
  });

  describe("with a provider on the user's own key", () => {
    beforeEach(() => {
      vi.spyOn(PgAssistant, "connection", "get").mockReturnValue({
        id: "openai",
        apiKey: "sk-test",
      } as typeof PgAssistant.connection);
    });

    afterEach(() => {
      MODEL_PROVIDER_PROFILES.openai.supportsTools = true;
    });

    it("A user with their own key: every community skill unchecked, and one checked loads", async () => {
      renderGrounding();
      fireEvent.click(screen.getByRole("button", { name: /Community skills/ }));
      expect(
        COMMUNITY.map((skill) =>
          checkbox(skill.name).getAttribute("aria-checked")
        )
      ).toEqual(["false", "false"]);

      fireEvent.click(checkbox(ORCA.name));
      const loadSkill = createSkillTools().find((t) => t.name === "load_skill");

      expect(await loadSkill?.run({ id: "orca" }, {})).toBe(
        "text of https://skills.test/orca/SKILL.md"
      );
    });

    it("A profile that declares no tool support: one sentence and no checkbox", () => {
      MODEL_PROVIDER_PROFILES.openai.supportsTools = false;
      PgAssistant.setMcpServers([
        {
          id: "docs",
          name: "Docs",
          url: "https://docs.test/mcp",
          enabled: true,
        },
      ]);

      renderGrounding();

      expect(screen.getByText(/takes no tools/)).toBeTruthy();
      expect(screen.queryAllByRole("checkbox")).toEqual([]);
    });
  });
});
