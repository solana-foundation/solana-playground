import {
  act,
  fireEvent,
  render,
  renderHook,
  within,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, type DefaultTheme } from "styled-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initTelemetry,
  memoryProvider as memoryTelemetry,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import { MODAL_HOST_WAIT, PgView } from "@/utils/view";
import {
  initLogger,
  memoryProvider as memoryLog,
  resetLogger,
} from "@/shared/lib/logger";
import { PgSession } from "@/features/auth";
import { useTurn } from "@/widgets/assistant";
import type { DefaultBackend } from "@/widgets/assistant";
import { ModalFrame, ModalHost } from "@/widgets/overlays";
import { PgAssistant } from "@/views/sidebar/assistant/store";
import { openConnectDialog } from "./ConnectDialog";

// The form's footer link reaches the utils barrel, which needs the build's
// globals; what it draws is not under test
vi.mock("@/components/Link", () => ({
  default: (props: { children: React.ReactNode }) => (
    <span>{props.children}</span>
  ),
}));

// The probe is the deployment's; a test says what it answered
let backend: DefaultBackend;
vi.mock("@/widgets/assistant/model/default-backend", () => ({
  useDefaultBackend: () => backend,
  probeDefaultBackend: () => Promise.resolve(backend),
}));
// A turn is never run here; the real providers stream from the network
vi.mock("@/views/sidebar/assistant/model", () => ({
  createProvider: vi.fn(),
}));
// The widget's public API, narrowed to what the dialog and the turn use: the
// rest of it (the panel, the thread) reaches the build's generated globals
vi.mock("@/widgets/assistant", async () => ({
  assistantTelemetry: (await import("@/widgets/assistant/model/telemetry"))
    .assistantTelemetry,
  useDefaultBackend: (await import("@/widgets/assistant/model/default-backend"))
    .useDefaultBackend,
  useTurn: (await import("@/widgets/assistant/model/use-turn")).useTurn,
}));
vi.mock("@/effects/chat-thread/push-thread", () => ({
  pushThread: vi.fn(() => Promise.resolve()),
}));

/** Another dialog, opened over Connect a model */
const Other = () => (
  <ModalFrame name="other" title="Other">
    <p>Something else</p>
  </ModalFrame>
);

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

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let events: ReturnType<typeof memoryTelemetry>;
/** The assistant's own events; the overlay reports the dialog on its own */
const eventNames = () =>
  events.events
    .filter((e) => e.name.startsWith("assistant_"))
    .map((e) => [e.name, e.params]);

