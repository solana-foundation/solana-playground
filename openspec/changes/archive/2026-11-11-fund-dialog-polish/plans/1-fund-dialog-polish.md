# Plan: Fund dialog polish (HOO-2787)

Inline, test first. Scope: `client-v2/src/features/fund-wallet` and its tests
only (HOO-2788 edits the faucet steps on the same base).

1. `model/fund.ts`: `DEFAULT_AMOUNT = "0"`; `stepAmount(±1)(text)` on
   lamports, to the next multiple of 0.1 SOL in that direction, floor 0;
   unparsable text steps from 0. In-source tests.
2. `ui/BaseFundDialog.tsx`, tests first in `BaseFundDialog.test.tsx`:
   - `addressUrl?: (address) => string | undefined` prop; both short
     addresses render as new-tab links when it returns a URL.
   - `FundPayer.icon`; the payer shows as a secondary `Badge` with icon + name.
   - − / + `InputGroupButton`s beside Max, ArrowUp/ArrowDown on the field.
   - `not-positive` is a hint, not an error; note `Arrives in <receiver> on <network>.`
   - Send: `BrandButton` (ring) with its own busy state and a `Spinner`;
     Cancel ghost, both at the modal frame's footer height.
3. `ui/FundDialog.tsx`: pass `addressUrl` from `PgBlockExplorer.current`
   (`opens(cluster)` guard, as `views/flow/stages/Deploy.tsx` does) and the
   payer's icon. Update `FundDialog.test.tsx` for the new default.
4. Gate: `yarn run check`; Playwright look at the dialog on devnet for the
   PR's screenshots.
