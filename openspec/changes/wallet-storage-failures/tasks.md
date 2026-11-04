# Tasks

## 1. Keystore tests

- [x] 1.1 Add `fake-indexeddb` as a devDependency and an in-source block in `keystore.ts` covering open, read, write, the open timeout and the lock; verify `yarn test-unit src/utils/wallet/keystore.ts` passes and `yarn test-build` finds no test module in the bundle

## 2. Storage results

- [x] 2.1 Make `read` return `wallet | none | unavailable` and map `unavailable` to the unpersisted `"unavailable"` wallet state; verify with unit tests in `wallet-storage.ts` and the scenario "The store fails and nothing is in localStorage" as a Playwright test
- [x] 2.2 Make writes report `store | local | lost` and show the save-failure notice once per page load; verify with unit tests and "Neither store saves the wallet" as a Playwright test
- [ ] 2.3 Filter damaged accounts, remap the current one and set the damaged ones aside in the database; verify with unit tests and "One of three accounts is damaged" and "The current account is the damaged one" as Playwright tests
- [ ] 2.4 Request persistent storage after the first store write; verify "Persistence is requested once" as a Playwright test

## 3. The unavailable state in the UI

- [ ] 3.1 Handle `"unavailable"` in `connect.ts` and give the setup list's wallet step the warning status, "Wallet unavailable", Try again and `setup_wallet_retried`; verify "Try again reads the wallet" and "A browser without IndexedDB gets Setup" as Playwright tests and the event in a unit test of the step
