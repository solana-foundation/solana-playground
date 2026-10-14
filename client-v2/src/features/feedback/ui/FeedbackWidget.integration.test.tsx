// The whole slice over the real reporter and SDK, with a recording transport and the legacy modules mocked
import * as Sentry from "@sentry/react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "styled-components";
import type { DefaultTheme } from "styled-components";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "../../../shared/lib/telemetry";
import { FeedbackHost, FeedbackTrigger } from "./FeedbackWidget";

// The utils barrel reads generated globals that exist only in the built app
const setToast = vi.fn();
vi.mock("@/utils", () => ({
  PgConnection: {
    cluster: "devnet",
    onDidChangeCluster: () => ({ dispose: () => {} }),
  },
  PgView: { setToast: (...args: unknown[]) => setToast(...args) },
}));
vi.mock("@/hooks", () => ({ useRenderOnChange: () => undefined }));

type Transport = NonNullable<
  NonNullable<Parameters<typeof Sentry.init>[0]>["transport"]
>;
type Envelope = Parameters<ReturnType<Transport>["send"]>[0];
type FeedbackItem = [
  { type: string },
  {
    tags?: Record<string, unknown>;
    contexts?: { feedback?: Record<string, unknown> };
  }
];

// Only what the widget reads: the font its portaled menu and modal are set in
const theme = {
  font: { code: { family: "monospace", size: { medium: "13px" } } },
} as unknown as DefaultTheme;

const envelopes: Envelope[] = [];
let statusCode = 200;
// Set, the transport answers only once it settles
let held: Promise<void> | undefined;
let events: ReturnType<typeof memoryProvider>;

beforeEach(() => {
  envelopes.length = 0;
  statusCode = 200;
  held = undefined;
  setToast.mockClear();
  events = memoryProvider();
  initTelemetry({ providers: [events] });
  Sentry.init({
    dsn: "https://key@o0.ingest.sentry.io/0",
    defaultIntegrations: false,
    transport: () => ({
      send: async (envelope) => {
        envelopes.push(envelope);
        await held;
        return { statusCode };
      },
      flush: async () => true,
    }),
  });
});

afterEach(async () => {
  resetTelemetry();
  await Sentry.close();
});

/**
 * The host where `Flow` puts it, and the trigger where the navigation's
 * footer does; `footer: false` is the footer unmounted, as the navigation's
 * Sheet unmounts it on close
 */
const page = ({ footer }: { footer: boolean }) => (
  <ThemeProvider theme={theme}>
    <FeedbackHost>{footer && <FeedbackTrigger />}</FeedbackHost>
  </ThemeProvider>
);

it("should send one rated feedback from the trigger to Sentry, then thank the user", async () => {
  render(page({ footer: true }));

  await userEvent.click(screen.getByRole("button", { name: "Feedback" }));
  const share = await screen.findByRole("menuitem", { name: "Share feedback" });
  expect(
    share.closest<HTMLElement>('[data-slot="dropdown-menu-content"]')?.style
      .fontFamily
  ).toBe("monospace");
  await userEvent.click(share);
  await screen.findByRole("heading", { name: "Give feedback" });
  await userEvent.click(screen.getByRole("radio", { name: "4 of 5 stars" }));
  await userEvent.type(
    screen.getByRole("textbox", { name: "Feedback" }),
    "Deploy is slow"
  );
  await userEvent.type(
    screen.getByRole("textbox", { name: "X handle (optional)" }),
    "@fren"
  );
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));

  await waitFor(() =>
    expect(screen.queryByRole("heading", { name: "Give feedback" })).toBeNull()
  );
  expect(envelopes).toHaveLength(1);
  const [[header, event]] = envelopes[0][1] as unknown as FeedbackItem[];
  expect(header.type).toBe("feedback");
  expect(event.contexts?.feedback).toMatchObject({
    message: "Deploy is slow",
    name: "@fren",
    source: "widget",
  });
  expect(event.tags).toEqual({
    type: "feedback",
    source: "widget",
    cluster: "devnet",
    rating: 4,
  });
  expect(setToast).toHaveBeenCalledTimes(1);
  render(setToast.mock.calls[0][0]());
  expect(screen.getByText("Feedback sent!")).toBeTruthy();
  expect(events.events.map((e) => [e.name, e.params])).toEqual([
    ["feedback_opened", {}],
    ["feedback_sent", { rating: 4 }],
  ]);
});

