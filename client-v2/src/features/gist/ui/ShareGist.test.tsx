// The share dialog's body end to end against a stubbed `/api/gists`: the
// visibility it shares with, sign-in first when signed out (and its cancel),
// gist access asked for only when the token lacks it, the links it copies,
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

/** A cancel the user made is a quiet line, never an error callout */
const expectQuietCancel = () => {
  const line = screen.getByText("Sign-in cancelled.");
  expect(line.closest('[data-slot="callout"]')).toBeNull();
};

const URL = "https://gist.github.com/ada/abc";
const ORIGIN = "https://beta.solpg.io";
const LINK = `${ORIGIN}/gist/abc`;
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

const resolvingSignIn = () =>
  vi.fn<ShareGistProps["signIn"]>().mockResolvedValue("signed-in");

const noCancel = () => vi.fn<ShareGistProps["cancelSignIn"]>();

const renderShareWith = ({
  signedIn,
  signIn,
  cancelSignIn,
  readFiles,
}: {
  signedIn: boolean;
  signIn: Mock<ShareGistProps["signIn"]>;
  cancelSignIn: Mock<ShareGistProps["cancelSignIn"]>;
  readFiles: ShareGistProps["readFiles"];
}) => {
  // The app's root provides the tooltips Copy needs, and runs under
  // StrictMode in development, which mounts every effect twice
  render(
    <StrictMode>
      <TooltipProvider>
        <ShareGist
          name="counter"
          readFiles={readFiles}
          source="header"
          signedIn={signedIn}
          signIn={signIn}
          cancelSignIn={cancelSignIn}
          origin={ORIGIN}
        />
      </TooltipProvider>
    </StrictMode>
  );
  return { signIn, cancelSignIn };
};

/** A sign-in whose popup stays open until the test cancels it */
const pendingSignIn = () => {
  let answer: (outcome: "signed-in" | "cancelled") => void = () => {};
  const signIn = vi.fn<ShareGistProps["signIn"]>(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      })
  );
  return { signIn, cancel: () => answer("cancelled") };
};

/** What a body posted to `/api/gists` said about visibility */
const postedPublic = (fetch: ReturnType<typeof answers>, call: number) =>
  JSON.parse(fetch.mock.calls[call][1]?.body as string).public;

const stubClipboard = (writeText: () => Promise<void>) => {
  const write = vi.fn(writeText);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: write },
  });
  return write;
};

const renderShare = () =>
  renderShareWith({
    signedIn: true,
    signIn: resolvingSignIn(),
    cancelSignIn: noCancel(),
    readFiles: async () => FILES,
  });

const press = (name: RegExp) =>
  act(async () => fireEvent.click(screen.getByRole("button", { name })));

it("sends nothing on open, with Secret chosen and Share to GitHub offered", () => {
  const fetch = vi.spyOn(globalThis, "fetch");

  renderShare();

  expect(
    screen.getByRole("radio", { name: "Secret" }).getAttribute("aria-checked")
  ).toBe("true");
  expect(
    screen.getByRole("radio", { name: "Public" }).getAttribute("aria-checked")
  ).toBe("false");
  expect(screen.getByRole("button", { name: "Share to GitHub" })).toBeTruthy();
  expect(screen.getByText(/program keypair/)).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});

it("shares a secret gist and shows the Playground link, not the gist URL", async () => {
  const fetch = answers([201, { url: URL, id: "abc" }]);
  renderShare();

  await press(/^Share to GitHub$/);

  expect(postedPublic(fetch, 0)).toBe(false);
  expect(screen.getByText("Shared")).toBeTruthy();
  expect(screen.getByLabelText("Playground link")).toHaveProperty(
    "value",
    LINK
  );
  expect(screen.queryByDisplayValue(URL)).toBeNull();
  expect(
    screen.getByText(
      "Opens counter in Solana Playground as a preview. Anyone with the link can see the code."
    )
  ).toBeTruthy();
  const open = screen.getByRole("link", { name: /Open on GitHub/ });
  expect(open.getAttribute("href")).toBe(URL);
  expect(open.getAttribute("target")).toBe("_blank");
  expect(open.getAttribute("rel")).toBe("noopener noreferrer");
  expect(sent.events).toEqual([
    {
      name: "gist_export_started",
      params: { files: 2, visibility: "secret", source: "header" },
    },
    {
      name: "gist_export_succeeded",
      params: { files: 2, visibility: "secret" },
    },
  ]);
});

it("shares a public gist when Public is picked", async () => {
  const fetch = answers([201, { url: URL, id: "abc" }]);
  renderShare();

  await act(async () =>
    fireEvent.click(screen.getByRole("radio", { name: "Public" }))
  );
  await press(/^Share to GitHub$/);

  expect(postedPublic(fetch, 0)).toBe(true);
  expect(sent.events[0].params).toEqual({
    files: 2,
    visibility: "public",
    source: "header",
  });
});

