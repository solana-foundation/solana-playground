// The share dialog's body end to end against a stubbed `/api/gists`: sign-in
// first when signed out, gist access asked for only when the token lacks it,
// and every ending counted once.
import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { PgView } from "@/utils/view";
import ShareGist from "./ShareGist";
import type { ShareGistProps } from "./ShareGist";

const URL = "https://gist.github.com/ada/abc";
const FILES = { "src/lib.rs": "a", "client/client.ts": "b" };

let sent: ReturnType<typeof memoryProvider>;
beforeEach(() => {
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
});
afterEach(() => {
  vi.restoreAllMocks();
  resetTelemetry();
});

const names = () => sent.events.map((event) => event.name);

/** `/api/gists` answers these, one per request, in order */
const answers = (...replies: Array<[number, unknown]>) => {
  const fetch = vi.spyOn(globalThis, "fetch");
  for (const [status, body] of replies) {
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status }) as Response
    );
  }
  return fetch;
};

const renderShare = ({
  signedIn = true,
  signIn = vi.fn<ShareGistProps["signIn"]>().mockResolvedValue(undefined),
}: {
  signedIn?: boolean;
  signIn?: Mock<ShareGistProps["signIn"]>;
} = {}) => {
  // The app's root provides the tooltips Copy needs, and runs under
  // StrictMode in development, which mounts every effect twice
  render(
    <StrictMode>
      <TooltipProvider>
        <ShareGist
          name="counter"
          readFiles={async () => FILES}
          signedIn={signedIn}
          signIn={signIn}
        />
      </TooltipProvider>
    </StrictMode>
  );
  return { signIn };
};

const press = (name: RegExp) =>
  act(async () => fireEvent.click(screen.getByRole("button", { name })));

it("sends nothing until create is pressed, and says the gist is public", () => {
  const fetch = vi.spyOn(globalThis, "fetch");

  renderShare();

  expect(screen.getByText(/The gist is public/)).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Create public gist" })
  ).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});

it("creates the gist and shows its url, Copy and Open on GitHub", async () => {
  answers([201, { url: URL, id: "abc" }]);
  renderShare();

  await press(/Create public gist/);

  expect(screen.getByLabelText("Gist URL")).toHaveProperty("value", URL);
  expect(screen.getByRole("button", { name: "Copy gist URL" })).toBeTruthy();
  const open = screen.getByRole("link", { name: /Open on GitHub/ });
  expect(open.getAttribute("href")).toBe(URL);
  expect(open.getAttribute("target")).toBe("_blank");
  expect(open.getAttribute("rel")).toBe("noopener noreferrer");
  expect(sent.events).toEqual([
    { name: "gist_export_started", params: { files: 2 } },
    { name: "gist_export_succeeded", params: { files: 2 } },
  ]);
});

it("signs a signed-out user in, then creates the gist without a second press", async () => {
  answers([201, { url: URL, id: "abc" }]);
  const { signIn } = renderShare({ signedIn: false });

  await press(/Sign in with GitHub to share/);

  expect(signIn).toHaveBeenCalledWith(undefined);
  expect(screen.getByLabelText("Gist URL")).toHaveProperty("value", URL);
});

it("keeps the dialog on sign-in when the user cancels it", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  renderShare({
    signedIn: false,
    signIn: vi.fn().mockRejectedValue(new Error("Sign-in cancelled.")),
  });

  await press(/Sign in with GitHub to share/);

  expect(screen.getByText("Sign-in cancelled.")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Sign in with GitHub to share" })
  ).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
  expect(sent.events).toEqual([
    { name: "gist_export_failed", params: { reason: "sign-in-failed" } },
  ]);
});

it("moves on to create once the session reads as signed in", () => {
  const share = (signedIn: boolean) => (
    <TooltipProvider>
      <ShareGist
        name="counter"
        readFiles={async () => FILES}
        signedIn={signedIn}
        signIn={vi.fn()}
      />
    </TooltipProvider>
  );
  const { rerender } = render(share(false));
  expect(
    screen.getByRole("button", { name: "Sign in with GitHub to share" })
  ).toBeTruthy();

  rerender(share(true));

  expect(
    screen.getByRole("button", { name: "Create public gist" })
  ).toBeTruthy();
});

