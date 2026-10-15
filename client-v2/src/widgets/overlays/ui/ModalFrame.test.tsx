import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
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
import { Modal } from "@/shared/ui/modal";
import { PROJECT_NAME } from "@/constants";
import { PgView } from "@/utils/view";
import { ModalFrame, SubmitCancelled } from "./ModalFrame";
import { ModalLayerContext } from "./modal-layer";
import { ModalPages, modalPage } from "./ModalPages";
import type { ModalPageProps } from "./ModalPages";
import type { ModalFrameProps } from "./ModalFrame";

let sent: ReturnType<typeof memoryProvider>;
let logs: ReturnType<typeof logMemory>;
let closeModal: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
  logs = logMemory();
  initLogger({ providers: [logs] });
  closeModal = vi.spyOn(PgView, "closeModal").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  resetTelemetry();
  resetLogger();
});

const events = (name: string) =>
  sent.events
    .filter((event) => event.name === name)
    .map((event) => event.params);

const renderFrame = (props: Omit<ModalFrameProps, "name">) =>
  render(
    <Modal open>
      <ModalLayerContext.Provider value>
        <ModalFrame
          name="rename-item"
          title={props.title}
          buttonProps={props.buttonProps}
          size={props.size}
        >
          <input aria-label="Name" />
        </ModalFrame>
      </ModalLayerContext.Provider>
    </Modal>
  );

/** Clicks the submit and lets its promise settle */
const submit = async (text: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: text }));
  });
};

it("should close with what the submit resolved", async () => {
  renderFrame({
    title: "Rename",
    buttonProps: { text: "Rename", onSubmit: async () => 42 },
  });

  await submit("Rename");

  expect(closeModal).toHaveBeenCalledTimes(1);
  expect(closeModal).toHaveBeenCalledWith(42);
});

it("should stay open after a submit with noCloseOnSubmit", async () => {
  const onSubmit = vi.fn();
  renderFrame({
    title: "Rename",
    buttonProps: { text: "Rename", onSubmit, noCloseOnSubmit: true },
  });

  await submit("Rename");

  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(closeModal).not.toHaveBeenCalled();
});

it("should show a thrown error, stay open and report the failure", async () => {
  renderFrame({
    title: "Rename",
    buttonProps: {
      text: "Rename",
      onSubmit: async () => {
        throw new Error("exists");
      },
    },
  });

  await submit("Rename");

  expect(screen.getByRole("alert").textContent).toBe("exists");
  expect(closeModal).not.toHaveBeenCalled();
  expect(events("overlay_modal_submit_failed")).toEqual([
    { name: "rename-item" },
  ]);
  expect(
    logs.entries.map((entry) => ({
      ns: entry.ns,
      report: entry.report,
      context: entry.context,
    }))
  ).toEqual([
    {
      ns: "overlays:modal-frame",
      report: true,
      context: { name: "rename-item" },
    },
  ]);
});

it("should show a thrown string as the message", async () => {
  renderFrame({
    title: "Rename",
    buttonProps: {
      text: "Rename",
      onSubmit: () => {
        // Legacy dialog bodies throw strings; the frame must still show them
        // eslint-disable-next-line no-throw-literal
        throw "nope";
      },
    },
  });

  await submit("Rename");

  expect(screen.getByRole("alert").textContent).toBe("nope");
  expect(closeModal).not.toHaveBeenCalled();
});

it("should close with nothing when the button has no onSubmit", async () => {
  renderFrame({ title: "Info", buttonProps: { text: "Done" } });

  await submit("Done");

  expect(closeModal).toHaveBeenCalledTimes(1);
  expect(closeModal).toHaveBeenCalledWith(null);
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
});

it("should close with null on Cancel", () => {
  renderFrame({
    title: "Rename",
    buttonProps: { text: "Rename", onSubmit: vi.fn() },
  });

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(closeModal).toHaveBeenCalledTimes(1);
  expect(closeModal).toHaveBeenCalledWith(null);
});

it("should show the product's name for title true", () => {
  renderFrame({ title: true });

  const heading = screen.getByRole("heading", { name: PROJECT_NAME });
  expect(heading.classList.contains("sr-only")).toBe(false);
});

it("should name the dialog after the product, hidden, without a title", () => {
  renderFrame({});

  expect(screen.getByRole("dialog", { name: PROJECT_NAME })).toBeTruthy();
  const heading = screen.getByRole("heading", { name: PROJECT_NAME });
  expect(heading.classList.contains("sr-only")).toBe(true);
});

