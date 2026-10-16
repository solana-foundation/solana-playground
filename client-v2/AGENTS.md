# client-v2 agent rules

## Tests: no spread for creating new shapes

In test files, do not build a new object or array shape by spreading an existing one
(`{ ...base, field: x }`, `[...head, ...tail]`). Prefer an explicit copy that names every field, or
derive the new instance with lenses (`ramda`'s `lensProp`/`set`/`over`, or a similar tool). A spread
hides which fields the fixture actually carries; the explicit form names the change. Build long
event series with small named helpers rather than inline spreads.

Production code is not covered by this rule yet — match the surrounding idiom there.

Note: no lens library is a dependency yet — until one is added, write the explicit copy.
