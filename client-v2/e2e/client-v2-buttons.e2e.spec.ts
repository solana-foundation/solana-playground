import type { Locator, Page } from "@playwright/test";

import { expect, seedWorkspace, test } from "./fixtures";

type AssistantWindow = Window & {
  __pgAssistant?: {
    startAssistantMessage: () => string;
    appendToAssistantMessage: (id: string, delta: string) => void;
  };
};

const CODE = "anchor build\nanchor deploy";

/** Longer than a toast takes to appear once it is raised */
const TOAST_RENDER_MS = 1000;

/**
 * A ring brand button at rest, on the page itself rather than in a dialog:
 * the Build stage's Continue to Deploy, after a build the stub answers.
 */
const ringAction = async (page: Page) => {
  await page.route("**/build", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ stderr: "", uuid: "e2e-build", idl: null }),
    })
  );
  await page.locator("#flow-stage-tab-build").click();
  await page.getByRole("button", { name: "Build", exact: true }).click();
  return page.locator(
    '[data-slot="brand-button"][data-variant="ring"]:visible',
    {
      hasText: /Deploy/,
    }
  );
};

/**
 * The WCAG contrast ratio of a button's label against its resting fill.
 *
 * The fill is the ring's `--stroke-fill`, read through a probe element so the
 * browser resolves it to `rgb()`; the gradient under it is transparent until
 * hover, so the fill is what the label sits on.
 */
const restingContrast = (button: Locator) =>
  button.evaluate((el) => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--stroke-fill)";
    el.appendChild(probe);
    const fill = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const label = getComputedStyle(el).color;

    const luminance = (rgb: string) => {
      const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).map(Number);
      const [lr, lg, lb] = [r, g, b].map((c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
    };
    const [hi, lo] = [luminance(label), luminance(fill)].sort((a, b) => b - a);
    return { label, fill, ratio: (hi + 0.05) / (lo + 0.05) };
  });

