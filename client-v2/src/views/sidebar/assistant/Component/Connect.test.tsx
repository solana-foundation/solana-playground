// The legacy form controls pull in the utils barrel, whose generated globals
// exist only once the app has booted. Which backend the picker reconnects to
// is all that is under test, so plain elements stand in.
vi.mock("../../../../components/GradientButton", () => ({
  default: (props: { children: React.ReactNode }) => (
    <button>{props.children}</button>
  ),
}));
vi.mock("../../../../components/Input", () => ({
  default: (props: { id?: string }) => <input id={props.id} />,
}));
vi.mock("../../../../components/Link", () => ({
  default: (props: { children: React.ReactNode }) => (
    <span>{props.children}</span>
  ),
}));
vi.mock("../../../../components/Select", () => ({ default: () => null }));

import { render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, type DefaultTheme } from "styled-components";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import Connect from "./Connect";
import { initLogger, memoryProvider, resetLogger } from "@/shared/lib/logger";
import { PgAssistant, type Connection } from "../store";

/**
 * A theme that answers every key: the picker reads deep theme keys for its
 * styles, none of which matters here, and the real theme needs the utils
 * barrel.
 */
const anyTheme: DefaultTheme = new Proxy(
  {},
  {
    get: (_, key) =>
      key === Symbol.toPrimitive || key === "toString"
        ? () => "inherit"
        : anyTheme,
  }
) as unknown as DefaultTheme;

const KEY = "sk-test-connect-0123456789";
const OWN: Connection = {
  id: "openai",
  apiKey: KEY,
  endpoint: { baseUrl: "https://api.example.test/v1", model: "gpt-x" },
};

/** Answer the default-backend probe with this body and status */
const probeAnswers = (body: string, status = 200) =>
  vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      new Response(body, { status, headers: { "content-type": "json" } })
    );

const renderConnect = () =>
  render(
    <ThemeProvider theme={anyTheme}>
      <Connect />
    </ThemeProvider>
  );

describe("Connect", () => {
  beforeEach(() => {
    // Disconnecting forgets both stores, so it comes before the seeding
    PgAssistant.disconnect();
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetLogger();
  });

  it("reconnects this tab's key-based backend over a remembered default", async () => {
    sessionStorage.setItem("assistant.connection", JSON.stringify(OWN));
    localStorage.setItem("assistant.backend", "default");
    const probe = probeAnswers(JSON.stringify({ configured: true }));

    renderConnect();

    // The default's description shows once the probe has said yes, which is
    // when the default's own reconnect gets its chance
    await screen.findByText(/The agentic backend this playground/);
    expect(probe).toHaveBeenCalled();
    expect(PgAssistant.connection).toMatchObject({ id: "openai", apiKey: KEY });
    expect(sessionStorage.getItem("assistant.connection")).toContain(KEY);
  });

  it("logs a probe the server refused, and offers no default", async () => {
    const logged = memoryProvider();
    initLogger({ providers: [logged] });
    probeAnswers("upstream down", 503);

    renderConnect();

    await screen.findByText(/Not configured on this deployment/);
    expect(logged.entries).toContainEqual(
      expect.objectContaining({
        ns: "assistant:connect",
        level: "warn",
        context: { status: 503 },
        report: false,
      })
    );
  });

  it("treats a probe that answers JSON null as no default", async () => {
    probeAnswers("null");

    renderConnect();

    await screen.findByText(/Not configured on this deployment/);
    await waitFor(() => expect(PgAssistant.connection).toBeNull());
  });
});
