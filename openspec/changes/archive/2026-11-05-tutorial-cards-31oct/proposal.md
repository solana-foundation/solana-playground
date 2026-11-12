# Proposal

## Why

The tutorials list shipped with the 28 Oct card (HOO-2360). Almaz's prototype
at its head, `almaz/mobile-tutorial-prototype` at `f7d42bf2e`, draws the card
differently on desktop and phone. Slava, 3 Nov 20:00: nothing in the tutorial
is built to an old prototype. HOO-2549, audit row 10.

## What Changes

- **The framework word sits over the name**; the caption line under the
  description goes, and the author with it.
- **The name is the card's headline**: heading face, 18 px, up to two lines,
  with the progress beside it a tier under it.
- **The cover is a 44 px square** beside the framework word and the name.
- **The description runs under the corner square too**, in the text's column.
- **A phone keeps the corner square**; the chevron goes.
- New project shares the card. Its word over the name is "<level> ·
  <framework>", because no level heading names the level there.

- **The page's search folds on a phone** to a glass that opens the whole row,
  with Cancel; the filter is bare sliders in a 44 px square.
- **The page's spacing** as at the head: 56 px over the heading on desktop, 32 px
  between the heading, the banner and the first level.

Unchanged, checked against `f7d42bf2e`: the number beside a level's heading
(the tutorials it holds) and the Start here banner's content. Pixel covers stay
off, as the head has them.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-tutorials`: what a tutorial card shows, and how it looks on a phone.

## Impact

`client-v2/src/widgets/catalog`: `BaseTutorialCard`, `BaseTutorialLevels`,
`BaseTutorialGrid`, `lib/tutorial-caption.ts` and their tests. The Programs
tab's cards are `BaseCatalogGrid` and do not change.
