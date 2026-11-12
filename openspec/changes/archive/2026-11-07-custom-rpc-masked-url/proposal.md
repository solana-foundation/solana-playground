# Proposal

## Why

A saved custom RPC shows only its URL's host, so a person cannot tell whether
the API key they added is in it (Sergey, 7 Nov call). Slava, 7 Nov: show the
address, hide the key's value like a password, and say the address holds a
key (HOO-2714).

## What Changes

- The row under a saved RPC's name shows the whole stored URL, each secret
  replaced by `••••`: a query value under a key-like name, any query value,
  path segment or fragment that looks like a token, and a username and
  password.
- An "API key" badge beside the URL when anything was masked.
- The stored URL, the edit field and the default name (the host) are
  unchanged.

## Capabilities

### Modified Capabilities

- `client-v2-custom-rpcs`: "A saved RPC shows only its host" becomes "A saved
  RPC shows its URL with its key masked".

## Impact

`entities/custom-rpc` (a `maskRpcUrl` helper beside `hostOf`) and
`widgets/settings-page/ui/BaseCustomRpcs.tsx`. No storage, telemetry or
network change.
