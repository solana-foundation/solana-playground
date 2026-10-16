import { createPortal } from "react-dom";
import { render } from "@testing-library/react";

import { initTelemetry, resetTelemetry } from "./collector";
import { memoryProvider } from "./providers/memory";
import { TelemetryScope, useTracker } from "./scope";
import { createTracker } from "./tracker";
import type { NoParams } from "./types";

const tracker = createTracker<{ auth_signed_out: NoParams }>();

const Emitter = () => {
  const { track } = useTracker(tracker);
  track("auth_signed_out", {});
  return null;
};

let sent: ReturnType<typeof memoryProvider>;

beforeEach(() => {
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
});

afterEach(() => {
  resetTelemetry();
});

it("should attribute an event from a portal to the enclosing scope", () => {
  render(
    <TelemetryScope name="deploy-panel">
      {createPortal(<Emitter />, document.body)}
    </TelemetryScope>
  );

  expect(sent.events[0].scope).toBe("deploy-panel");
});

it("should send no scope outside a TelemetryScope", () => {
  render(<Emitter />);

  expect(sent.events[0].scope).toBeUndefined();
});
