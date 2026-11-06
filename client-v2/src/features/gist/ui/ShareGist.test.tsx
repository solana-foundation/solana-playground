// The share dialog's body and its one action end to end against a stubbed
// `/api/gists`: the visibility it shares with, sign-in first when signed out
// (and its cancel), gist access asked for only when the token lacks it, the
// link it copies, and every ending counted once.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { type ComponentType, StrictMode } from "react";
import type { Mock } from "vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { PgView } from "@/utils/view";

import BaseShareGist, { shareAction, shareTitle } from "./BaseShareGist";
import type { ShareGistOptions } from "./ShareGist";
import { useShareGist } from "./ShareGist";

/** What a create rejected with, which the app's frame reports and toasts */
const frameFailures: unknown[] = [];

/**
 * The dialog as the app's frame draws it: the step's title, the body, and
 * the footer's one action, which starts a sign-in without waiting on it
 */
const Dialog = (options: ShareGistOptions) => {
  const { body, run } = useShareGist(
    {
      signIn: options.signIn,
      cancelSignIn: options.cancelSignIn,
      origin: options.origin,
    },
    {
      name: options.name,
      readFiles: options.readFiles,
      source: options.source,
      signedIn: options.signedIn,
    }
  );
  const action = shareAction(body);
  const press = () => {
    switch (action.run) {
      case "close":
        return;
      case "create":
        return run.create().catch((e: unknown) => frameFailures.push(e));
      case "sign-in":
      case "grant":
        void run[action.run]().catch((e: unknown) => frameFailures.push(e));
        return;
      default:
        return run[action.run]();
    }
  };
  return (
    <>
      <h2>{shareTitle(body)}</h2>
      <BaseShareGist {...body} githubMark={<svg />} />
      <button type="button" disabled={action.busy} onClick={press}>
        {action.label}
      </button>
    </>
  );
};

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
  frameFailures.length = 0;
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
  vi.fn<ShareGistOptions["signIn"]>().mockResolvedValue("signed-in");

const noCancel = () => vi.fn<ShareGistOptions["cancelSignIn"]>();

const readsFiles: ShareGistOptions["readFiles"] = async () => FILES;