it("stays on create when the project cannot be read, and tells the user", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  const toast = vi.fn();
  vi.spyOn(PgView, "setToast").mockImplementation(toast);
  render(
    <StrictMode>
      <TooltipProvider>
        <ShareGist
          name="counter"
          readFiles={() => Promise.reject(new Error("store unreadable"))}
          signedIn
          signIn={vi.fn()}
        />
      </TooltipProvider>
    </StrictMode>
  );

  await press(/Create public gist/);

  expect(fetch).not.toHaveBeenCalled();
  expect(toast).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("button", { name: "Create public gist" })
  ).toBeTruthy();
  expect(sent.events).toEqual([]);
});

it("says so when the browser blocks the sign-in popup", async () => {
  renderShare({
    signedIn: false,
    signIn: vi
      .fn()
      .mockRejectedValue(new Error("Allow popups for this site to sign in.")),
  });

  await press(/Sign in with GitHub to share/);

  expect(
    screen.getByText("Allow popups for this site to sign in.")
  ).toBeTruthy();
});

it("asks for gist access once, then retries by itself", async () => {
  answers(
    [403, { reason: "needs-gist-scope" }],
    [201, { url: URL, id: "abc" }]
  );
  const { signIn } = renderShare();

  await press(/Create public gist/);
  expect(screen.getByText(/GitHub needs your permission/)).toBeTruthy();

  await press(/Allow gists on GitHub/);

  expect(signIn).toHaveBeenCalledWith({ scopes: ["gist"] });
  expect(screen.getByLabelText("Gist URL")).toHaveProperty("value", URL);
  expect(names()).toEqual([
    "gist_export_started",
    "gist_export_scope_requested",
    "gist_export_started",
    "gist_export_succeeded",
  ]);
});

it("stops when GitHub still lacks gist access after the grant", async () => {
  const fetch = answers(
    [403, { reason: "needs-gist-scope" }],
    [403, { reason: "needs-gist-scope" }]
  );
  renderShare();

  await press(/Create public gist/);
  await press(/Allow gists on GitHub/);

  expect(screen.getByText(/GitHub did not grant gist access/)).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(sent.events.at(-1)).toEqual({
    name: "gist_export_failed",
    params: { reason: "needs-gist-scope" },
  });
});

it("offers sign-in again when GitHub revoked the grant", async () => {
  answers([401, { reason: "github-unauthorized" }], [201, { url: URL }]);
  const { signIn } = renderShare();

  await press(/Create public gist/);
  expect(
    screen.getByText(/GitHub no longer accepts this sign-in/)
  ).toBeTruthy();

  await press(/Sign in with GitHub again/);

  expect(signIn).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Gist URL")).toHaveProperty("value", URL);
});

it("goes back to sign-in when the session ended meanwhile", async () => {
  answers([401, { reason: "signed-out" }]);
  renderShare();

  await press(/Create public gist/);

  expect(screen.getByText(/Your session ended/)).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Sign in with GitHub to share" })
  ).toBeTruthy();
  expect(sent.events.at(-1)).toEqual({
    name: "gist_export_failed",
    params: { reason: "signed-out" },
  });
});

it.each([
  [
    429,
    { reason: "rate-limited" },
    /GitHub is limiting requests/,
    "rate-limited",
  ],
  [422, { reason: "rejected" }, /GitHub refused the gist/, "rejected"],
  [
    502,
    { reason: "request-failed" },
    /Could not reach GitHub/,
    "request-failed",
  ],
])(
  "tells a %i apart and offers to try again",
  async (status, body, message, reason) => {
    answers([status, body]);
    renderShare();

    await press(/Create public gist/);

    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(sent.events.at(-1)).toEqual({
      name: "gist_export_failed",
      params: { reason },
    });
  }
);