test.describe("client-v2-buttons", () => {
  test("client-v2-buttons: Copying a code block", async ({
    seededPage: page,
    context,
  }) => {
    test.setTimeout(120_000);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    // An assistant reply is rendered by `components/Markdown`, which draws
    // fenced code through `components/CodeBlock`. Sending a message for real
    // would need a model, so the reply is written into the store directly.
    await page.evaluate(
      ({ code }) => {
        const store = (window as AssistantWindow).__pgAssistant;
        if (!store) throw new Error("assistant store not exposed");
        const id = store.startAssistantMessage();
        store.appendToAssistantMessage(
          id,
          "Run:\n\n```sh\n" + code + "\n```\n"
        );
      },
      { code: CODE }
    );

    const block = page.locator("pre", { hasText: "anchor build" }).first();
    await expect(block).toBeVisible();

    // The button shows on hover only
    const copy = page.locator('[data-slot="copy-button"]').first();
    await block.hover();
    await copy.click();

    await expect(copy).toHaveAccessibleName("Copied");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    // Markdown hands the block its code with the fence's closing newline
    expect(copied.trimEnd()).toBe(CODE);
  });

  test("client-v2-buttons: A refused clipboard is not reported as copied", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // An init script runs only in documents loaded after it is added, so it
    // goes in before seedWorkspace's navigation; that is why this test seeds
    // its own page instead of taking seededPage
    await page.addInitScript(() => {
      navigator.clipboard.writeText = () =>
        Promise.reject(new DOMException("denied", "NotAllowedError"));
    });
    const logged: string[] = [];
    page.on("console", (message) => logged.push(message.text()));

    await seedWorkspace(page);
    await page.waitForFunction(
      () => !!(window as AssistantWindow).__pgAssistant
    );
    await page.evaluate(() => {
      const store = (window as AssistantWindow).__pgAssistant!;
      const id = store.startAssistantMessage();
      store.appendToAssistantMessage(id, "Run:\n\n```sh\nanchor build\n```\n");
    });

    const block = page.locator("pre", { hasText: "anchor build" }).first();
    await expect(block).toBeVisible();
    const copy = page.locator('[data-slot="copy-button"]').first();
    await block.hover();
    await copy.click();

    // The refusal is logged under ui:button, and the button never claims
    // the copy happened. The label is read once, right after the log: a
    // retrying matcher would wait out the Copied timer and pass anyway
    await expect
      .poll(() => logged.some((l) => l.includes("[ui:button]")))
      .toBe(true);
    expect(await copy.getAttribute("aria-label")).toBe("Copy");
    // The user hears what did not happen, never the raw refusal
    await expect(page.getByText("Could not copy.")).toBeVisible();
    await expect(page.getByText("denied")).toHaveCount(0);
  });

  test("client-v2-buttons: A failure the terminal printed is shown once", async ({
    seededPage: page,
  }) => {
    test.setTimeout(120_000);
    await page.route("**/build", (route) =>
      route.fulfill({ status: 500, body: "boom" })
    );
    const logged: string[] = [];
    page.on("console", (message) => logged.push(message.text()));

    const drawer = page.getByRole("button", { name: "Terminal", exact: true });
    if ((await drawer.getAttribute("aria-expanded")) !== "true") {
      await drawer.click();
    }
    await page.locator("#flow-stage-tab-build").click();
    await page.getByRole("button", { name: "Build", exact: true }).click();

    // The console says it; a toast would say it a second time. The button's
    // onError logs before it would raise the toast, so the count is taken
    // once that log is in and the toast has had time to render. It is read
    // once: a retrying matcher passes falsely, either before a toast mounts
    // or after it has dismissed itself
    await expect(page.locator(".xterm-rows").first()).toContainText(
      /Process error: .*Server request failed/
    );
    await expect
      .poll(() => logged.some((l) => l.includes("[ui:button]")))
      .toBe(true);
    await page.waitForTimeout(TOAST_RENDER_MS);
    expect(await page.locator("[data-sonner-toast]").count()).toBe(0);
  });

  test("client-v2-buttons: A failed build is told once, by the Build stage", async ({
    seededPage: page,
  }) => {
    test.setTimeout(120_000);
    // The build server never answers: Spec 08's BUILD-04
    await page.route("**/build", (route) => route.abort("connectionrefused"));

    const drawer = page.getByRole("button", { name: "Terminal", exact: true });
    if ((await drawer.getAttribute("aria-expanded")) === "true") {
      await drawer.click();
    }
    await expect(drawer).toHaveAttribute("aria-expanded", "false");
    await page.locator("#flow-stage-tab-build").click();
    await page.getByRole("button", { name: "Build", exact: true }).click();

    // The console is folded, but the stage itself says the build failed
    await expect(
      page.getByRole("heading", { name: "Build did not start" })
    ).toBeVisible();
    await page.waitForTimeout(TOAST_RENDER_MS);
    expect(await page.locator("[data-sonner-toast]").count()).toBe(0);
  });

  test("client-v2-buttons: Build cannot be started twice", async ({
    seededPage: page,
  }) => {
    test.setTimeout(120_000);
    let builds = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/build", async (route) => {
      builds += 1;
      await held;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ stderr: "", uuid: "e2e-build", idl: null }),
      });
    });

    await page.locator("#flow-stage-tab-build").click();
    await page.getByRole("button", { name: "Build", exact: true }).click();

    // The surface keeps its button while the run is in flight, now busy
    const busy = page.getByRole("button", { name: /Building/ });
    await expect(busy).toBeDisabled();
    await expect(busy).toHaveAttribute("aria-busy", "true");
    await busy.click({ force: true });

    release();
    await expect(page.getByText("Build succeeded")).toBeVisible();
    expect(builds).toBe(1);
  });

  test("client-v2-buttons: The Build stage offers Deploy as a brand button", async ({
    seededPage: page,
  }) => {
    test.setTimeout(120_000);
    await page.route("**/build", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ stderr: "", uuid: "e2e-build", idl: null }),
      })
    );

    await page.locator("#flow-stage-tab-build").click();
    await page.getByRole("button", { name: "Build", exact: true }).click();

    // A view shows at most one brand button
    const brand = page
      .locator('[role="tabpanel"][aria-labelledby="flow-stage-tab-build"]')
      .locator('[data-slot="brand-button"]:visible');
    await expect(brand).toHaveCount(1);
    await expect(brand).toHaveText(/Deploy/);

    // Page-wide, that is the stage's Deploy: the assistant beside the stage
    // has none (Connect a model's action is its dialog's submit), and a brand
    // button anywhere else is a stray
    const everywhere = page.locator('[data-slot="brand-button"]:visible');
    await expect(everywhere).toHaveCount(1);
    await expect(everywhere).toHaveText([/Deploy/]);
  });

  test("client-v2-buttons: The ring brand button's label reads in the light theme", async ({
    seededPage: page,
  }) => {
    test.setTimeout(120_000);
    // The product does not follow the OS, so the theme is picked the way a
    // returning user's is: from storage
    await page.evaluate(() => localStorage.setItem("theme", "Light"));
    await page.reload();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.classList.contains("dark"))
      )
      .toBe(false);

    // At rest the ring's fill is the light surface; a white label vanishes
    const action = await ringAction(page);
    await expect(action).toBeVisible();
    await page.mouse.move(0, 0);
    const { label, ratio } = await restingContrast(action);
    expect(label).not.toBe("rgb(255, 255, 255)");
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  test("client-v2-buttons: The ring brand button's label reads in the dark theme", async ({
    seededPage: page,
  }) => {
    test.setTimeout(120_000);
    const action = await ringAction(page);
    await expect(action).toBeVisible();
    await page.mouse.move(0, 0);
    const { ratio } = await restingContrast(action);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