const renderShareWith = ({
  signedIn,
  signIn,
  cancelSignIn,
  readFiles,
}: {
  signedIn: boolean;
  signIn: Mock<ShareGistOptions["signIn"]>;
  cancelSignIn: Mock<ShareGistOptions["cancelSignIn"]>;
  readFiles: ShareGistOptions["readFiles"];
}) => {
  // The app's root provides the tooltips Copy needs, and runs under
  // StrictMode in development, which mounts every effect twice
  render(
    <StrictMode>
      <TooltipProvider>
        <Dialog
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

const renderShare = () =>
  renderShareWith({
    signedIn: true,
    signIn: resolvingSignIn(),
    cancelSignIn: noCancel(),
    readFiles: readsFiles,
  });

/** A sign-in whose popup stays open until the test cancels it */
const pendingSignIn = () => {
  let answer: (outcome: "signed-in" | "cancelled") => void = () => {};
  const signIn = vi.fn<ShareGistOptions["signIn"]>(
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

const press = (name: RegExp) =>
  act(async () => fireEvent.click(screen.getByRole("button", { name })));

it("sends nothing on open, with Secret chosen and Create secret gist offered", () => {
  const fetch = vi.spyOn(globalThis, "fetch");

  renderShare();

  expect(
    screen.getByRole("radio", { name: "Secret" }).getAttribute("aria-checked")
  ).toBe("true");
  expect(
    screen.getByRole("radio", { name: "Public" }).getAttribute("aria-checked")
  ).toBe("false");
  expect(
    screen.getByRole("heading", { name: "Share counter as a gist" })
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Create secret gist" })
  ).toBeTruthy();
  expect(screen.getByText(/program keypair/)).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});

it("shares a secret gist and shows the Playground link, not the gist URL", async () => {
  const fetch = answers([201, { url: URL, id: "abc" }]);
  renderShare();

  await press(/^Create secret gist$/);

  expect(postedPublic(fetch, 0)).toBe(false);
  expect(
    screen.getByRole("heading", { name: "Shared as a secret gist" })
  ).toBeTruthy();
  expect(screen.getByLabelText("Playground link")).toHaveProperty(
    "value",
    LINK
  );
  expect(screen.queryByDisplayValue(URL)).toBeNull();
  expect(
    screen.getByText(
      "Anyone with this link can open it. It isn't on your GitHub profile."
    )
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
  const open = screen.getByRole("link", { name: /Open the gist on GitHub/ });
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
  await press(/^Create public gist$/);

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
  await press(/^Create secret gist$/);

  await press(/^Copy link$/);

  expect(write).toHaveBeenCalledWith(LINK);
  expect(toast).toHaveBeenCalledTimes(1);
  expect(toast.mock.calls[0][1]).toEqual({
    options: { name: "gist-link-copied" },
  });
  const Toast = toast.mock.calls[0][0] as ComponentType;
  expect(render(<Toast />).container.textContent).toBe("Link copied");
  expect(sent.events.at(-1)).toEqual({
    name: "gist_link_copied",
    params: { copied: "playground" },
  });
});

it("offers one copy, the Playground link's, and the gist on GitHub as a link", async () => {
  answers([201, { url: URL, id: "abc" }]);
  renderShare();
  await press(/^Create secret gist$/);

  expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
    "Copy link",
  ]);
  expect(
    screen.getByRole("link", { name: /Open the gist on GitHub/ })
  ).toBeTruthy();
});

it("says the link was not copied when the clipboard refuses, with no toast", async () => {
  answers([201, { url: URL, id: "abc" }]);
  stubClipboard(() => Promise.reject(new Error("denied")));
  const toast = vi.spyOn(PgView, "setToast").mockImplementation(vi.fn());
  renderShare();
  await press(/^Create secret gist$/);

  await press(/^Copy link$/);

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
    readFiles: readsFiles,
  });

  await press(/^Sign in with GitHub$/);

  expect(signIn).toHaveBeenCalledWith([]);
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
    readFiles: readsFiles,
  });

  await press(/^Sign in with GitHub$/);
  expect(
    screen.queryByRole("button", { name: "Sign in with GitHub" })
  ).toBeNull();
  expect(screen.getByRole("button", { name: "Cancel sign-in" })).toBeTruthy();

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
    readFiles: readsFiles,
  });
  await press(/^Create secret gist$/);

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
      <Dialog
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

  expect(
    screen.getByRole("button", { name: "Create secret gist" })
  ).toBeTruthy();
});

it("stays ready when the project cannot be read, and leaves the failure to the frame", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  renderShareWith({
    signedIn: true,
    signIn: resolvingSignIn(),
    cancelSignIn: noCancel(),
    readFiles: () => Promise.reject(new Error("store unreadable")),
  });

  await press(/^Create secret gist$/);

  expect(fetch).not.toHaveBeenCalled();
  expect(frameFailures).toEqual([new Error("store unreadable")]);
  expect(
    screen.getByRole("button", { name: "Create secret gist" })
  ).toBeTruthy();
  expect(sent.events).toEqual([
    {
      name: "gist_export_failed",
      params: { reason: "read-failed", visibility: "secret" },
    },
  ]);
});

it("counts and hands on an unreadable project after a grant too", async () => {
  answers([403, { reason: "needs-gist-scope" }]);
  let reads = 0;
  renderShareWith({
    signedIn: true,
    signIn: resolvingSignIn(),
    cancelSignIn: noCancel(),
    // The file list twice (StrictMode) and the first export read it; the export
    // after the grant fails
    readFiles: async () => {
      reads += 1;
      if (reads > 3) throw new Error("store unreadable");
      return FILES;
    },
  });

  await press(/^Create secret gist$/);
  await press(/^Allow gists on GitHub$/);

  expect(frameFailures).toEqual([new Error("store unreadable")]);
  expect(names().at(-1)).toBe("gist_export_failed");
});

it("counts and hands on an unreadable project after a sign-in too", async () => {
  renderShareWith({
    signedIn: false,
    signIn: resolvingSignIn(),
    cancelSignIn: noCancel(),
    readFiles: () => Promise.reject(new Error("store unreadable")),
  });

  await press(/^Sign in with GitHub$/);

  expect(frameFailures).toEqual([new Error("store unreadable")]);
  expect(names()).toEqual(["gist_export_failed"]);
});

