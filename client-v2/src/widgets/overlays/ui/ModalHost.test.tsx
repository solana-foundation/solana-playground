import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as logMemory,
  resetLogger,
} from "@/shared/lib/logger";
import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import { PgView } from "@/utils/view";
import { ModalFrame } from "./ModalFrame";
import { ModalHost } from "./ModalHost";

let sent: ReturnType<typeof memoryProvider>;
beforeEach(() => {
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
});
afterEach(() => {
  vi.restoreAllMocks();
  resetTelemetry();
});

const Info = () => (
  <ModalFrame name="info" title="Info">
    <p>Nothing to do</p>
  </ModalFrame>
);

/** A dialog with typed state that opens a second one on top of itself */
const Outer = () => {
  const [value, setValue] = useState("");
  return (
    <ModalFrame
      name="outer"
      title="Outer"
      buttonProps={{
        text: "Next",
        onSubmit: () => PgView.setModal(Info),
        noCloseOnSubmit: true,
      }}
    >
      <input
        aria-label="Outer name"
        value={value}
        onChange={(ev) => setValue(ev.target.value)}
      />
    </ModalFrame>
  );
};

/** Opens a dialog and returns the promise of its answer */
const open = (body: Parameters<typeof PgView.setModal>[0]) => {
  let answer!: Promise<unknown>;
  act(() => {
    answer = PgView.setModal(body);
  });
  return answer;
};

it("should show a dialog opened with PgView.setModal", () => {
  render(<ModalHost />);

  open(Info);

  expect(screen.getByRole("dialog", { name: "Info" })).toBeTruthy();
  expect(screen.getByText("Nothing to do")).toBeTruthy();
});

it("should close on Escape and answer null", async () => {
  render(<ModalHost />);
  const answer = open(Info);

  act(() => {
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  });

  await expect(answer).resolves.toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("should answer with what the submit returned", async () => {
  const Ask = () => (
    <ModalFrame
      name="ask"
      title="Ask"
      buttonProps={{ text: "Yes", onSubmit: () => "yes" }}
    />
  );
  render(<ModalHost />);
  const answer = open(Ask);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
  });

  await expect(answer).resolves.toBe("yes");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("should show a stacked dialog and bring back the first with its text", async () => {
  render(<ModalHost />);
  open(Outer);
  fireEvent.change(screen.getByRole("textbox", { name: "Outer name" }), {
    target: { value: "draft" },
  });

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
  });

  expect(screen.getAllByRole("dialog").length).toBe(1);
  expect(screen.getByRole("dialog", { name: "Info" })).toBeTruthy();

  act(() => {
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  });

  expect(screen.getByRole("dialog", { name: "Outer" })).toBeTruthy();
  expect(
    (screen.getByRole("textbox", { name: "Outer name" }) as HTMLInputElement)
      .value
  ).toBe("draft");
  // The first dialog stayed mounted, so it reported opening only once
  expect(
    sent.events
      .filter((event) => event.name === "overlay_modal_opened")
      .map((event) => event.params)
  ).toEqual([{ name: "outer" }, { name: "info" }]);
});

it("should fire onDidOpenModal on each open", () => {
  const opened = vi.fn();
  const listener = PgView.onDidOpenModal(opened);
  render(<ModalHost />);

  open(Info);
  open(Info);

  expect(opened).toHaveBeenCalledTimes(2);
  listener.dispose();
});

it("should not close on Escape while the submit runs, and answer once it settles", async () => {
  let finish!: (value: string) => void;
  const Slow = () => (
    <ModalFrame
      name="slow"
      title="Slow"
      buttonProps={{
        text: "Save",
        onSubmit: () => new Promise<string>((resolve) => (finish = resolve)),
      }}
    />
  );
  render(<ModalHost />);
  const answer = open(Slow);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });
  act(() => {
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  });
  expect(screen.getByRole("dialog", { name: "Slow" })).toBeTruthy();

  await act(async () => finish("saved"));

  await expect(answer).resolves.toBe("saved");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("should close a dialog that throws while rendering, report it and answer null", async () => {
  const logs = logMemory();
  initLogger({ providers: [logs] });
  vi.spyOn(console, "error").mockImplementation(() => {});
  const Broken = (): never => {
    throw new Error("render failed");
  };
  render(
    <>
      <p>the IDE</p>
      <ModalHost />
    </>
  );

  const answer = open(Broken);

  await expect(answer).resolves.toBeNull();
  expect(screen.getByText("the IDE")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    logs.entries.map((entry) => ({ ns: entry.ns, report: entry.report }))
  ).toEqual([{ ns: "overlays:modal-host", report: true }]);
  resetLogger();
});