it("copies the Playground link, toasts and counts it", async () => {
  answers([201, { url: URL, id: "abc" }]);
  const write = stubClipboard(async () => {});
  const toast = vi.spyOn(PgView, "setToast").mockImplementation(vi.fn());
  renderShare();
  await press(/^Share to GitHub$/);

  await press(/^Copy Playground link$/);

  expect(write).toHaveBeenCalledWith(LINK);
  expect(toast).toHaveBeenCalledTimes(1);
  expect(toast.mock.calls[0][1]).toEqual({
    options: { name: "gist-link-copied" },
  });
  expect(sent.events.at(-1)).toEqual({
    name: "gist_link_copied",
    params: { copied: "playground" },
  });
});

it("copies the GitHub link from its own button", async () => {
  answers([201, { url: URL, id: "abc" }]);
  const write = stubClipboard(async () => {});
  vi.spyOn(PgView, "setToast").mockImplementation(vi.fn());
  renderShare();
  await press(/^Share to GitHub$/);

  await press(/^Copy GitHub link$/);

  expect(write).toHaveBeenCalledWith(URL);
  expect(sent.events.at(-1)).toEqual({
    name: "gist_link_copied",
    params: { copied: "github" },
  });
});

it("says the link was not copied when the clipboard refuses, with no toast", async () => {
  answers([201, { url: URL, id: "abc" }]);
  stubClipboard(() => Promise.reject(new Error("denied")));
  const toast = vi.spyOn(PgView, "setToast").mockImplementation(vi.fn());
  renderShare();
  await press(/^Share to GitHub$/);

  await press(/^Copy Playground link$/);

  expect(screen.getByText(/Could not copy the link/)).toBeTruthy();
  expect(toast).not.toHaveBeenCalled();
  expect(names()).not.toContain("gist_link_copied");
});

it("signs a signed-out user in, then shares without a second press", async () => {
  answers([201, { url: URL, id: "abc" }]);
  const { signIn } = renderShareWith({
    signedIn: false,
    signIn: resolvingSignIn(),
    cancelSignIn: noCancel(),
    readFiles: async () => FILES,
  });

  await press(/^Sign in with GitHub$/);

  expect(signIn).toHaveBeenCalledWith(undefined);
  expect(screen.getByLabelText("Playground link")).toHaveProperty(
    "value",
    LINK
  );
});

it("offers Cancel sign-in while the popup waits, and stays on sign-in after it", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  const popup = pendingSignIn();
  const cancelSignIn = vi.fn(() => popup.cancel());
  renderShareWith({
    signedIn: false,
    signIn: popup.signIn,
    cancelSignIn,
    readFiles: async () => FILES,
  });

  await press(/^Sign in with GitHub$/);
  expect(
    screen.queryByRole("button", { name: "Sign in with GitHub" })
  ).toBeNull();
  const cancel = screen.getByRole("button", { name: "Cancel sign-in" });
  expect(cancel.id).toBe("share-gist-cancel-sign-in");

  await press(/^Cancel sign-in$/);

  expect(cancelSignIn).toHaveBeenCalledTimes(1);
  expectQuietCancel();
  expect(fetch).not.toHaveBeenCalled();
  expect(sent.events).toEqual([
    {
      name: "gist_export_failed",
      params: { reason: "sign-in-failed", visibility: "secret" },
    },
  ]);

  await press(/^Sign in with GitHub$/);
  expect(popup.signIn).toHaveBeenCalledTimes(2);
});

it("returns to Allow gists after a cancelled grant", async () => {
  answers([403, { reason: "needs-gist-scope" }]);
  const popup = pendingSignIn();
  renderShareWith({
    signedIn: true,
    signIn: popup.signIn,
    cancelSignIn: vi.fn(() => popup.cancel()),
    readFiles: async () => FILES,
  });
  await press(/^Share to GitHub$/);

  await press(/Allow gists on GitHub/);
  await press(/^Cancel sign-in$/);

  expectQuietCancel();
  expect(
    screen.getByRole("button", { name: "Allow gists on GitHub" })
  ).toBeTruthy();
});

it("moves on to share once the session reads as signed in", () => {
  const share = (signedIn: boolean) => (
    <TooltipProvider>
      <ShareGist
        name="counter"
        readFiles={async () => FILES}
        source="project_menu"
        signedIn={signedIn}
        signIn={vi.fn()}
        cancelSignIn={vi.fn()}
        origin={ORIGIN}
      />
    </TooltipProvider>
  );
  const { rerender } = render(share(false));
  expect(
    screen.getByRole("button", { name: "Sign in with GitHub" })
  ).toBeTruthy();

  rerender(share(true));

  expect(screen.getByRole("button", { name: "Share to GitHub" })).toBeTruthy();
});

