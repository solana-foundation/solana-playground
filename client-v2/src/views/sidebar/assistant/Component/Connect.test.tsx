// The footer link reaches the utils barrel, whose generated globals exist only
// once the app has booted; what it draws is not under test
vi.mock("../../../../components/Link", () => ({
  default: (props: { children: React.ReactNode }) => (
    <span>{props.children}</span>
  ),
}));

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, type DefaultTheme } from "styled-components";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import Connect from "./Connect";
import { PgSession } from "../../../../features/auth";
import { initLogger, memoryProvider, resetLogger } from "@/shared/lib/logger";
import type { ConnectAction, ConnectProps } from "./Connect";
import { PROVIDERS } from "../model/types";
import { PgAssistant, type Connection } from "../store";

/**
 * A theme that answers every key: the form reads deep theme keys for its
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

const OWN: Connection = {
  id: "openai",
  apiKey: "sk-test-connect-0123456789",
  endpoint: { baseUrl: "https://api.example.test/v1", model: "gpt-x" },
};

/** What the form handed its host last, as the dialog's footer would draw it */
let action: ConnectAction | null;

const renderConnect = (props: Omit<ConnectProps, "frame">) =>
  render(
    <ThemeProvider theme={anyTheme}>
      <Connect
        defaultBackend={props.defaultBackend}
        preset={props.preset}
        frame={(parts) => {
          action = parts.action;
          return <>{parts.form}</>;
        }}
      />
    </ThemeProvider>
  );

/**
 * A real known-step failure ("Allow popups for this site to sign in."): the
 * popup is blocked. Made once per test, before the spy replaces `signIn`.
 */
const blockedPopup = async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ url: "https://github.example/authorize" }),
  } as Response);
  PgSession.setOpenChannel(() => undefined);
  return PgSession.signIn().catch((error: unknown) => error);
};

const checked = () =>
  screen
    .getAllByRole("radio")
    .find((radio) => radio.getAttribute("aria-checked") === "true");