it("should show the message of a rejected { message } object", async () => {
  renderFrame({
    title: "Rename",
    buttonProps: {
      text: "Rename",
      // `PgCommon.sendAndReceiveCustomEvent` rejects with this shape
      onSubmit: () => Promise.reject({ message: "no wallet" }),
    },
  });

  await submit("Rename");

  expect(screen.getByRole("alert").textContent).toBe("no wallet");
});

it("should run the submit once for two quick submits", async () => {
  let finish!: () => void;
  const onSubmit = vi.fn(
    () => new Promise<void>((resolve) => (finish = resolve))
  );
  renderFrame({ title: "Rename", buttonProps: { text: "Rename", onSubmit } });

  const input = screen.getByRole("textbox", { name: "Name" });
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
  });
  await act(async () => finish());

  expect(onSubmit).toHaveBeenCalledTimes(1);
});

it("should report a dialog of several pages as opened once", () => {
  const Second = () => <ModalFrame name="share" title="Done" />;
  const First = ({ setPage }: ModalPageProps) => (
    <ModalFrame
      name="share"
      title="Share"
      buttonProps={{
        text: "Next",
        onSubmit: () => setPage(modalPage(Second)),
        noCloseOnSubmit: true,
      }}
    />
  );
  render(
    <Modal open>
      <ModalLayerContext.Provider value>
        <ModalPages name="share" defaultPage={modalPage(First)} />
      </ModalLayerContext.Provider>
    </Modal>
  );

  fireEvent.click(screen.getByRole("button", { name: "Next" }));

  expect(screen.getByRole("dialog", { name: "Done" })).toBeTruthy();
  expect(events("overlay_modal_opened")).toEqual([{ name: "share" }]);
});

it("should clear the last error when a retry succeeds", async () => {
  const onSubmit = vi
    .fn()
    .mockRejectedValueOnce(new Error("exists"))
    .mockResolvedValueOnce(undefined);
  renderFrame({
    title: "Rename",
    buttonProps: { text: "Rename", onSubmit, noCloseOnSubmit: true },
  });

  await submit("Rename");
  expect(screen.getByRole("alert").textContent).toBe("exists");
  await submit("Rename");

  expect(onSubmit).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("should send overlay_modal_opened once under StrictMode", () => {
  // StrictMode runs every effect twice on mount, as the dev server does
  render(
    <StrictMode>
      <Modal open>
        <ModalLayerContext.Provider value>
          <ModalFrame name="rename-item" title="Rename" />
        </ModalLayerContext.Provider>
      </Modal>
    </StrictMode>
  );

  expect(events("overlay_modal_opened")).toEqual([{ name: "rename-item" }]);
});

it("should show a message for an Error without one", async () => {
  renderFrame({
    title: "Rename",
    buttonProps: {
      text: "Rename",
      onSubmit: async () => {
        throw new Error();
      },
    },
  });

  await submit("Rename");

  expect(screen.getByRole("alert").textContent).toBe("Something went wrong");
});

it("should stay open and quiet when the user cancels the submit", async () => {
  renderFrame({
    title: "Import",
    buttonProps: {
      text: "Import",
      onSubmit: async () => {
        throw new SubmitCancelled();
      },
    },
  });

  await submit("Import");

  expect(screen.queryByRole("alert")).toBeNull();
  expect(closeModal).not.toHaveBeenCalled();
  expect(events("overlay_modal_submit_failed")).toEqual([]);
  expect(logs.entries.filter((entry) => entry.report)).toEqual([]);
});

it("should not close another dialog when it was closed before its submit settled", async () => {
  let finish!: (value: number) => void;
  const { unmount } = renderFrame({
    title: "Rename",
    buttonProps: {
      text: "Rename",
      onSubmit: () => new Promise<number>((resolve) => (finish = resolve)),
    },
  });

  await submit("Rename");
  unmount();
  await act(async () => finish(42));

  expect(closeModal).not.toHaveBeenCalled();
});

it("should not draw outside ModalHost", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});

  expect(() =>
    render(
      <Modal open>
        <ModalFrame name="rename-item" title="Rename" />
      </Modal>
    )
  ).toThrow("ModalFrame is rendered outside ModalHost");
});