beforeEach(() => {
  events = memoryTelemetry();
  initTelemetry({ providers: [events] });
  backend = { state: "absent" };
  PgAssistant.disconnect();
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
});
afterEach(async () => {
  vi.useRealTimers();
  // `PgView`'s stack outlives the host: a dialog left open here would show
  // in the next test's
  act(() => {
    for (const { id } of PgView.getOpenModals()) PgView.closeModal(null, id);
  });
  // A dialog on its way out is still mounted here and reads the store
  act(() => PgAssistant.disconnect());
  PgSession.reset();
  resetTelemetry();
  resetLogger();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const renderHost = () =>
  render(
    <ThemeProvider theme={anyTheme}>
      <ModalHost />
    </ThemeProvider>
  );

const dialog = () => screen.queryByRole("dialog", { name: "Connect a model" });

describe("ConnectDialog", () => {
  it("opens as a dialog titled Connect a model, and says where from", () => {
    renderHost();

    act(() => openConnectDialog("menu"));

    expect(dialog()).toBeTruthy();
    expect(PgAssistant.isPickingBackend).toBe(true);
    expect(eventNames()).toEqual([
      ["assistant_connect_opened", { via: "menu" }],
    ]);
  });

  it("opens on the thread's own backend, and says so", () => {
    renderHost();

    act(() =>
      openConnectDialog("thread", { provider: "openai", model: "gpt-x" })
    );

    expect(
      document.querySelector<HTMLInputElement>("#assistant-model")?.value
    ).toBe("gpt-x");
    expect(eventNames()).toEqual([
      ["assistant_connect_opened", { via: "thread" }],
    ]);
  });

  it("does not open a second one over the first", () => {
    renderHost();

    act(() => openConnectDialog("menu"));
    act(() => openConnectDialog("send"));

    expect(screen.getAllByRole("dialog").length).toBe(1);
    expect(eventNames()).toEqual([
      ["assistant_connect_opened", { via: "menu" }],
    ]);
  });

  it("closes once a backend is connected, and reports the pick", async () => {
    renderHost();
    const user = userEvent.setup();
    act(() => openConnectDialog("model"));

    // With no default on this deployment the form falls back to Anthropic
    await user.type(
      document.querySelector<HTMLInputElement>("#assistant-api-key")!,
      "sk-ant-fake"
    );
    await user.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(dialog()).toBeNull());
    expect(PgAssistant.connection?.id).toBe("anthropic");
    expect(PgAssistant.isPickingBackend).toBe(false);
    expect(eventNames()).toEqual([
      ["assistant_connect_opened", { via: "model" }],
      ["assistant_model_picked", { provider: "anthropic", via: "dialog" }],
    ]);
  });

  it("puts the connect action in the dialog's footer, ready once the form is", async () => {
    renderHost();
    const user = userEvent.setup();
    act(() => openConnectDialog("menu"));

    const footer = document.querySelector<HTMLElement>(
      '[data-slot="modal-footer"]'
    )!;
    const body = document.querySelector<HTMLElement>(
      '[data-slot="modal-body"]'
    )!;
    const connect = within(footer).getByRole("button", { name: "Connect" });
    expect(within(body).queryByRole("button", { name: "Connect" })).toBeNull();
    // The view's one call to action keeps the brand ring
    expect(connect.getAttribute("data-slot")).toBe("brand-button");
    expect(connect.getAttribute("data-variant")).toBe("ring");
    expect(connect.hasAttribute("disabled")).toBe(true);

    await user.type(
      document.querySelector<HTMLInputElement>("#assistant-api-key")!,
      "sk-ant-fake"
    );
    expect(connect.hasAttribute("disabled")).toBe(false);
  });

  it("gives focus to the submit when the form has no field", async () => {
    backend = { state: "present", model: "z-ai/glm-5.3-flash:US" };
    // Start, the submit looked for here, shows only for a signed-in user
    await PgSession.refreshWith({
      id: "u1",
      name: null,
      image: null,
      login: null,
    });
    renderHost();

    act(() => openConnectDialog("menu"));

    // The keyless default has no field: Enter must start, not close
    const start = screen.getByRole("button", { name: "Start" });
    await waitFor(() => expect(document.activeElement).toBe(start));
  });

  it("offers sign-in as the submit for the default while signed out", async () => {
    backend = { state: "present", model: "z-ai/glm-5.3-flash:US" };
    renderHost();

    act(() => openConnectDialog("menu"));

    const signIn = screen.getByRole("button", { name: "Sign in with GitHub" });
    await waitFor(() => expect(document.activeElement).toBe(signIn));
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  });

  it("connects once on Enter in the key field", async () => {
    renderHost();
    const user = userEvent.setup();
    const connect = vi.spyOn(PgAssistant, "connect");
    act(() => openConnectDialog("menu"));

    await user.type(
      document.querySelector<HTMLInputElement>("#assistant-api-key")!,
      "sk-ant-fake{Enter}"
    );

    await waitFor(() => expect(dialog()).toBeNull());
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("closes on a re-pick of what was connected, and reports no pick", async () => {
    PgAssistant.connect({
      id: "anthropic",
      apiKey: "sk-ant-fake",
      settings: { model: "claude-opus-5-5", effort: "medium" },
    });
    renderHost();
    const user = userEvent.setup();
    act(() => openConnectDialog("menu"));

    // Opened over the connection, the form holds its key and choices
    await user.click(screen.getByRole("button", { name: "Switch" }));

    await waitFor(() => expect(dialog()).toBeNull());
    expect(eventNames()).toEqual([
      ["assistant_connect_opened", { via: "menu" }],
    ]);
  });

  it("reports a pick that changes the effort of what was connected", async () => {
    PgAssistant.connect({
      id: "anthropic",
      apiKey: "sk-ant-fake",
      settings: { model: "claude-opus-5-5", effort: "medium" },
    });
    renderHost();
    act(() => openConnectDialog("menu"));

    act(() =>
      PgAssistant.connect({
        id: "anthropic",
        apiKey: "sk-ant-fake",
        settings: { model: "claude-opus-5-5", effort: "high" },
      })
    );

    await waitFor(() => expect(dialog()).toBeNull());
    expect(eventNames()).toEqual([
      ["assistant_connect_opened", { via: "menu" }],
      ["assistant_model_picked", { provider: "anthropic", via: "dialog" }],
    ]);
  });

  it("reports no pick for a new key on the same backend and model", async () => {
    PgAssistant.connect({
      id: "openai",
      apiKey: "sk-old",
      endpoint: { baseUrl: "https://api.openai.com/v1", model: "gpt-5.1" },
    });
    renderHost();
    act(() => openConnectDialog("menu"));

    act(() =>
      PgAssistant.connect({
        id: "openai",
        apiKey: "sk-new",
        endpoint: { baseUrl: "https://api.openai.com/v1", model: "gpt-5.1" },
      })
    );

    await waitFor(() => expect(dialog()).toBeNull());
    expect(eventNames()).toEqual([
      ["assistant_connect_opened", { via: "menu" }],
    ]);
  });

  it("reports a pick that changes the endpoint's model", async () => {
    PgAssistant.connect({
      id: "openai",
      apiKey: "sk-old",
      endpoint: { baseUrl: "https://api.openai.com/v1", model: "gpt-5.1" },
    });
    renderHost();
    act(() => openConnectDialog("menu"));

    act(() =>
      PgAssistant.connect({
        id: "openai",
        apiKey: "sk-old",
        endpoint: { baseUrl: "https://api.openai.com/v1", model: "gpt-5.2" },
      })
    );

    await waitFor(() => expect(dialog()).toBeNull());
    expect(eventNames()).toEqual([
      ["assistant_connect_opened", { via: "menu" }],
      ["assistant_model_picked", { provider: "openai", via: "dialog" }],
    ]);
  });

  it("closes on Escape without connecting", async () => {
    renderHost();
    act(() => openConnectDialog("menu"));

    act(() => {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    });

    await waitFor(() => expect(dialog()).toBeNull());
    expect(PgAssistant.connection).toBeNull();
    expect(PgAssistant.isPickingBackend).toBe(false);
    expect(eventNames()).toEqual([
      ["assistant_connect_opened", { via: "menu" }],
    ]);
  });

  it("stays open, and keeps the default out, when a dialog over it closes", async () => {
    backend = { state: "present", model: "z-ai/glm-5.3-flash:US" };
    renderHost();
    const { result } = renderHook(() => useTurn({ open: openConnectDialog }));
    act(() => openConnectDialog("menu"));
    act(() => void PgView.setModal(Other));

    // Closing Other answers Other's caller only; Connect stays open
    await act(async () => PgView.closeTopModal());

    expect(screen.queryByRole("dialog", { name: "Other" })).toBeNull();
    expect(dialog()).toBeTruthy();
    expect(PgAssistant.isPickingBackend).toBe(true);
    act(() => PgAssistant.requestPrompt("Explain this error"));
    await waitFor(() => expect(result.current.promptWaiting).toBe(true));
    expect(PgAssistant.connection).toBeNull();

    // The user's pick later is still the dialog's, and reported
    act(() => PgAssistant.connect({ id: "default", apiKey: "" }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(eventNames()).toContainEqual([
      "assistant_model_picked",
      { provider: "default", via: "dialog" },
    ]);
  });

  it("closes itself, not the dialog over it, on a connection", async () => {
    renderHost();
    act(() => openConnectDialog("menu"));
    act(() => void PgView.setModal(Other));

    act(() => PgAssistant.connect({ id: "default", apiKey: "" }));

    await waitFor(() => expect(dialog()).toBeNull());
    expect(screen.getByRole("dialog", { name: "Other" })).toBeTruthy();
  });

  it("is not left marked open when no host shows it", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});

    act(() => openConnectDialog("send"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MODAL_HOST_WAIT);
    });

    expect(PgAssistant.isPickingBackend).toBe(false);
  });

  it("is not left marked open when it cannot be opened", async () => {
    const logs = memoryLog();
    initLogger({ providers: [logs] });
    vi.spyOn(PgView, "setModal").mockRejectedValue(new Error("no host"));

    act(() => openConnectDialog("send"));

    await waitFor(() => expect(PgAssistant.isPickingBackend).toBe(false));
    const entry = logs.entries.find((e) => e.ns === "assistant:connect");
    expect(entry?.level).toBe("error");
    expect(entry?.report).toBe(true);
  });

  it("tells the user when it cannot be opened", async () => {
    initLogger({ providers: [memoryLog()] });
    vi.spyOn(PgView, "setModal").mockRejectedValue(new Error("no host"));
    const toast = vi.spyOn(PgView, "setToast").mockReturnValue(undefined);

    act(() => openConnectDialog("send"));

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(toast.mock.calls[0][1]).toEqual({
      options: { name: "connect-model-failed" },
    });
  });

  it("still closes on a later connection when closing it threw once", async () => {
    const logs = memoryLog();
    initLogger({ providers: [logs] });
    renderHost();
    act(() => openConnectDialog("menu"));
    const close = vi.spyOn(PgView, "closeModal").mockImplementationOnce(() => {
      throw new Error("the host is busy");
    });

    act(() => PgAssistant.connect({ id: "anthropic", apiKey: "sk-ant-one" }));
    expect(dialog()).not.toBeNull();
    act(() => PgAssistant.connect({ id: "anthropic", apiKey: "sk-ant-two" }));

    await waitFor(() => expect(dialog()).toBeNull());
    expect(close).toHaveBeenCalledTimes(2);
    expect(logs.entries.map((e) => [e.ns, e.level, e.report])).toEqual([
      ["assistant:connect", "error", true],
    ]);
  });

  it("opens on the backend and model it was asked for", () => {
    backend = { state: "present", model: "z-ai/glm-5.3-flash:US" };
    renderHost();

    act(() =>
      openConnectDialog("model", {
        provider: "anthropic",
        model: "claude-opus-5-5",
      })
    );

    expect(
      screen
        .getByRole("radio", { name: /Anthropic/ })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(screen.getByRole("combobox", { name: "Model" }).textContent).toBe(
      "Opus 5.5"
    );
    // One column, 27rem on a desk
    expect(screen.getByRole("dialog").getAttribute("data-size")).toBe("narrow");
    // The dialog's title is the frame's; the form heads only its lead
    expect(screen.queryByText("Back to chat")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Connect a model" }).tagName
    ).toBe("H2");
    expect(
      screen.getByRole("heading", {
        name: "An assistant that can see your project",
      }).tagName
    ).toBe("H3");
  });
});
