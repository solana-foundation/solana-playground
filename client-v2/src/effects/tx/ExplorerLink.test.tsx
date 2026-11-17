import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { ExplorerLink } from "./ExplorerLink";

vi.mock("../../hooks", () => ({
  useBlockExplorer: () => ({
    name: "Solana Explorer",
    getTxUrl: (hash: string) => `https://explorer.solana.com/tx/${hash}`,
  }),
}));

const SIGNATURE = "9hJqVkLtTRvQW1sUn6c3vXbF8pZkM2yHdA4eGqWxCvBz";

it("says the transaction was sent and shows the signature shortened", () => {
  render(<ExplorerLink txHash={SIGNATURE} />);

  expect(screen.getByText("Transaction sent")).toBeTruthy();
  expect(screen.getByText("9hJqVk…WxCvBz")).toBeTruthy();
});

it("links the signature to the transaction on the picked explorer", () => {
  render(<ExplorerLink txHash={SIGNATURE} />);

  const link = screen.getByRole("link", {
    name: "Open 9hJqVk…WxCvBz on Solana Explorer",
  });
  expect(link.getAttribute("href")).toBe(
    `https://explorer.solana.com/tx/${SIGNATURE}`
  );
});
