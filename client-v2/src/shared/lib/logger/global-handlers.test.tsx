import { render, screen } from "@testing-library/react";

import { LoggerErrorBoundary } from "./error-boundary";
import { installGlobalHandlers } from "./global-handlers";
import { initLogger, resetLogger } from "./logger";
import { memoryProvider } from "./providers/memory";

let logged: ReturnType<typeof memoryProvider>;

beforeEach(() => {
  logged = memoryProvider();
  initLogger({ providers: [logged] });
});

afterEach(() => {
  resetLogger();
});

describe("installGlobalHandlers", () => {
  let uninstall: () => void;

  beforeEach(() => {
    uninstall = installGlobalHandlers();
  });

  afterEach(() => uninstall());

  it("should panic on an unhandled rejection, marked unhandled", () => {
    const reason = new Error("nobody caught me");
    const event = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(event, "reason", { value: reason });

    globalThis.dispatchEvent(event);

    expect(logged.entries).toEqual([
      expect.objectContaining({
        ns: "logger:global",
        level: "panic",
        error: reason,
        unhandled: true,
      }),
    ]);
  });

  it("should panic with the message of an error event that carries no error", () => {
    globalThis.dispatchEvent(
      new ErrorEvent("error", { message: "Script error." })
    );

    expect(logged.entries[0].error?.message).toBe("Script error.");
  });
});

describe("LoggerErrorBoundary", () => {
  const Thrower = (): never => {
    throw new Error("render failed");
  };

  it("should panic with namespace app:render and show the fallback", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <LoggerErrorBoundary fallback={<p role="alert">fallback</p>}>
        <Thrower />
      </LoggerErrorBoundary>
    );

    expect(screen.getByRole("alert").textContent).toBe("fallback");
    expect(logged.entries).toEqual([
      expect.objectContaining({ ns: "app:render", level: "panic" }),
    ]);
  });
});
