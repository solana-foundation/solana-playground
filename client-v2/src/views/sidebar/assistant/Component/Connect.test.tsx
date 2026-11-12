// The key's link reaches the utils barrel, whose generated globals exist only
// once the app has booted; a plain anchor stands in for it
vi.mock("../../../../components/Link", () => ({
  default: (props: { href: string; children: React.ReactNode }) => (
    <a href={props.href}>{props.children}</a>
  ),
}));

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initLogger, memoryProvider, resetLogger } from "@/shared/lib/logger";
import { requireFor } from "@/test-utils/require-for";

import { PgSession } from "../../../../features/auth";
import { PROVIDERS } from "../model/types";
import { type Connection, PgAssistant } from "../store";
import type { ConnectAction, ConnectProps } from "./Connect";
import Connect from "./Connect";

const OWN: Connection = {
  id: "openai",
  apiKey: "sk-test-connect-0123456789",
  endpoint: { baseUrl: "https://api.example.test/v1", model: "gpt-x" },
};

/** What the form handed its host last, as the dialog's footer would draw it */
let action: ConnectAction | null;

/** Presses the action Connect handed its host */
const connect = () =>
  requireFor("the action Connect hands its host")(action).connect();

const renderConnect = (props: Omit<ConnectProps, "frame">) =>
  render(
    <Connect
      defaultBackend={props.defaultBackend}
      preset={props.preset}
      frame={(parts) => {
        action = parts.action;
        return <>{parts.form}</>;
      }}
    />
  );