it("stays ready when the project cannot be read, and tells the user", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  const toast = vi.fn();
  vi.spyOn(PgView, "setToast").mockImplementation(toast);
  renderShareWith({
    signedIn: true,
    signIn: resolvingSignIn(),
    cancelSignIn: noCancel(),
    readFiles: () => Promise.reject(new Error("store unreadable")),
  });

  await press(/^Share to GitHub$/);

  expect(fetch).not.toHaveBeenCalled();
  expect(toast).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Share to GitHub" })).toBeTruthy();
  expect(sent.events).toEqual([]);
});

it("says so when the browser blocks the sign-in popup", async () => {
  renderShareWith({
    signedIn: false,
    signIn: vi
      .fn()
      .mockRejectedValue(new Error("Allow popups for this site to sign in.")),
    cancelSignIn: noCancel(),
    readFiles: async () => FILES,
  });

  await press(/^Sign in with GitHub$/);

  expect(
    screen.getByText("Allow popups for this site to sign in.")
  ).toBeTruthy();
});

it("asks for gist access once, then retries by itself with the same visibility", async () => {
  const fetch = answers(
    [403, { reason: "needs-gist-scope" }],
    [201, { url: URL, id: "abc" }]
  );
  const { signIn } = renderShare();

  await act(async () =>
    fireEvent.click(screen.getByRole("radio", { name: "Public" }))
  );
  await press(/^Share to GitHub$/);
  expect(screen.getByText(/GitHub needs your permission/)).toBeTruthy();

  await press(/Allow gists on GitHub/);

  expect(signIn).toHaveBeenCalledWith({ scopes: ["gist"] });
  expect(postedPublic(fetch, 1)).toBe(true);
  expect(screen.getByLabelText("Playground link")).toHaveProperty(
    "value",
    LINK
  );
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

  await press(/^Share to GitHub$/);
  await press(/Allow gists on GitHub/);

  expect(screen.getByText(/GitHub did not grant gist access/)).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(sent.events.at(-1)).toEqual({
    name: "gist_export_failed",
    params: { reason: "needs-gist-scope", visibility: "secret" },
  });
});

it("offers sign-in again when GitHub revoked the grant", async () => {
  answers([401, { reason: "github-unauthorized" }], [201, { url: URL }]);
  const { signIn } = renderShare();

  await press(/^Share to GitHub$/);
  expect(
    screen.getByText(/GitHub no longer accepts this sign-in/)
  ).toBeTruthy();

  await press(/Sign in with GitHub again/);

  expect(signIn).toHaveBeenCalledTimes(1);
  // The id read from the gist's URL when the answer names none
  expect(screen.getByLabelText("Playground link")).toHaveProperty(
    "value",
    LINK
  );
});

it("goes back to sign-in when the session ended meanwhile", async () => {
  answers([401, { reason: "signed-out" }]);
  renderShare();

  await press(/^Share to GitHub$/);

  expect(screen.getByText(/Your session ended/)).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Sign in with GitHub" })
  ).toBeTruthy();
  expect(sent.events.at(-1)).toEqual({
    name: "gist_export_failed",
    params: { reason: "signed-out", visibility: "secret" },
  });
});

it.each([
  [
    429,
    { reason: "rate-limited" },
    "GitHub is limiting requests from this browser. Try again in a few minutes.",
    "rate-limited",
    true,
  ],
  [
    422,
    { reason: "rejected" },
    "GitHub refused the gist. Nothing was published.",
    "rejected",
    false,
  ],
  [
    502,
    { reason: "request-failed" },
    "Could not export to GitHub. Check your gists on GitHub before you try again.",
    "request-failed",
    true,
  ],
])(
  "tells a %i apart, offering a retry unless GitHub refused the gist",
  // eslint-disable-next-line max-params -- `it.each` spreads each row of the table into the callback
  async (status, body, message, reason, retry) => {
    answers([status, body]);
    renderShare();

    await press(/^Share to GitHub$/);

    expect(screen.getByText(message)).toBeTruthy();
    expect(!!screen.queryByRole("button", { name: "Try again" })).toBe(retry);
    expect(sent.events.at(-1)).toEqual({
      name: "gist_export_failed",
      params: { reason, visibility: "secret" },
    });
  }
);

it("says a sign-in the user ended on GitHub quietly too, and a failure in red", async () => {
  const signIn = vi
    .fn<ShareGistProps["signIn"]>()
    .mockResolvedValueOnce("cancelled")
    .mockRejectedValueOnce(new Error("Allow popups for this site to sign in."));
  renderShareWith({
    signedIn: false,
    signIn,
    cancelSignIn: noCancel(),
    readFiles: async () => FILES,
  });

  await press(/^Sign in with GitHub$/);
  expectQuietCancel();

  await press(/^Sign in with GitHub$/);
  const failure = screen.getByText("Allow popups for this site to sign in.");
  expect(failure.closest('[data-slot="callout"]')).not.toBeNull();
  expect(screen.queryByText("Sign-in cancelled.")).toBeNull();
});
