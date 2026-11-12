import type { Locator, Page } from "@playwright/test";

import type {
  Ask,
  Beat,
  Text,
  TutorialDefinition,
} from "../src/entities/tutorial";
import hello from "../src/tutorials/hello-anchor/tutorial.json";
import { expect, LONG } from "./fixtures";

/**
 * Hello Anchor as the e2e specs read it: the lesson's beats and steps from its
 * definition, so tuning the lesson's words breaks no spec, and the feed's
 * cards found through them. The desktop (`tutorial-hello-anchor`) and the
 * phone (`tutorial-hello-anchor-phone`) share these; each binds them to where
 * its feed is drawn with `cardsFor`.
 */

/** The lesson as the app reads it */
export const lesson = hello as unknown as TutorialDefinition;

/** The beat `id` of kind `kind`; throws when the lesson has none */
export const beat = <K extends Beat["kind"]>(id: string, kind: K) => {
  const all = lesson.steps.flatMap((s) => s.beats.concat(s.onFail ?? []));
  const found = all.find((b) => b.id === id);
  if (!found || found.kind !== kind)
    throw new Error(`Hello Anchor has no ${kind} beat "${id}"`);
  return found as Extract<Beat, { kind: K }>;
};

/** The step `id`; throws when the lesson has none */
export const step = (id: string) => {
  const found = lesson.steps.find((s) => s.id === id);
  if (!found) throw new Error(`Hello Anchor has no step "${id}"`);
  return found;
};

/** A text's desktop words */
export const words = (text: Text) =>
  typeof text === "string" ? text : text.text;

export const escape = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Markdown's inline code as the page reads it: the words, no backticks */
export const plain = (text: string) => text.replace(/`/g, "");

/** The feed's cards, found in the feed `feed` draws */
export const cardsFor = (feed: (page: Page) => Locator) => {
  /** The option `index` of a question, as its button */
  const optionFor = (ask: Ask, index: number) => (page: Page) =>
    feed(page).getByRole("button", {
      name: new RegExp(`^${escape(plain(ask.options[index]))}`),
    });
  return {
    optionFor,
    /** Picks the right answer of `ask` once it is in the feed */
    answer: async (page: Page, ask: Ask) => {
      await optionFor(ask, ask.answer)(page).click(LONG);
    },
    /** The live act card of `id`, and its button */
    act: (page: Page, id: string) =>
      feed(page)
        .getByRole("button", { name: beat(id, "act").button, exact: true })
        .last(),
    /** The step's win card has landed: its headline is in the feed */
    won: async (page: Page, id: string) => {
      await expect(
        feed(page)
          .getByText(words(step(id).win.headline), { exact: false })
          .first()
      ).toBeVisible(LONG);
    },
    /** A passed step's act keeps no live button: only the latest card acts */
    spent: async (page: Page, ...ids: string[]) => {
      for (const id of ids) {
        await expect(
          feed(page).getByRole("button", {
            name: beat(id, "act").button,
            exact: true,
          })
        ).toHaveCount(0);
      }
    },
    /** The live Next, "Next: <the next step's title>" */
    next: (page: Page) =>
      feed(page).getByRole("button", { name: /^Next/ }).last(),
  };
};
