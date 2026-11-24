## ADDED Requirements

### Requirement: A running deploy holds the Playground accounts

A deploy SHALL sign with the account it started with. From the start of a deploy's run to its end, whether
it succeeds, fails, is stopped, paused or cancelled, and whether it started in the terminal or on the Deploy
stage, the Playground wallet SHALL refuse to switch accounts, to make an extension current, and to add,
create, import or remove an account. Each refusal SHALL read "A deploy is running: accounts cannot change
until it ends." and SHALL be shown as a plain message, not reported as a failure. The hold SHALL be released
at the run's end on every path. While it is held, the Wallet window SHALL disable its account items and its
Add, Remove and Import actions, and SHALL enable them again once the deploy ends. The scenarios are held by
unit tests (`wallet.test.ts`, `deploy.test.ts`, `deploy-run.test.ts`, `Settings.test.tsx`, `Wallet.test.tsx`,
`ModalFrame.test.tsx`).

#### Scenario: Switching during a deploy (manual)

- **WHEN** a deploy runs and the user opens the Wallet window
- **THEN** its account items and Add, Remove and Import are disabled, and the chip offers no "Accounts"

#### Scenario: The hold ends with the deploy (manual)

- **WHEN** the deploy ends, or the user stops it
- **THEN** the Wallet window's account items are enabled and switching works
