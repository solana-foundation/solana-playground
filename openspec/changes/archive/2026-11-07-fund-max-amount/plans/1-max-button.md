# Plan: Max button (task 1.1)

Ticket: HOO-2713 «Add a Max button to the Fund dialog's amount».

1. Test first, `model/fund.ts` in-source tests: `maxAmount(2)` is `"1.999"`,
   `maxAmount(0.0005)` and `maxAmount(0.001)` are `undefined`, a 9-decimal
   balance keeps every lamport (`1.000000001` gives `"0.999000001"`), and
   `canSend(maxAmount(b), b)` is ok.
2. `maxAmount(balance)`: spendable lamports as `canSend` counts them; above 0
   it returns the decimal string, else `undefined`.
3. Test first, `BaseFundDialog.test.tsx`: Max calls `onAmountChange("1.999")`
   for a 2 SOL payer; disabled for `0.0005`, `"loading"` and `"unavailable"`.
4. `BaseFundDialog`: the amount `Input` becomes `InputGroup` +
   `InputGroupInput` with an `inline-end` `InputGroupButton` "Max", as in
   `BaseCustomRpcs`.
5. Playwright: "Max then send" and "Balance below the fee" in
   `e2e/wallet-funding.e2e.spec.ts`; "Balance loading" is manual.
6. Gate: `yarn run check` in `client-v2/` plus that spec.
