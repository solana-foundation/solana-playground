import type { Page } from "@playwright/test";
import {
  expect,
  json,
  LONG,
  seedWorkspace,
  stubSession,
  stubSignedIn,
  test,
  TEST_USER,
} from "./fixtures";
import { lineOf, linesOn } from "./telemetry";

/**
 * What a signed-out person is told about where the conversation is kept
 * (`openspec/specs/assistant-sign-out-history`, from the designers' Spec 08).
 * Signed out, a turn needs a key of one's own, so the provider is stubbed and
 * the panel connected to it directly.
 */

const SIGN_IN_TO_KEEP =
  "Sign in to keep this conversation on your other devices.";
const ENDPOINT = { baseUrl: "https://api.example.test/v1", model: "gpt-x" };
const REPLY = "stubbed provider reply";

type OwnWindow = Window & {
  __pgAssistant?: { connect: (c: unknown) => void };
};

const connectOwnKey = (page: Page) =>
  page.evaluate(
    (endpoint) =>
      (window as OwnWindow).__pgAssistant!.connect({
        id: "openai",
        apiKey: "sk-e2e-own-key-0123456789",
        endpoint,
      }),
    ENDPOINT
  );

const stubProvider = (page: Page) =>
  page.route(`${ENDPOINT.baseUrl}/chat/completions`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        `data: ${JSON.stringify({
          choices: [{ delta: { content: REPLY } }],
        })}\n\n` + "data: [DONE]\n\n",
    })
  );

const talk = async (page: Page) => {
  await connectOwnKey(page);
  const composer = page.getByRole("textbox", {
    name: "Message the assistant",
  });
  await composer.fill("hello");
  await composer.press("Enter");
  await expect(page.getByText(REPLY)).toBeVisible(LONG);
};

test("assistant-sign-out-history: Signed out with a conversation", async ({
  page,
}) => {
  await page.route("**/api/sync", (r) => json(r, { enabled: true, db: "ok" }));
  await stubSession(page, null);
  await stubProvider(page);
  await seedWorkspace(page, "signed-out-history");

  await talk(page);

  const log = page.getByRole("log", { name: "Conversation" });
  await expect(log.getByText(SIGN_IN_TO_KEEP)).toBeVisible(LONG);
  await expect(
    log.getByRole("button", { name: "Sign in with GitHub" })
  ).toBeEnabled();
});

test("assistant-sign-out-history: Signed in, or nothing to keep", async ({
  page,
  context,
}) => {
  await stubSignedIn(context);
  await stubProvider(page);
  await seedWorkspace(page, "signed-in-history");

  await talk(page);
  // The session has been read as signed in, so the line had its chance to show
  await expect(
    page.getByRole("button", { name: `Account: ${TEST_USER.login}` }).first()
  ).toBeVisible(LONG);

  await expect(page.getByText(SIGN_IN_TO_KEEP)).toHaveCount(0);
});

test("assistant-sign-out-history: Pressing the line's button", async ({
  page,
}) => {
  const lines = linesOn(page);
  await page.route("**/api/sync", (r) => json(r, { enabled: true, db: "ok" }));
  await stubSession(page, null);
  await stubProvider(page);
  // Refused, so no popup opens: what is under test is that the press is
  // reported and starts a sign-in
  let started = 0;
  await page.route("**/api/auth/sign-in/social", (route) => {
    started++;
    return route.fulfill({ status: 500, body: "" });
  });
  await seedWorkspace(page, "sign-in-pressed");
  await talk(page);

  await page
    .getByRole("log", { name: "Conversation" })
    .getByRole("button", { name: "Sign in with GitHub" })
    .click();

  await expect
    .poll(() => lineOf(lines, "assistant_sign_in_offered_clicked"))
    .toBeTruthy();
  await expect.poll(() => started).toBe(1);
});

test("assistant-sign-out-history: The sign-out dialog", async ({
  page,
  context,
}) => {
  await stubSignedIn(context);
  await seedWorkspace(page, "sign-out-dialog");
  await page
    .getByRole("button", { name: `Account: ${TEST_USER.login}` })
    .first()
    .click(LONG);
  await page.getByRole("menuitem", { name: "Sign out" }).click();

  const dialog = page.getByRole("dialog", { name: "Sign out of Playground?" });
  await expect(dialog).toContainText(
    "Projects saved to your account leave this browser. Anything not saved stays here."
  );
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
});
