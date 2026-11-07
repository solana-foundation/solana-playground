# 1.1 Masked URL (HOO-2714)

Goal: the saved-RPC row shows the full URL with secrets as `••••` and an "API key" badge.

1. Test first (`custom-rpcs.ts` in-source vitest block): `maskRpcUrl(url) -> { text, masked }` for a key-named query value, a token-like query value, a token path segment (Alchemy, QuickNode, Ankr shapes), userinfo, a fragment, and plain URLs (public Devnet, localhost, a short `?cluster=devnet`). Run, see it fail.
2. Implement from the raw `URL` parts (`protocol`, `host`, `pathname`, `search`, `hash`), splitting the raw `search` on `&` and `=` so names keep their spelling and the dots are never percent-encoded. Run, green.
3. Test first (`BaseCustomRpcs.test.tsx`): the row shows the masked URL and the badge for a keyed URL, no badge for a plain one, and no key text outside the edit field. Then swap `hostOf` for `maskRpcUrl` in the row and add an outline `Badge` "API key".
4. Replace the old `hostOf` test's wording only where it describes the row; `hostOf` stays for default names.
5. `yarn run check`; screenshots of Settings › Network before/after on the scope branch.