/**
 * A real known-step failure ("Allow pop-ups for this site to sign in with GitHub."): the
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

/** The assistant's sign-in, `PgSession.signInFor("assistant")`, fails with `error` */
const signInRejects = (error: unknown) =>
  vi
    .spyOn(PgSession, "signInFor")
    .mockReturnValue(
      vi.fn<(scopes: string[]) => Promise<void>>().mockRejectedValue(error)
    );

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
      name: undefined,
      image: undefined,
      login: undefined,
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
    beforeEach(() => PgSession.refreshWith(undefined));

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
      const signIn = vi.fn<(scopes: string[]) => Promise<void>>();
      signIn.mockResolvedValue();
      const signInFor = vi
        .spyOn(PgSession, "signInFor")
        .mockReturnValue(signIn);
      renderConnect({ defaultBackend: "present" });

      await act(async () => connect());

      expect(signInFor).toHaveBeenCalledWith("assistant");
      expect(signIn).toHaveBeenCalledWith([]);
      expect(PgAssistant.connection).toBeNull();
    });

    it("shows why a sign-in failed", async () => {
      const failure = await blockedPopup();
      signInRejects(failure);
      renderConnect({ defaultBackend: "present" });

      await act(async () => connect());

      expect((await screen.findByRole("alert")).textContent).toBe(
        "Allow pop-ups for this site to sign in with GitHub."
      );
    });

    it("reports a sign-in that failed for a reason it does not know", async () => {
      const logged = memoryProvider();
      initLogger({ providers: [logged] });
      signInRejects(new TypeError("Failed to fetch"));
      renderConnect({ defaultBackend: "present" });

      await act(async () => connect());

      expect((await screen.findByRole("alert")).textContent).toBe(
        "Couldn't sign in. Try again."
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
      vi.spyOn(PgSession, "signInFor").mockReturnValue(
        vi
          .fn<(scopes: string[]) => Promise<void>>()
          .mockRejectedValueOnce(failure)
          .mockReturnValueOnce(new Promise(() => {}))
      );
      renderConnect({ defaultBackend: "present" });
      await act(async () => connect());
      await screen.findByRole("alert");

      await act(async () => connect());

      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("offers Start once the user signs in", async () => {
      renderConnect({ defaultBackend: "present" });
      expect(action?.text).toBe("Sign in with GitHub");

      await act(() =>
        PgSession.refreshWith({
          id: "u1",
          name: undefined,
          image: undefined,
          login: undefined,
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

  it("leaves out a default the deployment does not serve, and falls back to a key", () => {
    renderConnect({ defaultBackend: "absent" });

    expect(
      screen.getByText(
        "No built-in model on this deployment. Use your own key."
      )
    ).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /Default/ })).toBeNull();
    expect(checked()?.getAttribute("value")).toBe("anthropic");
    // Nothing else to pick, so there is no toggle to hide the backends
    expect(
      screen.queryByRole("button", { name: "Hide other backends" })
    ).toBeNull();
  });

  it("neither offers nor rules out the default while the probe is out", () => {
    renderConnect({ defaultBackend: "checking" });

    expect(screen.getByText("Checking…")).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: /Default/ }).hasAttribute("disabled")
    ).toBe(true);
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
      requireFor("the API key field")(
        document.querySelector<HTMLInputElement>("#assistant-api-key")
      ),
      "sk-ant-fake"
    );

    act(() => connect());

    const anthropic = requireFor("the Anthropic provider")(
      PROVIDERS.find((p) => p.id === "anthropic")
    );
    expect(PgAssistant.connection?.settings?.model).toBe(
      requireFor("Anthropic's model settings")(anthropic.modelSettings).defaults
        .model
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
    const key = document.querySelector<HTMLInputElement>("#assistant-api-key");
    if (!key) throw new Error("the form has no key field");
    await user.type(key, "sk-ant-fake");

    act(() => {
      if (!action) throw new Error("the form handed its host no action");
      action.connect();
    });

    expect(PgAssistant.connection?.settings?.effort).toBe("low");
  });

  it("hands its host the action, ready once the key is in, and connects", async () => {
    const user = userEvent.setup();
    renderConnect({ defaultBackend: "absent" });
    expect(action).toMatchObject({ text: "Connect", ready: false });
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();

    await user.type(
      requireFor("the API key field")(
        document.querySelector<HTMLInputElement>("#assistant-api-key")
      ),
      "sk-ant-fake"
    );
    expect(action).toMatchObject({ text: "Connect", ready: true });
    act(() => connect());
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

  it("leads with one line on what the assistant does, and no heading", () => {
    renderConnect({ defaultBackend: "absent" });

    expect(
      screen.getByText(/The assistant reads your project and proposes fixes/)
    ).toBeTruthy();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("drops the lead and the capabilities over a connection", () => {
    act(() => PgAssistant.connect(OWN));
    renderConnect({ defaultBackend: "present" });

    expect(screen.queryByText(/The assistant reads your project/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "What the assistant can access" })
    ).toBeNull();
  });

  it("keeps what the assistant can access folded until asked", async () => {
    const user = userEvent.setup();
    renderConnect({ defaultBackend: "absent" });

    const toggle = screen.getByRole("button", {
      name: "What the assistant can access",
    });
    expect(screen.queryByText("READS")).toBeNull();
    await user.click(toggle);
    expect(screen.getByText("READS")).toBeTruthy();
  });

  it("describes the key field with where the key goes and links to a new one", () => {
    renderConnect({ defaultBackend: "absent" });

    const field = screen.getByLabelText("API key");
    expect(
      document.getElementById(field.getAttribute("aria-describedby") ?? "")
        ?.textContent
    ).toMatch(/Sent only to Anthropic, never to our server/);
    expect(
      screen.getByRole("link", { name: /Get a key/ }).getAttribute("href")
    ).toBe("https://console.anthropic.com/");
  });

  it("draws each backend as a row with its radio circle in view", () => {
    renderConnect({ defaultBackend: "absent" });

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.classList.contains("opacity-0")).toBe(false);
      expect(radio.closest("label")).toBeTruthy();
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

  describe("by keyboard", () => {
    // A picked backend's model presets measure themselves; jsdom has no
    // `ResizeObserver`
    beforeEach(() => {
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        }
      );
    });
    afterEach(() => vi.unstubAllGlobals());

    const radio = (name: RegExp) => screen.getByRole("radio", { name });

    /**
     * One arrow, held while Radix moves the focus: it moves it a task later
     * and checks the radio only while an arrow is down, which a real key
     * press outlasts and user-event's instant keyup does not
     */
    const arrow = async (
      user: ReturnType<typeof userEvent.setup>,
      key: "ArrowUp" | "ArrowDown"
    ) => {
      await user.keyboard(`{${key}>}`);
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
      await user.keyboard(`{/${key}}`);
    };

    it("keeps the picked bar focused when a click folds the list", async () => {
      const user = userEvent.setup();
      renderConnect({ defaultBackend: "present" });
      await user.click(
        screen.getByRole("button", { name: /Bring your own key/ })
      );
      await user.click(radio(/Anthropic/));

      expect(screen.getAllByRole("radio")).toHaveLength(2);
      expect(document.activeElement).toBe(radio(/Anthropic/));
    });

    it("walks back to the default and out to the others with the arrows", async () => {
      const user = userEvent.setup();
      renderConnect({ defaultBackend: "present" });
      await user.click(
        screen.getByRole("button", { name: /Bring your own key/ })
      );
      await user.click(radio(/Anthropic/));

      await arrow(user, "ArrowUp");
      expect(checked()?.getAttribute("value")).toBe("default");
      expect(document.activeElement).toBe(checked());
      expect(screen.getAllByRole("radio")).toHaveLength(PROVIDERS.length);

      await arrow(user, "ArrowDown");
      expect(checked()?.getAttribute("value")).toBe("anthropic");
      expect(document.activeElement).toBe(checked());
    });

    it("opens the folded list on an arrow from the default", async () => {
      const user = userEvent.setup();
      renderConnect({ defaultBackend: "present" });
      await user.tab();
      expect(document.activeElement).toBe(checked());
      expect(screen.getAllByRole("radio")).toHaveLength(1);

      await arrow(user, "ArrowDown");
      expect(screen.getAllByRole("radio")).toHaveLength(PROVIDERS.length);
      expect(
        screen
          .getByRole("button", { name: /Hide other backends/ })
          .getAttribute("aria-expanded")
      ).toBe("true");

      await arrow(user, "ArrowDown");
      expect(checked()?.getAttribute("value")).not.toBe("default");
      expect(document.activeElement).toBe(checked());
    });

    it("reaches every backend by keyboard alone, through Bring your own key", async () => {
      const user = userEvent.setup();
      renderConnect({ defaultBackend: "present" });
      await user.tab();
      expect(document.activeElement).toBe(checked());
      await user.tab();
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: /Bring your own key/ })
      );
      await user.keyboard("{Enter}");
      await user.tab({ shift: true });

      const seen = new Set<string | null | undefined>();
      for (let i = 0; i < PROVIDERS.length; i++) {
        await arrow(user, "ArrowDown");
        expect(document.activeElement).toBe(checked());
        seen.add(checked()?.getAttribute("value"));
      }
      expect(Array.from(seen).sort()).toEqual(
        PROVIDERS.map((p) => p.id).sort()
      );
    });
  });
});
