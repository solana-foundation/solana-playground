## REMOVED Requirements

### Requirement: A saved RPC shows only its host

**Reason**: A person could not tell whether the key they added was saved (HOO-2714).
**Migration**: Replaced by "A saved RPC shows its URL with its key masked".

## ADDED Requirements

### Requirement: A saved RPC shows its URL with its key masked

The list of saved RPCs (`aria-label="Custom RPCs"`) SHALL show each RPC's name and its whole stored URL, with every secret in it replaced by `••••`, always four dots whatever the secret's length. A secret SHALL be: a non-empty query value whose name looks like a key (it contains `key`, `token`, `secret`, `auth`, `pass`, `sig` or `credential`, in any case); any host label, path segment, query value, bare query term or fragment that looks like a token, 16 or more of letters, digits, `-`, `_`, `.`, `~`, `+`, `=` or `%` with a digit, or 24 or more in mixed case; and a username or password. A stored value that is not a URL SHALL show as `••••` alone. When anything was masked, an "API key" badge SHALL show beside the URL. The stored URL SHALL not change, and the full URL SHALL appear only inside the edit field.

#### Scenario: A key in the query is masked

- **WHEN** a saved RPC's URL is `https://devnet.helius-rpc.com/?api-key=secret`
- **THEN** the page shows `https://devnet.helius-rpc.com/?api-key=••••` and an "API key" badge
- **AND** no text containing `secret`, outside the edit field

#### Scenario: A key in the path is masked

- **WHEN** a saved RPC's URL is `https://mainnet.rpc.test/v2/abc123def456ghi789`
- **THEN** the page shows `https://mainnet.rpc.test/v2/••••` and an "API key" badge

#### Scenario: A URL with no key shows in full

- **WHEN** a saved RPC's URL is `https://rpc.example.com/`
- **THEN** the page shows `https://rpc.example.com/` and no "API key" badge
