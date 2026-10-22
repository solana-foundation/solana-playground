import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { initLogger, memoryProvider, resetLogger } from "@/shared/lib/logger";
import BaseCatalogGrid from "./BaseCatalogGrid";
import type { CatalogCard } from "./BaseCatalogGrid";

afterEach(() => resetLogger());

const card = (id: string): CatalogCard => ({
  id,
  title: id,
  description: `About ${id}`,
  media: `/${id}.png`,
  tags: [{ label: "Anchor" }],
});

it("ends every card in a chevron for a phone, hidden from readers", () => {
  render(
    <BaseCatalogGrid
      label="tutorials"
      query=""
      list={{ state: "ready", cards: [card("Hello Anchor"), card("Escrow")] }}
      busy={false}
      onOpen={vi.fn(async () => {})}
    />
  );

  const cards = document.querySelectorAll("[data-slot=action-card]");
  expect(cards).toHaveLength(2);
  cards.forEach((c) => {
    const chevron = c.querySelector("[data-card-chevron]");
    expect(chevron?.getAttribute("aria-hidden")).toBe("true");
  });
});

it("reports an Open from the card's title that rejects, as its button would", async () => {
  const logged = memoryProvider();
  initLogger({ providers: [logged] });
  render(
    <BaseCatalogGrid
      label="tutorials"
      query=""
      list={{ state: "ready", cards: [card("Hello Anchor")] }}
      busy={false}
      onOpen={vi.fn(async () => {
        throw new Error("closing failed");
      })}
    />
  );

  fireEvent.click(screen.getByRole("button", { name: "Hello Anchor" }));

  await waitFor(() =>
    expect(logged.entries.map((e) => e.ns)).toEqual(["ui:button"])
  );
});
