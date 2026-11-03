import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import BaseCatalogPage from "./BaseCatalogPage";
import type {
  BaseCatalogPageProps,
  CardOpen,
  CatalogCard,
  CatalogList,
} from "./BaseCatalogPage";

const card = (id: string, open?: CardOpen): CatalogCard => ({
  id,
  title: id,
  description: `About ${id}`,
  media: `/${id}.png`,
  tags: [{ label: "Beginner" }, { label: "Anchor" }],
  open,
});
const ready = (...cards: CatalogCard[]): CatalogList => ({
  state: "ready",
  cards,
});

const draw = (props: Partial<BaseCatalogPageProps> = {}) => {
  const all: BaseCatalogPageProps = {
    label: "tutorials",
    query: props.query ?? "",
    onQuery: props.onQuery ?? vi.fn(),
    list: props.list ?? ready(card("Hello Anchor")),
    busy: props.busy ?? false,
    onOpen: props.onOpen ?? vi.fn(async () => {}),
  };
  return render(<BaseCatalogPage {...all} />);
};

const cardOf = (title: string) =>
  screen
    .getByRole("button", { name: `Open ${title}` })
    .closest("[data-slot=action-card]") as HTMLElement;

it("names its search field after the page and reports typing", () => {
  const onQuery = vi.fn();
  draw({ onQuery });

  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search tutorials" }),
    {
      target: { value: "anchor" },
    }
  );
  expect(onQuery).toHaveBeenCalledWith("anchor");
});

it("draws a card per item with its tags as one line and an Open of its own", () => {
  draw({ list: ready(card("Hello Anchor"), card("Hello Solana")) });

  expect(screen.getAllByRole("button", { name: /^Open / })).toHaveLength(2);
  const own = within(cardOf("Hello Anchor"));
  expect(own.getByText("About Hello Anchor")).toBeTruthy();
  // The prototype writes them as plain text, not chips
  const eyebrow = own.getByText("Beginner · Anchor");
  expect(eyebrow.dataset.slot).toBe("action-card-eyebrow");
  expect(eyebrow.querySelector("[data-slot=tag]")).toBeNull();
});

it("opens the card's item from its Open", async () => {
  const onOpen = vi.fn(async () => {});
  draw({ onOpen });

  // Async: Open is an AsyncButton, which settles once `onOpen` resolves
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Open Hello Anchor" }));
  });
  expect(onOpen).toHaveBeenCalledWith("Hello Anchor");
});

// Below 768 px the card's own Open is hidden and the title is the action
it("opens the card's item from its title", () => {
  const onOpen = vi.fn(async () => {});
  draw({ onOpen });

  fireEvent.click(screen.getByRole("button", { name: "Hello Anchor" }));
  expect(onOpen).toHaveBeenCalledWith("Hello Anchor");
});

it("offers no second Open while one runs, from any card", () => {
  const onOpen = vi.fn(async () => {});
  draw({
    list: ready(
      card("Hello Anchor", {
        state: "running",
        text: "Downloading 1/3 files…",
      }),
      card("Hello Solana")
    ),
    busy: true,
    onOpen,
  });

  for (const name of ["Hello Solana", "Open Hello Solana", "Hello Anchor"]) {
    const button = screen.getByRole("button", { name }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
  }
  expect(onOpen).not.toHaveBeenCalled();
});

it("says so when nothing matches the query", () => {
  draw({ list: ready(), query: "zzz" });

  expect(screen.getByText("No tutorials match “zzz”.")).toBeTruthy();
});

it("shows that the list is loading", () => {
  draw({ list: { state: "loading" } });

  expect(screen.getByText("Loading tutorials…")).toBeTruthy();
});

it("offers a retry when the list failed", () => {
  const onRetry = vi.fn();
  draw({ list: { state: "failed", message: "Could not load.", onRetry } });

  expect(screen.getByText("Could not load.")).toBeTruthy();
  expect(screen.queryByText("Loading tutorials…")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it("shows a card's own failure and progress inside that card only", () => {
  draw({
    list: ready(
      card("Hello Anchor", { state: "failed", message: "Rate limited" }),
      card("Hello Solana", { state: "running", text: "Fetching files" })
    ),
  });

  const anchor = within(cardOf("Hello Anchor"));
  const solana = within(cardOf("Hello Solana"));
  expect(anchor.getByRole("alert").textContent).toBe("Rate limited");
  expect(solana.queryByRole("alert")).toBeNull();
  expect(solana.getByText("Fetching files")).toBeTruthy();
});

it("writes a repeated label twice, as the listing has it", () => {
  const twice: CatalogCard = {
    id: "x",
    title: "x",
    description: "d",
    media: "/x.png",
    tags: [{ label: "DeFi" }, { label: "DeFi" }],
  };
  draw({ list: ready(twice) });

  expect(within(cardOf("x")).getByText("DeFi · DeFi")).toBeTruthy();
});