const openForm = async () => {
  render(page({ footer: true }));
  await userEvent.click(screen.getByRole("button", { name: "Feedback" }));
  await userEvent.click(
    await screen.findByRole("menuitem", { name: "Share feedback" })
  );
  await screen.findByRole("heading", { name: "Give feedback" });
};

it("should keep a rejected form open with the typed message and say so inside it", async () => {
  statusCode = 500;
  await openForm();
  const message = screen.getByRole("textbox", { name: "Feedback" });
  await userEvent.type(message, "Deploy is slow");

  await userEvent.click(screen.getByRole("button", { name: "Submit" }));

  await screen.findByRole("alert");
  expect((message as HTMLTextAreaElement).value).toBe("Deploy is slow");
  expect(
    (screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement)
      .disabled
  ).toBe(false);
  expect(setToast).not.toHaveBeenCalled();
  expect(events.events.map((e) => e.name)).toEqual([
    "feedback_opened",
    "feedback_failed",
  ]);
});

it("should let the user close a sending form, show the send on the trigger, and keep the text when it fails", async () => {
  statusCode = 500;
  let release = () => {};
  held = new Promise<void>((resolve) => (release = resolve));
  await openForm();
  await userEvent.type(
    screen.getByRole("textbox", { name: "Feedback" }),
    "Deploy is slow"
  );
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));

  await userEvent.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("heading", { name: "Give feedback" })).toBeNull()
  );
  expect(screen.getByRole("status", { name: "Sending feedback" })).toBeTruthy();
  release();
  await waitFor(() => expect(setToast).toHaveBeenCalledTimes(1));
  render(setToast.mock.calls[0][0]());
  expect(screen.getByText("Could not send feedback.")).toBeTruthy();

  await userEvent.click(screen.getByRole("button", { name: "Feedback" }));
  await userEvent.click(
    await screen.findByRole("menuitem", { name: "Share feedback" })
  );
  expect(
    (screen.getByRole("textbox", { name: "Feedback" }) as HTMLTextAreaElement)
      .value
  ).toBe("Deploy is slow");
  expect(screen.getByRole("alert")).toBeTruthy();
});

it("should track a GitHub link opened from the form as from the form", async () => {
  await openForm();

  await userEvent.click(screen.getByRole("link", { name: "report a bug" }));

  expect(events.events.map((e) => [e.name, e.params])).toEqual([
    ["feedback_opened", {}],
    ["feedback_github_clicked", { link: "bug", from: "form" }],
  ]);
});

it("should keep the draft and the send when the trigger unmounts and comes back", async () => {
  statusCode = 500;
  let release = () => {};
  held = new Promise<void>((resolve) => (release = resolve));
  const { rerender } = render(page({ footer: true }));
  await userEvent.click(screen.getByRole("button", { name: "Feedback" }));
  await userEvent.click(
    await screen.findByRole("menuitem", { name: "Share feedback" })
  );
  await userEvent.type(
    await screen.findByRole("textbox", { name: "Feedback" }),
    "Deploy is slow"
  );
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  await userEvent.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("heading", { name: "Give feedback" })).toBeNull()
  );

  rerender(page({ footer: false }));
  expect(screen.queryByRole("button", { name: "Feedback" })).toBeNull();
  rerender(page({ footer: true }));
  expect(screen.getByRole("status", { name: "Sending feedback" })).toBeTruthy();

  rerender(page({ footer: false }));
  release();
  await waitFor(() => expect(setToast).toHaveBeenCalledTimes(1));
  rerender(page({ footer: true }));
  await userEvent.click(screen.getByRole("button", { name: "Feedback" }));
  await userEvent.click(
    await screen.findByRole("menuitem", { name: "Share feedback" })
  );
  expect(
    (screen.getByRole("textbox", { name: "Feedback" }) as HTMLTextAreaElement)
      .value
  ).toBe("Deploy is slow");
  expect(screen.getByRole("alert")).toBeTruthy();
});
