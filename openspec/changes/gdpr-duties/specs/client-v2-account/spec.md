# Spec Delta

## ADDED Requirements

### Requirement: The account menu links the privacy policy

The account menu SHALL hold a "Privacy policy" item, signed in and signed out,
that opens `https://solana.com/privacy-policy` in a new tab. Picking it SHALL
emit `session_account_item_picked` with `item: "privacy-policy"`.

#### Scenario: Opening the privacy policy signed out (manual)
Pinned by `client-v2/src/widgets/session-footer/ui/BaseAccountMenu.test.tsx` and `SessionFooter.test.tsx`, under `yarn test-unit`.
- **WHEN** a signed-out person opens the account menu and picks Privacy policy
- **THEN** `https://solana.com/privacy-policy` opens in a new tab and `session_account_item_picked` with `item: "privacy-policy"` is sent

#### Scenario: The link beside sign-in (manual)
Pinned by `client-v2/src/widgets/session-footer/ui/BaseAccountMenu.test.tsx` and `SessionFooter.test.tsx`, under `yarn test-unit`.
- **WHEN** a signed-out person opens the account menu
- **THEN** Privacy policy is listed in the same menu as Sign in with GitHub
