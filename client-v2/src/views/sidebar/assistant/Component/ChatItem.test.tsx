// The approval card's buttons answer the card they sit on, once each.
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, type DefaultTheme } from "styled-components";
import { afterEach, describe, expect, it, vi } from "vitest";

import ChatItem from "./ChatItem";
import { PgAssistant, type ChatItem as Item } from "../store";

// Replies render markdown; no reply is rendered here
vi.mock("../../../../components/Markdown", () => ({ default: () => null }));

/** A theme that answers every key; the styles do not matter here */
const anyTheme: DefaultTheme = new Proxy(
  {},
  {
    get: (_, key) =>
      key === Symbol.toPrimitive || key === "toString"
        ? () => "inherit"
        : anyTheme,
  }
) as unknown as DefaultTheme;

const buildApproval: Item = {
  id: "card-1",
  createdAt: "2026-10-14T00:00:00.000Z",
  kind: "approval",
  status: "pending",
  request: { type: "command", name: "build", effect: "Compiles the program" },
};

const renderCard = () =>
  render(
    <ThemeProvider theme={anyTheme}>
      <ChatItem item={buildApproval} />
    </ThemeProvider>
  );

afterEach(() => vi.restoreAllMocks());

describe("approval card", () => {
  it("allows the request it shows, once", () => {
    const resolve = vi
      .spyOn(PgAssistant, "resolveApproval")
      .mockReturnValue(undefined);
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Allow" }));

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith("card-1", true);
  });

  it("denies the request it shows, once", () => {
    const resolve = vi
      .spyOn(PgAssistant, "resolveApproval")
      .mockReturnValue(undefined);
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Deny" }));

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith("card-1", false);
  });
});
