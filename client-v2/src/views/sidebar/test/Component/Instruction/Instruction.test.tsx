import { afterEach, expect, it, vi } from "vitest";

// One instruction card: its head counts the inputs, its body groups them and
// ends in Send, which says what it waits for.

const network = vi.hoisted(() => ({ hold: undefined as string | undefined }));
vi.mock("@/widgets/status", () => ({ useNetworkHold: () => network.hold }));

// The utils barrel reads build-time globals jsdom lacks, and the inputs need
// a connected program; the form under test needs none of it.
vi.mock("../../../../../utils", () => ({
  PgCommon: { debounce: (fn: () => void) => fn },
}));
// What the store holds for an instruction: a filled form the user left and
// came back to, or an empty custom field, or a field with a parse error
const stored = vi.hoisted(() => ({
  amount: { value: "5", error: false },
}));
vi.mock("../../../../../utils/program-interaction", () => ({
  PgProgramInteraction: {
    // "ping" takes nothing; every other instruction one arg and one account
    getOrCreateInstruction: (ix: { name: string }) =>
      ix.name === "ping"
        ? { name: ix.name, values: { args: [], accounts: [] } }
        : {
            name: ix.name,
            values: {
              args: [
                {
                  name: "amount",
                  error: stored.amount.error,
                  generator: { type: "Custom", value: stored.amount.value },
                },
              ],
              accounts: [
                {
                  name: "owner",
                  error: false,
                  generator: { type: "Custom", value: "owner-key" },
                },
              ],
            },
          },
    saveInstruction: vi.fn(),
  },
}));
const session = vi.hoisted(() => ({ wallet: {} as object | undefined }));
vi.mock("../../../../../hooks", () => ({ useWallet: () => session.wallet }));
vi.mock("./InstructionInput", () => ({ default: () => null }));
vi.mock("../IdlProvider", () => ({ useIdl: () => ({ idl: {} }) }));

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { FC } from "react";
import { createElement } from "react";

import { requireFor } from "@/test-utils/require-for";
import type { ToastChildProps } from "@/utils/view";
import { PgView } from "@/utils/view";

import Instruction from "./Instruction";

type Props = Parameters<typeof Instruction>[0];

const IX = {
  name: "increment",
  args: [],
  accounts: [],
} as unknown as Props["idlInstruction"];

it("counts the inputs in the head: one arg and one account", () => {
  render(<Instruction idlInstruction={IX} onCall={vi.fn()} />);

  expect(
    screen.getByRole("button", { name: /increment/ }).textContent
  ).toContain("1 arg · 1 account");
});

it("draws an instruction that takes nothing with no count, no groups and no Fill or Reset", () => {
  const PING = {
    name: "ping",
    args: [],
    accounts: [],
  } as unknown as Props["idlInstruction"];
  render(<Instruction idlInstruction={PING} onCall={vi.fn()} open />);

  expect(screen.getByRole("button", { name: "ping" }).textContent).toBe("ping");
  expect(screen.queryByRole("region")).toBeNull();
  expect(screen.queryByRole("button", { name: "Fill with Random" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  expect(sendButton().disabled).toBe(false);
});

it("starts folded, and opens through the card's own head when nobody holds it", () => {
  render(<Instruction idlInstruction={IX} onCall={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: /increment/ }));
  expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
});

it("reports a toggle of its head to the holder", () => {
  const onOpenChange = vi.fn();
  render(
    <Instruction
      idlInstruction={IX}
      onCall={vi.fn()}
      open={false}
      onOpenChange={onOpenChange}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: /increment/ }));
  expect(onOpenChange).toHaveBeenCalledWith(true);
});

