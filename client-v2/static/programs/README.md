# The program gallery

`programs.json` is the list the Programs gallery and Home's program count read
(`/programs/programs.json`, `entities/program`). It replaces upstream's copy in
`client/public/programs/` whenever `scripts/update-static.mjs` runs (`yarn
generate`, `yarn dev`), through `scripts/static-overlay.mjs`.
Upstream's list is kept as it is; this one is curated.

Every listed program is code a person can open, build and deploy from
Playground with one press, so the list is a curated surface, not a mirror of
the ecosystem (security review, 29 Oct 2026).

## What gets in

A program is listed only when all of these hold:

1. **It builds on the default build server.** Open the card in Playground and
   press Build with the default server (Solana Foundation): the output ends in
   `Finished release` with no `could not compile`. The server compiles against
   its own fixed crate list, ignores the program's `Cargo.toml`, and refuses
   more than 64 source files, so most large protocols fail.
2. **It is Solana-native or notable.** A program from Solana itself (SPL,
   Anza, Solana Foundation) or a protocol people recognise and would want to
   read. No forks, demos or abandoned experiments.
3. **It opens.** The link names a ref (`/tree/<ref>/<path>`; the URL's shape
   is checked by `scripts/programs-list.test.mjs`, the folder by hand) and
   that folder holds the program's `src/`. A program whose repository moved
   or rewrote it for newer crates is pinned to the last tag or commit that
   still builds: the SPL programs here come from the archived
   `solana-program-library`, pinned at `token-v4.0.0`, because its `master`
   dropped some of them and their new homes in `solana-program/*` need crates
   the server lacks. A repository without a usable tag is pinned to a
   commit.

## Checking the list

Programs leave as well as enter: a repository that moves, or a build server
whose crates change, can break a card that worked. Check every card before a
release and after a build-server change, and drop what no longer builds.

Last checked 3 Nov 2026 against the Foundation server, for HOO-2527: all
eleven build. On 7 Nov Bonfida's `token-vesting`, the one non-SPL entry,
was dropped: in the app its card never finished building (HOO-2700), so ten
remain. Of upstream's 34, only four did (HOO-2421: spl-memo,
spl-name-service, spl-noop and spl-stake-pool): the rest hit missing
crates (most Anchor protocols and SPL programs), more than 64 source files
(mpl-token-metadata, openbook-v2), or a 502 from the server (drift-v2,
mango-v4, marginfi, whirlpool).

Anchor protocols mostly fail on the crate list, not on their size. The server
compiles Anchor 0.29 against `solana-program` 1.16 and lacks crates common in
protocol code (`solana-security-txt`, `uint`, `spl-memo`, `mpl-core`,
`fixed`), so code written for Anchor 0.28 (`ctx.bumps.get`) or 0.30+ fails as
well. Tried and refused on 3 Nov: raydium-cp-swap, raydium-clmm, squads-v4,
jito tip-payment and tip-distribution, mpl-hybrid, mpl-candy-machine-core,
mpl-candy-guard, mpl-inscription, marinade validator-bonds, tensor
marketplace and whitelist.
