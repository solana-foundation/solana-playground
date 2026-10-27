import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import Account from "./Account";
import { PgProgramInteraction } from "../../../../../utils/program-interaction";

// The utils barrel reads build-time globals jsdom lacks; Account uses a sliver.
vi.mock("../../../../../utils", () => ({
  PgCommon: {
    transition: (promise: Promise<unknown>) => promise,
    isPk: () => true,
    prettyJSON: (data: unknown) => JSON.stringify(data),
  },
  PgWeb3: { PublicKey: class {} },
}));
vi.mock("../../../../../utils/program-interaction", () => ({
  PgProgramInteraction: { fetchAccount: vi.fn(), fetchAllAccounts: vi.fn() },
}));
vi.mock("../../../../../components/Button", () => ({
  default: (props: { children: string; onClick: () => void }) => (
    <button onClick={props.onClick}>{props.children}</button>
  ),
}));
vi.mock("../../../../../components/Loading", () => ({
  SpinnerWithBg: (props: { children: React.ReactNode }) => props.children,
}));
vi.mock("../CodeResult", () => ({
  default: (props: { children: string }) => <pre>{props.children}</pre>,
}));
vi.mock("../InputLabel", () => ({ default: () => null }));
vi.mock("../../../../../hooks", () => ({ useWallet: () => ({}) }));
vi.mock("../../../../../components/SearchBar", () => ({
  default: (props: { value: string; onChange: (ev: unknown) => void }) => (
    <input aria-label="address" value={props.value} onChange={props.onChange} />
  ),
}));

afterEach(() => vi.restoreAllMocks());

it("opens the controlled Result fold when a fetch finishes", async () => {
  vi.spyOn(PgProgramInteraction, "fetchAllAccounts").mockResolvedValue([]);

  render(<Account accountName="counter" />);
  // Interaction's own fold is closed, so open it to reach the buttons.
  fireEvent.click(screen.getByRole("button", { name: "counter" }));
  fireEvent.click(screen.getByText("Fetch All"));

  const trigger = await screen.findByRole("button", { name: "Result" });
  expect(trigger.getAttribute("aria-expanded")).toBe("true");

  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});
