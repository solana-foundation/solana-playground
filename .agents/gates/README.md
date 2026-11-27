# Gates

A gate is a checkable rule. Its weight is the cost of keeping a violation.

One gate is one file, `<topic>/<name>.md`; its id is the path without `.md`. The file holds YAML frontmatter
with `weight` and `test`, the rule in one or two sentences, and optional `Fails:` and `Passes:` example lines.
`test` is `judgement` or a check that settles the gate: a quoted fragment, a grep, a count.

| Weight | 0.2 | 0.4 | 0.6 | 0.8 | 1.0 |
| --- | --- | --- | --- | --- | --- |
| Size | XS | S | M | L | XL |
| Breaking it | acceptable, noted | suggestion | important | important | blocks the merge |

A violation with a concrete production failure is critical at any weight. Violations are never summed.

A gate names no path, symbol, or tool of one repository, so the folder is portable. A rule that lives in a rule file is not copied here. Gates judge technical quality, not business value.

A 1.0 gate needs a test other than `judgement`, is not waived at the site, and changes only in its own PR.

`INDEX.md` is generated from the gate files, for reviewers that take one file per rule source; regenerate it with
`node .claude/skills/quality-gates/scripts/lint-gates.mjs --write-index .agents/gates`. The lint fails while it is stale.