describe("Connect", () => {
  beforeEach(() => {
    action = null;
    PgAssistant.disconnect();
    // The default backend answers only a signed-in user
    void PgSession.refreshWith({
      id: "u1",
      name: null,
      image: null,
      login: null,
    });
  });
  afterEach(() => {
    PgAssistant.disconnect();
    PgSession.reset();
    vi.restoreAllMocks();
  });

  it("labels its fields in sentence case, as the prototype writes them", () => {
    renderConnect({
      defaultBackend: "present",
      preset: { provider: "anthropic" },
    });

    for (const label of ["Backend", "Model", "Effort", "API key"]) {
      expect(screen.getByText(label, { exact: true })).toBeTruthy();
    }
    expect(screen.queryByText(/^(BACKEND|MODEL|EFFORT|API KEY)$/)).toBeNull();
  });

  it("labels an endpoint's base URL and optional key in sentence case", () => {
    renderConnect({
      defaultBackend: "present",
      preset: { provider: "openai" },
    });

    expect(screen.getByText("Base URL", { exact: true })).toBeTruthy();
    expect(
      screen.getByText("API key (optional)", { exact: true })
    ).toBeTruthy();
  });

  it("offers a signed-in user the default with Start", () => {
    renderConnect({ defaultBackend: "present" });

    expect(screen.getByText("no key needed")).toBeTruthy();
    expect(screen.queryByText("sign-in needed")).toBeNull();
    expect(action?.text).toBe("Start");
  });

  describe("signed out", () => {
    beforeEach(() => PgSession.refreshWith(null));

    it("offers sign-in for the default instead of Start", () => {
      renderConnect({ defaultBackend: "present" });

      expect(
        screen.getByText(
          "Sign in with GitHub to use it, or bring your own key below."
        )
      ).toBeTruthy();
      // The tag would otherwise call the backend ready to use
      expect(screen.getByText("sign-in needed")).toBeTruthy();
      expect(screen.queryByText("no key needed")).toBeNull();
      expect(action).toMatchObject({
        text: "Sign in with GitHub",
        ready: true,
      });
    });

    it("signs in from the assistant when the action is pressed", async () => {
      const signIn = vi.spyOn(PgSession, "signIn").mockResolvedValue();
      renderConnect({ defaultBackend: "present" });

      await act(async () => action!.connect());

      expect(signIn).toHaveBeenCalledWith({ from: "assistant" });
      expect(PgAssistant.connection).toBeNull();
    });

    it("shows why a sign-in failed", async () => {
      const failure = await blockedPopup();
      vi.spyOn(PgSession, "signIn").mockRejectedValue(failure);
      renderConnect({ defaultBackend: "present" });

      await act(async () => action!.connect());

      expect((await screen.findByRole("alert")).textContent).toBe(
        "Allow popups for this site to sign in."
      );
    });

    it("reports a sign-in that failed for a reason it does not know", async () => {
      const logged = memoryProvider();
      initLogger({ providers: [logged] });
      vi.spyOn(PgSession, "signIn").mockRejectedValue(
        new TypeError("Failed to fetch")
      );
      renderConnect({ defaultBackend: "present" });

      await act(async () => action!.connect());

      expect((await screen.findByRole("alert")).textContent).toBe(
        "Sign-in failed. Try again."
      );
      expect(logged.entries).toEqual([
        expect.objectContaining({ level: "error", report: true }),
      ]);
      resetLogger();
    });

    it("holds the action while the sign-in runs", async () => {
      vi.spyOn(PgSession, "signInState").mockReturnValue({ status: "pending" });
      renderConnect({ defaultBackend: "present" });

      expect(action).toMatchObject({
        text: "Sign in with GitHub",
        ready: false,
      });
    });

    it("clears the failure when the next sign-in starts", async () => {
      const failure = await blockedPopup();
      vi.spyOn(PgSession, "signIn")
        .mockRejectedValueOnce(failure)
        .mockReturnValueOnce(new Promise(() => {}));
      renderConnect({ defaultBackend: "present" });
      await act(async () => action!.connect());
      await screen.findByRole("alert");

      await act(async () => action!.connect());

      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("offers Start once the user signs in", async () => {
      renderConnect({ defaultBackend: "present" });
      expect(action?.text).toBe("Sign in with GitHub");

      await act(() =>
        PgSession.refreshWith({
          id: "u1",
          name: null,
          image: null,
          login: null,
        })
      );

      expect(action?.text).toBe("Start");
      expect(screen.getByText("no key needed")).toBeTruthy();
      expect(screen.queryByText("sign-in needed")).toBeNull();
    });

    it("connects a key-based backend as before", () => {
      renderConnect({
        defaultBackend: "present",
        preset: { provider: "openai" },
      });

      expect(action?.text).toBe("Connect");
    });
  });

  it("offers no default the deployment does not serve, and falls back to a key", () => {
    renderConnect({ defaultBackend: "absent" });

    expect(screen.getByText(/Not configured on this deployment/)).toBeTruthy();
    expect(checked()?.getAttribute("value")).toBe("anthropic");
  });

  it("neither offers nor rules out the default while the probe is out", () => {
    renderConnect({ defaultBackend: "checking" });

    expect(
      screen.getByText("Checking this deployment for a default backend…")
    ).toBeTruthy();
    expect(checked()).toBeUndefined();
  });

  it("opens on the connected backend with its own key and endpoint", () => {
    PgAssistant.connect(OWN);

    renderConnect({ defaultBackend: "present" });

    expect(checked()?.getAttribute("value")).toBe("openai");
    expect(
      document.querySelector<HTMLInputElement>("#assistant-api-key")?.value
    ).toBe(OWN.apiKey);
    expect(
      document.querySelector<HTMLInputElement>("#assistant-model")?.value
    ).toBe("gpt-x");
  });

  it("opens on a preset backend without the connected one's key", () => {
    PgAssistant.connect(OWN);

    renderConnect({
      defaultBackend: "present",
      preset: { provider: "anthropic" },
    });

    expect(checked()?.getAttribute("value")).toBe("anthropic");
    expect(
      document.querySelector<HTMLInputElement>("#assistant-api-key")?.value
    ).toBe("");
  });

  it("opens on the backend's default model for a preset model it does not list", async () => {
    const user = userEvent.setup();
    renderConnect({
      defaultBackend: "present",
      preset: { provider: "anthropic", model: "claude-unknown-9" },
    });
    await user.type(
      document.querySelector<HTMLInputElement>("#assistant-api-key")!,
      "sk-ant-fake"
    );

    act(() => action!.connect());

    const anthropic = PROVIDERS.find((p) => p.id === "anthropic")!;
    expect(PgAssistant.connection?.settings?.model).toBe(
      anthropic.modelSettings!.defaults.model
    );
  });

  it("puts a preset model into an endpoint's model field", () => {
    renderConnect({
      defaultBackend: "present",
      preset: { provider: "openrouter", model: "vendor/model-x" },
    });

    expect(checked()?.getAttribute("value")).toBe("openrouter");
    expect(
      document.querySelector<HTMLInputElement>("#assistant-model")?.value
    ).toBe("vendor/model-x");
  });

  it("opens on the connected backend without its key when a preset names it", () => {
    PgAssistant.connect(OWN);

    renderConnect({
      defaultBackend: "present",
      preset: { provider: OWN.id, model: "gpt-x" },
    });

    expect(checked()?.getAttribute("value")).toBe(OWN.id);
    expect(
      document.querySelector<HTMLInputElement>("#assistant-api-key")?.value
    ).toBe("");
  });

  it("puts a preset base URL into an endpoint's base URL field", () => {
    renderConnect({
      defaultBackend: "present",
      preset: {
        provider: "openai",
        model: "local-model",
        baseUrl: "http://localhost:1234/v1",
      },
    });

    expect(
      document.querySelector<HTMLInputElement>("#assistant-base-url")?.value
    ).toBe("http://localhost:1234/v1");
    expect(
      document.querySelector<HTMLInputElement>("#assistant-api-key")?.value
    ).toBe("");
  });

  it("starts a preset backend on the preset effort", async () => {
    const user = userEvent.setup();
    renderConnect({
      defaultBackend: "present",
      preset: { provider: "anthropic", effort: "low" },
    });
    await user.type(
      document.querySelector<HTMLInputElement>("#assistant-api-key")!,
      "sk-ant-fake"
    );

    act(() => action!.connect());

    expect(PgAssistant.connection?.settings?.effort).toBe("low");
  });

  it("hands its host the action, ready once the key is in, and connects", async () => {
    const user = userEvent.setup();
    renderConnect({ defaultBackend: "absent" });
    expect(action).toMatchObject({ text: "Connect", ready: false });
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();

    await user.type(
      document.querySelector<HTMLInputElement>("#assistant-api-key")!,
      "sk-ant-fake"
    );
    expect(action).toMatchObject({ text: "Connect", ready: true });
    act(() => action!.connect());
    expect(PgAssistant.connection).toMatchObject({
      id: "anthropic",
      apiKey: "sk-ant-fake",
    });
  });

  it("names the action Start for the keyless default, Switch over a connection", () => {
    const { unmount } = renderConnect({ defaultBackend: "present" });
    expect(action).toMatchObject({ text: "Start", ready: true });
    unmount();

    PgAssistant.connect(OWN);
    renderConnect({ defaultBackend: "present" });
    expect(action?.text).toBe("Switch");
  });

  it("does not repeat the dialog's title or bring a way back", () => {
    renderConnect({ defaultBackend: "present" });

    expect(
      screen.queryByRole("heading", { name: "Connect a model" })
    ).toBeNull();
    expect(screen.queryByText("Back to chat")).toBeNull();
  });

  it("heads its lead with what the assistant is, as the prototype does", () => {
    renderConnect({ defaultBackend: "absent" });

    expect(
      screen.getByRole("heading", {
        name: "An assistant that can see your project",
      })
    ).toBeTruthy();
  });

  it("heads the form Switch backend over a connection", () => {
    act(() => PgAssistant.connect(OWN));
    renderConnect({ defaultBackend: "present" });

    expect(
      screen.getByRole("heading", { name: "Switch backend" })
    ).toBeTruthy();
  });

  it("draws each backend as a card, its radio circle kept for the keyboard only", () => {
    renderConnect({ defaultBackend: "absent" });

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.classList.contains("opacity-0")).toBe(true);
      expect(radio.classList.contains("size-full")).toBe(true);
    }
  });

  it("names the model and the effort as people say them, on High by default", () => {
    renderConnect({
      defaultBackend: "absent",
      preset: { provider: "anthropic" },
    });

    expect(screen.getByRole("combobox", { name: "Model" }).textContent).toBe(
      "Opus 5.5"
    );
    expect(screen.getByRole("combobox", { name: "Effort" }).textContent).toBe(
      "High"
    );
  });
});
