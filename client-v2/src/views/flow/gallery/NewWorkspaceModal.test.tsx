import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, type DefaultTheme } from "styled-components";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { initLogger, memoryProvider, resetLogger } from "@/shared/lib/logger";

// The `@/utils` barrel needs a booted app; the modal uses these three
vi.mock("../../../utils", () => ({
  PgCommon: {
    fetchJSON: async (url: string) => (await fetch(url)).json(),
  },
  PgTutorial: { all: [] },
  PgView: { setModal: vi.fn() },
}));
vi.mock("@/widgets/overlays", () => ({
  ModalFrame: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../../components/Button", () => ({
  default: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick: () => void;
  }) => <button onClick={onClick}>{children}</button>,
}));
vi.mock("./StartFromScratch", () => ({ default: () => null }));
vi.mock("./TutorialsTab", () => ({
  default: () => null,
  Empty: "p",
}));
vi.mock("./ProgramsTab", () => ({
  default: ({ programs }: { programs: unknown[] | null }) => (
    <p>{programs ? `${programs.length} programs` : "loading"}</p>
  ),
}));

import NewWorkspaceModal from "./NewWorkspaceModal";

// A theme that answers every key: none of the styles matters here
const anyTheme: DefaultTheme = new Proxy(
  {},
  {
    get: (_, key) =>
      key === Symbol.toPrimitive || key === "toString"
        ? () => "inherit"
        : anyTheme,
  }
) as unknown as DefaultTheme;

const listing = {
  name: "Counter",
  description: "",
  repo: "a/b",
  icon: "",
  framework: "Anchor",
  categories: [],
};

let logged: ReturnType<typeof memoryProvider>;
beforeEach(() => {
  logged = memoryProvider();
  initLogger({ providers: [logged] });
});
afterEach(() => {
  resetLogger();
  vi.restoreAllMocks();
});

const draw = () =>
  render(
    <ThemeProvider theme={anyTheme}>
      <NewWorkspaceModal initialTab="programs" />
    </ThemeProvider>
  );

it("lists the programs the registry returns", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify([listing]))
  );
  draw();
  expect(await screen.findByText("1 programs")).toBeTruthy();
});

it("reports a failed programs fetch and offers a retry that recovers", async () => {
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(new Response(JSON.stringify([listing])));
  draw();

  expect(await screen.findByText(/could not load the programs/i)).toBeTruthy();
  expect(logged.entries).toHaveLength(1);
  expect(logged.entries[0].report).toBe(true);
  expect(screen.queryByText("0 programs")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Retry" }));

  await waitFor(() => expect(screen.getByText("1 programs")).toBeTruthy());
  expect(fetchSpy).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(/could not load the programs/i)).toBeNull();
});