it("lists what goes to the gist, folded, with the manifest named", async () => {
  renderShare();

  const row = await screen.findByRole("button", {
    name: /2 files go to the gist/,
  });
  expect(screen.queryByText("src/lib.rs")).toBeNull();

  await act(async () => fireEvent.click(row));

  expect(row.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("client/client.ts")).toBeTruthy();
  expect(screen.getByText("src/lib.rs")).toBeTruthy();
  expect(screen.getByText(".playground.json")).toBeTruthy();
  expect(screen.getByText("!counter")).toBeTruthy();
});

it("says so when the browser blocks the sign-in popup", async () => {
  renderShareWith({
    signedIn: false,
    signIn: vi
      .fn()
      .mockRejectedValue(
        new Error("Allow pop-ups for this site to sign in with GitHub.")
      ),
    cancelSignIn: noCancel(),
    readFiles: readsFiles,
  });

  await press(/^Sign in with GitHub$/);

  expect(
    screen.getByText("Allow pop-ups for this site to sign in with GitHub.")
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
  await press(/^Create public gist$/);
  expect(screen.getByText("One more step on GitHub")).toBeTruthy();
  expect(screen.getByText(/Then the public gist is created/)).toBeTruthy();

  await press(/Allow gists on GitHub/);

  expect(signIn).toHaveBeenCalledWith(["gist"]);
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

  await press(/^Create secret gist$/);
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

  await press(/^Create secret gist$/);
  expect(
    screen.getByText(/GitHub no longer accepts this sign-in/)
  ).toBeTruthy();

  await press(/^Sign in with GitHub$/);

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

  await press(/^Create secret gist$/);

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
  {
    status: 429,
    body: { reason: "rate-limited" },
    message:
      "GitHub is limiting requests from this browser. Try again in a few minutes.",
    reason: "rate-limited",
    action: "Try again",
  },
  {
    status: 422,
    body: { reason: "rejected" },
    message: "GitHub refused the gist. Nothing was published.",
    reason: "rejected",
    action: "Close",
  },
  {
    status: 502,
    body: { reason: "request-failed" },
    message:
      "Could not export to GitHub. Check your gists on GitHub before you try again.",
    reason: "request-failed",
    action: "Try again",
  },
])(
  "tells a $status apart, offering a retry unless GitHub refused the gist",
  async ({ status, body, message, reason, action }) => {
    answers([status, body]);
    renderShare();

    await press(/^Create secret gist$/);

    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.getAllByRole("button").at(-1)?.textContent).toBe(action);
    expect(sent.events.at(-1)).toEqual({
      name: "gist_export_failed",
      params: { reason, visibility: "secret" },
    });
  }
);

it("says it could not sign in when the failure carries no words", async () => {
  renderShareWith({
    signedIn: false,
    signIn: vi.fn().mockRejectedValue(new Error("")),
    cancelSignIn: noCancel(),
    readFiles: readsFiles,
  });

  await press(/^Sign in with GitHub$/);

  // Spec 08 ACCT-03
  expect(screen.getByText("Could not sign in.")).toBeTruthy();
});

it("says a sign-in the user ended on GitHub quietly too, and a failure in red", async () => {
  const signIn = vi
    .fn<ShareGistOptions["signIn"]>()
    .mockResolvedValueOnce("cancelled")
    .mockRejectedValueOnce(
      new Error("Allow pop-ups for this site to sign in with GitHub.")
    );
  renderShareWith({
    signedIn: false,
    signIn,
    cancelSignIn: noCancel(),
    readFiles: readsFiles,
  });

  await press(/^Sign in with GitHub$/);
  expectQuietCancel();

  await press(/^Sign in with GitHub$/);
  const failure = screen.getByText(
    "Allow pop-ups for this site to sign in with GitHub."
  );
  expect(failure.closest('[data-slot="callout"]')).not.toBeNull();
  expect(screen.queryByText("Sign-in cancelled.")).toBeNull();
});