it("groups the inputs under plain Arguments and Accounts groups, not folds", () => {
  render(<Instruction idlInstruction={IX} onCall={vi.fn()} open />);

  expect(screen.getByRole("region", { name: "Arguments" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Accounts" })).toBeTruthy();
  // No heading level skipped under the page's h2
  expect(screen.queryByRole("heading")).toBeNull();
  expect(screen.queryByRole("button", { name: "Args" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Accounts" })).toBeNull();
});

it("ends in Send with quiet Fill with Random and Reset", () => {
  render(<Instruction idlInstruction={IX} onCall={vi.fn()} open />);

  expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Fill with Random" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
});

it("sends the instruction through onCall", () => {
  const onCall = vi.fn(() => Promise.resolve());
  render(<Instruction idlInstruction={IX} onCall={onCall} open />);

  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(onCall).toHaveBeenCalledWith(
    expect.objectContaining({ name: "increment" })
  );
});

it("holds Send for a wallet first, and says so", () => {
  session.wallet = undefined;
  render(
    <Instruction
      idlInstruction={IX}
      onCall={vi.fn()}
      open
      solNeededOn="devnet"
    />
  );

  expect(sendButton().disabled).toBe(true);
  expect(screen.getByText("Connect a wallet to send")).toBeTruthy();
});

it("holds Send for the fee before the fields, and names the network", () => {
  stored.amount = { value: "", error: false };
  render(
    <Instruction
      idlInstruction={IX}
      onCall={vi.fn()}
      open
      solNeededOn="devnet"
    />
  );

  expect(sendButton().disabled).toBe(true);
  expect(screen.getByText("Add devnet SOL to send")).toBeTruthy();
  expect(screen.queryByText("Fill every field to send")).toBeNull();
});

it("holds Send for an empty field and says so", () => {
  stored.amount = { value: "", error: false };
  render(<Instruction idlInstruction={IX} onCall={vi.fn()} open />);

  expect(sendButton().disabled).toBe(true);
  expect(screen.getByText("Fill every field to send")).toBeTruthy();
});

it("says nothing once Send can run", () => {
  render(<Instruction idlInstruction={IX} onCall={vi.fn()} open />);

  expect(sendButton().disabled).toBe(false);
  expect(screen.queryByText(/to send$/)).toBeNull();
});

it("draws the fee payer slot above the actions", () => {
  render(
    <Instruction
      idlInstruction={IX}
      onCall={vi.fn()}
      open
      feePayer={<p>Fee paid by Playground wallet · 1 SOL</p>}
    />
  );
  expect(
    screen.getByText("Fee paid by Playground wallet · 1 SOL")
  ).toBeTruthy();
});

it("reads Sending… and locks the form until the call settles", async () => {
  let settle: () => void = () => {};
  const onCall = vi.fn(
    () => new Promise<void>((resolve) => (settle = resolve))
  );
  const { container } = render(
    <Instruction idlInstruction={IX} onCall={onCall} open />
  );

  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  const busy = await screen.findByRole("button", { name: /Sending…/ });
  expect((busy as HTMLButtonElement).disabled).toBe(true);
  expect(container.querySelector("fieldset")?.disabled).toBe(true);
  expect(
    (
      screen.getByRole("button", {
        name: "Fill with Random",
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);

  await act(async () => settle());
  expect(sendButton().disabled).toBe(false);
  expect(container.querySelector("fieldset")?.disabled).toBe(false);
});

it("toasts Could not send increment. when the call rejects", async () => {
  const setToast = vi.spyOn(PgView, "setToast").mockImplementation(() => {});
  const onCall = vi.fn(() => Promise.reject(new Error("rpc down")));
  render(<Instruction idlInstruction={IX} onCall={onCall} open />);

  fireEvent.click(screen.getByRole("button", { name: "Send" }));

  await vi.waitFor(() => expect(setToast).toHaveBeenCalled());
  const [elementable] = requireFor("a setToast call")(
    setToast.mock.calls.at(-1)
  );
  const Toast = elementable as FC<ToastChildProps>;
  const { container } = render(createElement(Toast, { id: "button-failed" }));
  expect(container.textContent).toBe("Could not send increment.");
  setToast.mockRestore();
});

const FORM_IX = {
  name: "deposit",
  args: [{ name: "amount" }],
  accounts: [{ name: "owner" }],
} as unknown as Props["idlInstruction"];

const sendButton = () =>
  screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;

afterEach(() => {
  stored.amount = { value: "5", error: false };
  session.wallet = {};
  network.hold = undefined;
});

// Every card mounts its form, and a remount (a rebuilt IDL) restores the
// stored values; the inputs report nothing on mount, so the form has to read
// its restored values itself
it("enables Send for a valid form restored after leaving and returning", () => {
  const first = render(
    <Instruction idlInstruction={FORM_IX} onCall={vi.fn()} open />
  );
  first.unmount();

  render(<Instruction idlInstruction={FORM_IX} onCall={vi.fn()} open />);

  expect(sendButton().disabled).toBe(false);
});

it("keeps Send off for a restored form with a field in error", () => {
  stored.amount = { value: "x", error: true };
  render(<Instruction idlInstruction={FORM_IX} onCall={vi.fn()} open />);

  expect(sendButton().disabled).toBe(true);
});

// Another call in flight holds every card's Send; the reason is the stage's
it("holds Send while the caller blocks it, without a reason of its own", () => {
  session.wallet = undefined;
  render(<Instruction idlInstruction={IX} onCall={vi.fn()} open callBlocked />);

  expect(sendButton().disabled).toBe(true);
  expect(screen.queryByText("Connect a wallet to send")).toBeNull();
});

it("holds Send while the network is down, and says why first", () => {
  network.hold = "Devnet is not responding";
  stored.amount = { value: "", error: false };
  render(<Instruction idlInstruction={FORM_IX} onCall={vi.fn()} open />);

  expect(sendButton().disabled).toBe(true);
  expect(screen.getByText("Devnet is not responding")).toBeTruthy();
  expect(screen.queryByText("Fill every field to send")).toBeNull();
});
